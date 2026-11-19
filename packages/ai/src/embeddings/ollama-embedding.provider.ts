import { EMBEDDING_DIMENSIONS } from '@enterprise-ai/shared';
import { z } from 'zod';
import {
  DEFAULT_AI_EMBEDDING_BATCH_SIZE,
  DEFAULT_OLLAMA_EMBEDDING_MODEL,
} from '../config/ai-config.js';
import {
  AIInvalidRequestError,
  AIInvalidResponseError,
} from '../errors/ai-error.js';
import {
  OllamaHttpClient,
  type OllamaClientOptions,
} from '../providers/ollama-http.js';
import { validateEmbeddingVector } from './openai-embedding.provider.js';
import type {
  BatchEmbeddingResult,
  EmbeddingProvider,
  EmbeddingRequestOptions,
  EmbeddingResult,
  EmbeddingUsage,
} from './types.js';

export interface OllamaEmbeddingProviderOptions extends OllamaClientOptions {
  model?: string;
  dimensions?: number;
  batchSize?: number;
}

const ollamaEmbedResponseSchema = z.object({
  model: z.string().min(1).optional(),
  embeddings: z.array(z.array(z.number())),
  prompt_eval_count: z.number().int().nonnegative().optional(),
});

const PROVIDER_NAME = 'ollama';

/**
 * Local Ollama embedding provider calling POST /api/embed with native fetch,
 * strict fixed-dimension validation, batching, and retry/timeout controls.
 */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  public readonly providerName = PROVIDER_NAME;
  public readonly model: string;
  public readonly dimensions: number;
  private readonly batchSize: number;
  private readonly client: OllamaHttpClient;

  constructor(options: OllamaEmbeddingProviderOptions = {}) {
    const model = (options.model ?? DEFAULT_OLLAMA_EMBEDDING_MODEL).trim();
    if (!model) {
      throw new AIInvalidRequestError(
        PROVIDER_NAME,
        'Embedding model name must be non-empty',
      );
    }

    const dimensions = options.dimensions ?? EMBEDDING_DIMENSIONS;
    if (!Number.isInteger(dimensions) || dimensions <= 0) {
      throw new AIInvalidRequestError(
        PROVIDER_NAME,
        'Embedding dimensions must be a positive integer',
      );
    }

    const batchSize = options.batchSize ?? DEFAULT_AI_EMBEDDING_BATCH_SIZE;
    if (!Number.isInteger(batchSize) || batchSize <= 0) {
      throw new AIInvalidRequestError(
        PROVIDER_NAME,
        'Embedding batchSize must be a positive integer',
      );
    }

    this.model = model;
    this.dimensions = dimensions;
    this.batchSize = batchSize;
    this.client = new OllamaHttpClient(options);
  }

  public async embedQuery(
    text: string,
    options?: EmbeddingRequestOptions,
  ): Promise<EmbeddingResult> {
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new AIInvalidRequestError(
        PROVIDER_NAME,
        'Query text for embedding must be non-empty',
      );
    }

    const batchResult = await this.embedDocuments([text], options);
    const embedding = batchResult.embeddings[0];
    if (!embedding) {
      throw new AIInvalidResponseError(
        PROVIDER_NAME,
        'Ollama returned no embedding for query input',
      );
    }

    return {
      embedding,
      model: batchResult.model,
      dimensions: batchResult.dimensions,
      usage: batchResult.usage,
      latencyMs: batchResult.latencyMs,
    };
  }

  public async embedDocuments(
    texts: string[],
    options?: EmbeddingRequestOptions,
  ): Promise<BatchEmbeddingResult> {
    if (texts.length === 0) {
      return {
        embeddings: [],
        model: this.model,
        dimensions: this.dimensions,
        latencyMs: 0,
      };
    }

    for (let i = 0; i < texts.length; i += 1) {
      const text = texts[i];
      if (typeof text !== 'string' || text.trim().length === 0) {
        throw new AIInvalidRequestError(
          PROVIDER_NAME,
          `Document chunk text at index ${i} must be non-empty`,
        );
      }
    }

    const startTime = performance.now();
    const allEmbeddings: number[][] = [];
    let resolvedModel = this.model;
    let totalInputTokens = 0;
    let hasUsage = false;

    for (let offset = 0; offset < texts.length; offset += this.batchSize) {
      const batch = texts.slice(offset, offset + this.batchSize);
      const response = await this.client.postJson(
        '/api/embed',
        {
          model: this.model,
          input: batch,
        },
        ollamaEmbedResponseSchema,
        options?.signal,
      );

      if (response.model) {
        resolvedModel = response.model;
      }

      if (response.embeddings.length !== batch.length) {
        throw new AIInvalidResponseError(
          PROVIDER_NAME,
          `Ollama embedding count mismatch: expected ${batch.length}, received ${response.embeddings.length}`,
        );
      }

      for (const vector of response.embeddings) {
        allEmbeddings.push(
          validateEmbeddingVector(vector, this.dimensions, PROVIDER_NAME),
        );
      }

      if (response.prompt_eval_count !== undefined) {
        hasUsage = true;
        totalInputTokens += response.prompt_eval_count;
      }
    }

    const usage: EmbeddingUsage | undefined = hasUsage
      ? { inputTokens: totalInputTokens, totalTokens: totalInputTokens }
      : undefined;

    return {
      embeddings: allEmbeddings,
      model: resolvedModel,
      dimensions: this.dimensions,
      usage,
      latencyMs: Math.max(0, Math.round(performance.now() - startTime)),
    };
  }
}
