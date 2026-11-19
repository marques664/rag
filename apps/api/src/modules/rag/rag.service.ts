import { estimateModelCostUsd } from '@enterprise-ai/ai';
import { DEFAULT_RETRIEVAL_TOP_K } from '@enterprise-ai/shared';
import {
  parseStructuredLLMResponse,
  validateCitations,
} from './citation-validator.js';
import { XmlContextAssemblyService } from './context-assembly.service.js';
import {
  buildGroundedUserPrompt,
  GROUNDED_SYSTEM_PROMPT,
  INSUFFICIENT_CONTEXT_ANSWER,
} from './rag.prompt.js';
import type {
  AnswerQuestionInput,
  ContextAssemblyService,
  RAGResponse,
  RagServiceDependencies,
  UsageInformation,
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
  private readonly defaultTopK: number;
  private readonly maxContextChars?: number;

  constructor(private readonly deps: RagServiceDependencies) {
    this.contextAssemblyService =
      deps.contextAssemblyService ?? new XmlContextAssemblyService();
    this.defaultTopK = deps.defaultTopK ?? DEFAULT_RETRIEVAL_TOP_K;
    this.maxContextChars = deps.maxContextChars;
  }

  public async answerQuestion(input: AnswerQuestionInput): Promise<RAGResponse> {
    const startedAt = performance.now();

    const embeddingResult = await this.deps.embeddingProvider.embedQuery(
      input.question,
      { signal: input.signal },
    );

    const retrievedChunks = await this.deps.retrievalService.retrieve({
      organizationId: input.organizationId,
      queryEmbedding: embeddingResult.embedding,
      topK: input.topK ?? this.defaultTopK,
      minSimilarity: input.minSimilarity,
      documentIds: input.documentIds,
    });

    const embeddingInputTokens = embeddingResult.usage?.inputTokens;
    const embeddingCost =
      embeddingInputTokens !== undefined
        ? estimateModelCostUsd({
            model: embeddingResult.model,
            inputTokens: embeddingInputTokens,
            outputTokens: 0,
          })
        : null;

    // Short-circuit cleanly when no tenant-eligible chunks are retrieved.
    if (retrievedChunks.length === 0) {
      const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
      const usage: UsageInformation = {
        model: this.deps.llmProvider.model,
        embeddingModel: embeddingResult.model,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        embeddingInputTokens,
        latencyMs,
        estimatedCost: embeddingCost,
      };

      return {
        answer: INSUFFICIENT_CONTEXT_ANSWER,
        insufficientContext: true,
        citations: [],
        usage,
      };
    }

    const assembledContext = this.contextAssemblyService.assemble(
      retrievedChunks,
      this.maxContextChars !== undefined
        ? { maxContextChars: this.maxContextChars }
        : undefined,
    );

    const llmResult = await this.deps.llmProvider.generate({
      systemPrompt: GROUNDED_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: buildGroundedUserPrompt(input.question, assembledContext),
        },
      ],
      temperature: 0.1,
      responseFormat: 'json_object',
      signal: input.signal,
    });

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
    const usage: UsageInformation = {
      model: llmResult.model,
      embeddingModel: embeddingResult.model,
      inputTokens,
      outputTokens,
      totalTokens,
      embeddingInputTokens,
      latencyMs,
      estimatedCost:
        llmResult.usage !== undefined
          ? combineEstimatedCosts([llmCost, embeddingCost])
          : embeddingCost,
    };

    return {
      answer: structuredOutput.answer,
      insufficientContext: structuredOutput.insufficientContext,
      citations,
      usage,
    };
  }
}
