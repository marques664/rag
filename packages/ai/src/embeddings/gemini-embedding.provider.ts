import { EMBEDDING_DIMENSIONS } from '@enterprise-ai/shared';
import { z } from 'zod';
import {
  DEFAULT_AI_EMBEDDING_BATCH_DELAY_MS,
  DEFAULT_GEMINI_EMBEDDING_BATCH_SIZE,
  DEFAULT_GEMINI_EMBEDDING_MODEL,
} from '../config/ai-config.js';
import {
  AIInvalidRequestError,
  AIInvalidResponseError,
} from '../errors/ai-error.js';
import {
  GeminiHttpClient,
  type GeminiClientOptions,
} from '../providers/gemini-http.js';
import { sleepWithAbort, type SleepLike } from '../providers/http-client.js';
import { validateEmbeddingVector } from './openai-embedding.provider.js';
import type {
  BatchEmbeddingResult,
  EmbeddingProvider,
  EmbeddingRequestOptions,
  EmbeddingResult,
} from './types.js';

export interface GeminiEmbeddingProviderOptions extends GeminiClientOptions {
  model?: string;
  dimensions?: number;
  batchSize?: number;
  batchDelayMs?: number;
}

const geminiEmbedContentResponseSchema = z.object({
  embedding: z.object({
    values: z.array(z.number()),
  }),
});

const geminiBatchEmbedContentsResponseSchema = z.object({
  embeddings: z.array(
    z.object({
      values: z.array(z.number()),
    }),
  ),
});

const PROVIDER_NAME = 'gemini';
const MAX_GEMINI_BATCH_SIZE = 100;

function normalizeGeminiModelId(model: string): string {
  return model.replace(/^models\//, '');
}

/**
 * Google Gemini embedding provider calling :embedContent and :batchEmbedContents
 * with task-type hints, inter-batch pacing, and strict fixed-dimension validation.
 */
export class GeminiEmbeddingProvider implements EmbeddingProvider {
  public readonly providerName = PROVIDER_NAME;
  public readonly model: string;
  public readonly dimensions: number;
  private readonly batchSize: number;
  private readonly batchDelayMs: number;
  private readonly sleepImpl: SleepLike;
  private readonly client: GeminiHttpClient;

  constructor(options: GeminiEmbeddingProviderOptions) {
    const model = normalizeGeminiModelId(
      (options.model ?? DEFAULT_GEMINI_EMBEDDING_MODEL).trim(),
    );
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

    const requestedBatchSize =
      options.batchSize ?? DEFAULT_GEMINI_EMBEDDING_BATCH_SIZE;
    if (!Number.isInteger(requestedBatchSize) || requestedBatchSize <= 0) {
      throw new AIInvalidRequestError(
        PROVIDER_NAME,
        'Embedding batchSize must be a positive integer',
      );
    }

    const batchDelayMs =
      options.batchDelayMs ?? DEFAULT_AI_EMBEDDING_BATCH_DELAY_MS;
    if (!Number.isFinite(batchDelayMs) || batchDelayMs < 0) {
      throw new AIInvalidRequestError(
        PROVIDER_NAME,
        'Embedding batchDelayMs must be a non-negative number',
      );
    }

    this.model = model;
    this.dimensions = dimensions;
    this.batchSize = Math.min(requestedBatchSize, MAX_GEMINI_BATCH_SIZE);
    this.batchDelayMs = batchDelayMs;
    this.sleepImpl =
      options.sleepImpl ??
      ((ms, signal) => sleepWithAbort(PROVIDER_NAME, ms, signal));
    this.client = new GeminiHttpClient(options);
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

    const startTime = performance.now();
    const modelResource = `models/${this.model}`;
    const response = await this.client.postJson(
      `/models/${encodeURIComponent(this.model)}:embedContent`,
      {
        model: modelResource,
        content: { parts: [{ text }] },
        taskType: 'RETRIEVAL_QUERY',
        outputDimensionality: this.dimensions,
      },
      geminiEmbedContentResponseSchema,
      options?.signal,
    );

    const embedding = validateEmbeddingVector(
      response.embedding.values,
      this.dimensions,
      PROVIDER_NAME,
    );

    return {
      embedding,
      model: this.model,
      dimensions: this.dimensions,
      latencyMs: Math.max(0, Math.round(performance.now() - startTime)),
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
    const modelResource = `models/${this.model}`;

    for (let offset = 0; offset < texts.length; offset += this.batchSize) {
      if (offset > 0 && this.batchDelayMs > 0) {
        await this.sleepImpl(this.batchDelayMs, options?.signal);
      }

      const batch = texts.slice(offset, offset + this.batchSize);
      const response = await this.client.postJson(
        `/models/${encodeURIComponent(this.model)}:batchEmbedContents`,
        {
          requests: batch.map((text) => ({
            model: modelResource,
            content: { parts: [{ text }] },
            taskType: 'RETRIEVAL_DOCUMENT',
            outputDimensionality: this.dimensions,
          })),
        },
        geminiBatchEmbedContentsResponseSchema,
        options?.signal,
      );

      if (response.embeddings.length !== batch.length) {
        throw new AIInvalidResponseError(
          PROVIDER_NAME,
          `Gemini embedding count mismatch: expected ${batch.length}, received ${response.embeddings.length}`,
        );
      }

      for (const item of response.embeddings) {
        allEmbeddings.push(
          validateEmbeddingVector(item.values, this.dimensions, PROVIDER_NAME),
        );
      }
    }

    return {
      embeddings: allEmbeddings,
      model: this.model,
      dimensions: this.dimensions,
      latencyMs: Math.max(0, Math.round(performance.now() - startTime)),
    };
  }
}
