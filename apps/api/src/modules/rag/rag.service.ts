import {
  AIProviderNotConfiguredError,
  estimateModelCostUsd,
  type EmbeddingResult,
} from '@enterprise-ai/ai';
import { DEFAULT_RETRIEVAL_TOP_K } from '@enterprise-ai/shared';
import {
  parseStructuredLLMResponse,
  validateCitations,
} from './citation-validator.js';
import { XmlContextAssemblyService } from './context-assembly.service.js';
import {
  buildGroundedUserPrompt,
  buildQueryRewritePrompt,
  GROUNDED_SYSTEM_PROMPT,
  INSUFFICIENT_CONTEXT_ANSWER,
  QUERY_REWRITE_SYSTEM_PROMPT,
} from './rag.prompt.js';
import type {
  AnswerQuestionInput,
  ContextAssemblyService,
  ConversationHistoryTurn,
  DetailedRAGResponse,
  RagServiceDependencies,
  RagStageLatencies,
  RagUsageInformation,
  RetrievalStrategy,
} from './rag.types.js';

function combineEstimatedCosts(
  costs: ReadonlyArray<number | null>,
): number | null {
  const [primaryCost] = costs;
  if (primaryCost === null || primaryCost === undefined) {
    return null;
  }

  let total = 0;
  for (const cost of costs) {
    if (cost !== null) {
      total += cost;
    }
  }
  return Number(total.toFixed(8));
}

export class RagService {
  private readonly contextAssemblyService: ContextAssemblyService;
  private readonly defaultStrategy: RetrievalStrategy;
  private readonly defaultTopK: number;
  private readonly maxContextChars?: number;

  constructor(private readonly deps: RagServiceDependencies) {
    this.contextAssemblyService =
      deps.contextAssemblyService ?? new XmlContextAssemblyService();
    this.defaultStrategy = deps.defaultStrategy ?? 'hybrid';
    this.defaultTopK = deps.defaultTopK ?? DEFAULT_RETRIEVAL_TOP_K;
    this.maxContextChars = deps.maxContextChars;
  }

  public async answerQuestion(
    input: AnswerQuestionInput,
  ): Promise<DetailedRAGResponse> {
    const tracer = this.deps.tracer;
    if (!tracer) {
      return this.runAnswerQuestion(input, null);
    }

    return tracer.withSpan(
      'rag.answer_question',
      input.traceContext,
      {
        'tenant.id': input.organizationId,
        'rag.strategy': input.strategy ?? this.defaultStrategy,
        'rag.top_k': input.topK ?? this.defaultTopK,
      },
      async (rootSpan) => this.runAnswerQuestion(input, rootSpan.context),
    );
  }

  private async contextualizeFollowUpQuestion(
    question: string,
    history: readonly ConversationHistoryTurn[] | undefined,
    signal?: AbortSignal,
    tracer?: RagServiceDependencies['tracer'],
    traceContext?: AnswerQuestionInput['traceContext'],
  ): Promise<string> {
    if (!history || history.length === 0) {
      return question;
    }

    const fallbackRewrite = (): string => {
      const lastUserTurn = [...history]
        .reverse()
        .find((turn) => turn.role === 'user');
      if (!lastUserTurn) {
        return question;
      }
      return `${lastUserTurn.content.slice(0, 160)} ${question}`.trim();
    };

    try {
      const runRewrite = () =>
        this.deps.llmProvider.generate({
          systemPrompt: QUERY_REWRITE_SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: buildQueryRewritePrompt(question, history),
            },
          ],
          temperature: 0,
          maxTokens: 160,
          responseFormat: 'json_object',
          signal,
        });

      const rewriteRes = tracer
        ? await tracer.withSpan(
            'rag.query_rewrite',
            traceContext,
            { 'rag.history_turns': history.length },
            runRewrite,
          )
        : await runRewrite();

      const cleaned = rewriteRes.content
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();
      const parsed = JSON.parse(cleaned) as { standaloneQuestion?: unknown };
      if (
        typeof parsed.standaloneQuestion === 'string' &&
        parsed.standaloneQuestion.trim().length > 0
      ) {
        return parsed.standaloneQuestion.trim();
      }
      return fallbackRewrite();
    } catch {
      return fallbackRewrite();
    }
  }

  private async runAnswerQuestion(
    input: AnswerQuestionInput,
    traceContext: AnswerQuestionInput['traceContext'],
  ): Promise<DetailedRAGResponse> {
    const tracer = this.deps.tracer;
    const startedAt = performance.now();
    const strategy = input.strategy ?? this.defaultStrategy;
    const requestedTopK = input.topK ?? this.defaultTopK;

    const retrievalQuery = await this.contextualizeFollowUpQuestion(
      input.question,
      input.history,
      input.signal,
      tracer,
      traceContext,
    );

    let embeddingMs = 0;
    let embeddingResult: EmbeddingResult | null = null;

    if (strategy !== 'lexical') {
      if (!this.deps.embeddingProvider) {
        throw new AIProviderNotConfiguredError(
          'embedding',
          'Embedding provider is not configured; use strategy="lexical" or configure AI_EMBEDDING_PROVIDER credentials',
        );
      }

      const embedStartedAt = performance.now();
      const embeddingProvider = this.deps.embeddingProvider;
      embeddingResult = tracer
        ? await tracer.withSpan(
            'rag.embedding',
            traceContext,
            {
              'ai.provider': embeddingProvider.providerName,
              'ai.model': embeddingProvider.model,
            },
            () =>
              embeddingProvider.embedQuery(retrievalQuery, {
                signal: input.signal,
              }),
          )
        : await embeddingProvider.embedQuery(retrievalQuery, {
            signal: input.signal,
          });
      embeddingMs = Math.max(0, Math.round(performance.now() - embedStartedAt));
    }

    const retrievalStartedAt = performance.now();
    const retrievalInput = {
      organizationId: input.organizationId,
      queryEmbedding: embeddingResult?.embedding,
      queryText: retrievalQuery,
      strategy,
      topK: requestedTopK,
      minSimilarity: input.minSimilarity,
      documentIds: input.documentIds,
    };
    const retrievedChunks = tracer
      ? await tracer.withSpan(
          'rag.retrieval',
          traceContext,
          { 'rag.strategy': strategy, 'rag.top_k': requestedTopK },
          async (span) => {
            const chunks = await this.deps.retrievalService.retrieve(retrievalInput);
            span.setAttributes({ 'rag.retrieved_count': chunks.length });
            return chunks;
          },
        )
      : await this.deps.retrievalService.retrieve(retrievalInput);
    const retrievalMs = Math.max(
      0,
      Math.round(performance.now() - retrievalStartedAt),
    );

    let rerankMs = 0;
    let finalChunks = retrievedChunks;
    if (retrievedChunks.length > 0 && this.deps.reranker) {
      const rerankStartedAt = performance.now();
      const reranker = this.deps.reranker;
      finalChunks = tracer
        ? await tracer.withSpan(
            'rag.rerank',
            traceContext,
            { 'rag.input_chunks': retrievedChunks.length },
            async (span) => {
              const ranked = await reranker.rerank(
                retrievalQuery,
                retrievedChunks,
                requestedTopK,
              );
              span.setAttributes({ 'rag.output_chunks': ranked.length });
              return ranked;
            },
          )
        : await reranker.rerank(retrievalQuery, retrievedChunks, requestedTopK);
      rerankMs = Math.max(0, Math.round(performance.now() - rerankStartedAt));
    }

    const embeddingModel = embeddingResult?.model ?? 'none';
    const embeddingInputTokens = embeddingResult?.usage?.inputTokens;
    const embeddingCost =
      embeddingResult !== null && embeddingInputTokens !== undefined
        ? estimateModelCostUsd({
            model: embeddingResult.model,
            inputTokens: embeddingInputTokens,
            outputTokens: 0,
          })
        : null;

    // Short-circuit cleanly when no tenant-eligible chunks are retrieved.
    if (finalChunks.length === 0) {
      const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
      const stageLatencies: RagStageLatencies = {
        embeddingMs,
        retrievalMs,
        rerankMs,
        generationMs: 0,
      };
      const usage: RagUsageInformation = {
        model: this.deps.llmProvider.model,
        embeddingModel,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        embeddingInputTokens,
        latencyMs,
        estimatedCost: embeddingCost,
        stageLatencies,
      };

      this.deps.logger?.info(
        {
          organizationId: input.organizationId,
          strategy,
          retrievedCount: 0,
          finalChunkCount: 0,
          insufficientContext: true,
          stageLatencies,
          totalLatencyMs: latencyMs,
        },
        'RAG pipeline short-circuited due to empty retrieval',
      );

      return {
        answer: INSUFFICIENT_CONTEXT_ANSWER,
        insufficientContext: true,
        citations: [],
        usage,
      };
    }

    const assembledContext = this.contextAssemblyService.assemble(
      finalChunks,
      this.maxContextChars !== undefined
        ? { maxContextChars: this.maxContextChars }
        : undefined,
    );

    const generationStartedAt = performance.now();
    const generatePayload = {
      systemPrompt: GROUNDED_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user' as const,
          content: buildGroundedUserPrompt(
            input.question,
            assembledContext,
            input.history,
          ),
        },
      ],
      temperature: 0.1,
      responseFormat: 'json_object' as const,
      signal: input.signal,
    };
    const llmResult = tracer
      ? await tracer.withSpan(
          'rag.generation',
          traceContext,
          {
            'ai.provider': this.deps.llmProvider.providerName,
            'ai.model': this.deps.llmProvider.model,
            'rag.context_sources': assembledContext.sources.length,
          },
          async (span) => {
            const generated = await this.deps.llmProvider.generate(generatePayload);
            span.setAttributes({
              'ai.usage.total_tokens': generated.usage?.totalTokens,
            });
            return generated;
          },
        )
      : await this.deps.llmProvider.generate(generatePayload);
    const generationMs = Math.max(
      0,
      Math.round(performance.now() - generationStartedAt),
    );

    const structuredOutput = parseStructuredLLMResponse(llmResult.content);
    const citations = validateCitations({
      insufficientContext: structuredOutput.insufficientContext,
      citedChunkIds: structuredOutput.citedChunkIds,
      chunksById: assembledContext.chunksById,
    });

    const inputTokens = llmResult.usage?.inputTokens ?? 0;
    const outputTokens = llmResult.usage?.outputTokens ?? 0;
    const totalTokens = llmResult.usage?.totalTokens ?? inputTokens + outputTokens;

    const llmCost = llmResult.usage
      ? estimateModelCostUsd({
          model: llmResult.model,
          inputTokens,
          outputTokens,
        })
      : null;

    const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
    const stageLatencies: RagStageLatencies = {
      embeddingMs,
      retrievalMs,
      rerankMs,
      generationMs,
    };

    const usage: RagUsageInformation = {
      model: llmResult.model,
      embeddingModel,
      inputTokens,
      outputTokens,
      totalTokens,
      embeddingInputTokens,
      latencyMs,
      estimatedCost:
        llmResult.usage !== undefined
          ? combineEstimatedCosts([llmCost, embeddingCost])
          : embeddingCost,
      stageLatencies,
    };

    this.deps.logger?.info(
      {
        organizationId: input.organizationId,
        strategy,
        retrievedCount: retrievedChunks.length,
        finalChunkCount: finalChunks.length,
        citationCount: citations.length,
        insufficientContext: structuredOutput.insufficientContext,
        stageLatencies,
        totalLatencyMs: latencyMs,
      },
      'Completed RAG pipeline stages',
    );

    return {
      answer: structuredOutput.answer,
      insufficientContext: structuredOutput.insufficientContext,
      citations,
      usage,
    };
  }
}
