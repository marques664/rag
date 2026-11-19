import { EMBEDDING_DIMENSIONS } from '@enterprise-ai/shared';
import { z } from 'zod';

export const SUPPORTED_AI_PROVIDERS = ['openai'] as const;
export type AIProviderType = (typeof SUPPORTED_AI_PROVIDERS)[number];

export const DEFAULT_AI_PROVIDER: AIProviderType = 'openai';
export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';
export const DEFAULT_OPENAI_EMBEDDING_DIMENSIONS = EMBEDDING_DIMENSIONS;
export const DEFAULT_OPENAI_CHAT_MODEL = 'gpt-4o-mini';
export const DEFAULT_AI_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_AI_MAX_RETRIES = 3;
export const DEFAULT_AI_RETRY_BASE_DELAY_MS = 500;
export const DEFAULT_AI_EMBEDDING_BATCH_SIZE = 64;

function emptyStringToUndefined(value: unknown): unknown {
  if (typeof value === 'string' && value.trim() === '') {
    return undefined;
  }
  return value;
}

const aiEnvSchema = z.object({
  AI_PROVIDER: z.enum(SUPPORTED_AI_PROVIDERS).default(DEFAULT_AI_PROVIDER),
  OPENAI_API_KEY: z.preprocess(
    emptyStringToUndefined,
    z.string().trim().min(1).optional(),
  ),
  OPENAI_BASE_URL: z
    .preprocess(emptyStringToUndefined, z.string().trim().url().optional())
    .default(DEFAULT_OPENAI_BASE_URL)
    .transform((url) => url.replace(/\/+$/, '')),
  OPENAI_EMBEDDING_MODEL: z
    .preprocess(emptyStringToUndefined, z.string().trim().min(1).optional())
    .default(DEFAULT_OPENAI_EMBEDDING_MODEL),
  OPENAI_EMBEDDING_DIMENSIONS: z.coerce
    .number()
    .int()
    .refine((value) => value === EMBEDDING_DIMENSIONS, {
      message: `OPENAI_EMBEDDING_DIMENSIONS must be ${EMBEDDING_DIMENSIONS} to match the database vector index`,
    })
    .default(DEFAULT_OPENAI_EMBEDDING_DIMENSIONS),
  OPENAI_CHAT_MODEL: z
    .preprocess(emptyStringToUndefined, z.string().trim().min(1).optional())
    .default(DEFAULT_OPENAI_CHAT_MODEL),
  AI_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(300_000)
    .default(DEFAULT_AI_REQUEST_TIMEOUT_MS),
  AI_MAX_RETRIES: z.coerce
    .number()
    .int()
    .min(0)
    .max(10)
    .default(DEFAULT_AI_MAX_RETRIES),
  AI_RETRY_BASE_DELAY_MS: z.coerce
    .number()
    .int()
    .min(0)
    .max(60_000)
    .default(DEFAULT_AI_RETRY_BASE_DELAY_MS),
  AI_EMBEDDING_BATCH_SIZE: z.coerce
    .number()
    .int()
    .min(1)
    .max(2048)
    .default(DEFAULT_AI_EMBEDDING_BATCH_SIZE),
});

export interface AIConfig {
  provider: AIProviderType;
  openai: {
    apiKey?: string;
    baseUrl: string;
    embeddingModel: string;
    embeddingDimensions: number;
    chatModel: string;
  };
  requestTimeoutMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
  embeddingBatchSize: number;
}

/**
 * Parses and validates centralized AI provider configuration from environment variables.
 * OPENAI_API_KEY remains optional at parse time so tests and non-AI endpoints can start
 * without live credentials; provider factories enforce key presence when invoked.
 */
export function loadAIConfig(
  source: NodeJS.ProcessEnv = process.env,
): AIConfig {
  const parsed = aiEnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid AI provider configuration: ${issues}`);
  }

  return {
    provider: parsed.data.AI_PROVIDER,
    openai: {
      apiKey: parsed.data.OPENAI_API_KEY,
      baseUrl: parsed.data.OPENAI_BASE_URL,
      embeddingModel: parsed.data.OPENAI_EMBEDDING_MODEL,
      embeddingDimensions: parsed.data.OPENAI_EMBEDDING_DIMENSIONS,
      chatModel: parsed.data.OPENAI_CHAT_MODEL,
    },
    requestTimeoutMs: parsed.data.AI_REQUEST_TIMEOUT_MS,
    maxRetries: parsed.data.AI_MAX_RETRIES,
    retryBaseDelayMs: parsed.data.AI_RETRY_BASE_DELAY_MS,
    embeddingBatchSize: parsed.data.AI_EMBEDDING_BATCH_SIZE,
  };
}
