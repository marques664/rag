import { EMBEDDING_DIMENSIONS } from '@enterprise-ai/shared';
import { z } from 'zod';
import {
  DEFAULT_AI_EMBEDDING_BATCH_SIZE,
  DEFAULT_OPENAI_EMBEDDING_MODEL,
} from '../config/ai-config.js';
import {
  AIInvalidRequestError,
  AIInvalidResponseError,
} from '../errors/ai-error.js';
import {
  OpenAIHttpClient,
  type OpenAIClientOptions,
} from '../providers/openai-http.js';
import type {
  BatchEmbeddingResult,
  EmbeddingProvider,
  EmbeddingRequestOptions,
  EmbeddingResult,
  EmbeddingUsage,
} from './types.js';

export interface OpenAIEmbeddingProviderOptions extends OpenAIClientOptions {
  model?: string;
  dimensions?: number;
  batchSize?: number;
}

const openAIEmbeddingResponseSchema = z.object({
  data: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      embedding: z.array(z.number()),
    }),
  ),
  model: z.string().min(1).optional(),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative(),
      total_tokens: z.number().int().nonnegative(),
    })
    .optional(),
});

const PROVIDER_NAME = 'openai';

/**
 * Validates that an embedding vector matches the exact expected dimensionality
 * and contains only finite numeric coordinates (no NaN or Infinity).
 */
export function validateEmbeddingVector(
  vector: readonly number[],
  expectedDimensions: number,
  provider = PROVIDER_NAME,
): number[] {
  if (vector.length !== expectedDimensions) {
    throw new AIInvalidResponseError(
      provider,
      `Embedding dimension mismatch: expected ${expectedDimensions}, received ${vector.length}`,
    );
  }

  for (let i = 0; i < vector.length; i += 1) {
    const value = vector[i];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new AIInvalidResponseError(
        provider,
        `Embedding contains non-finite coordinate at index ${i}`,
      );
    }
  }

  return [...vector];
}

/**
 * OpenAI embedding provider supporting single query and batched document embeddings
 * with strict fixed dimensionality validation.
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  public readonly providerName = PROVIDER_NAME;
  public readonly model: string;
  public readonly dimensions: number;
  private readonly batchSize: number;
  private readonly client: OpenAIHttpClient;

  constructor(options: OpenAIEmbeddingProviderOptions) {
    const model = (options.model ?? DEFAULT_OPENAI_EMBEDDING_MODEL).trim();
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
    this.client = new OpenAIHttpClient(options);
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
        'OpenAI returned no embedding for query input',
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
    let totalTokens = 0;
    let hasUsage = false;

    for (let offset = 0; offset < texts.length; offset += this.batchSize) {
      const batch = texts.slice(offset, offset + this.batchSize);
      const response = await this.client.postJson(
        '/embeddings',
        {
          model: this.model,
          input: batch,
          dimensions: this.dimensions,
          encoding_format: 'float',
        },
        openAIEmbeddingResponseSchema,
        options?.signal,
      );

      if (response.model) {
        resolvedModel = response.model;
      }

      if (response.data.length !== batch.length) {
        throw new AIInvalidResponseError(
          PROVIDER_NAME,
          `OpenAI embedding count mismatch: expected ${batch.length}, received ${response.data.length}`,
        );
      }

      const orderedBatch = new Array<number[] | undefined>(batch.length);
      for (const item of response.data) {
        if (item.index < 0 || item.index >= batch.length) {
          throw new AIInvalidResponseError(
            PROVIDER_NAME,
            `OpenAI returned out-of-range embedding index ${item.index}`,
          );
        }
        if (orderedBatch[item.index] !== undefined) {
          throw new AIInvalidResponseError(
            PROVIDER_NAME,
            `OpenAI returned duplicate embedding index ${item.index}`,
          );
        }
        orderedBatch[item.index] = validateEmbeddingVector(
          item.embedding,
          this.dimensions,
          PROVIDER_NAME,
        );
      }

      for (let i = 0; i < orderedBatch.length; i += 1) {
        const vec = orderedBatch[i];
        if (!vec) {
          throw new AIInvalidResponseError(
            PROVIDER_NAME,
            `OpenAI omitted embedding for batch index ${i}`,
          );
        }
        allEmbeddings.push(vec);
      }

      if (response.usage) {
        hasUsage = true;
        totalInputTokens += response.usage.prompt_tokens;
        totalTokens += response.usage.total_tokens;
      }
    }

    const usage: EmbeddingUsage | undefined = hasUsage
      ? { inputTokens: totalInputTokens, totalTokens }
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
