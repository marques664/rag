import { EMBEDDING_DIMENSIONS } from '@enterprise-ai/shared';
import { z } from 'zod';

export const SUPPORTED_LLM_PROVIDERS = [
  'groq',
  'gemini',
  'openai',
  'ollama',
] as const;
export type LLMProviderType = (typeof SUPPORTED_LLM_PROVIDERS)[number];

export const SUPPORTED_EMBEDDING_PROVIDERS = [
  'none',
  'gemini',
  'openai',
  'ollama',
] as const;
export type EmbeddingProviderType =
  (typeof SUPPORTED_EMBEDDING_PROVIDERS)[number];

export const SUPPORTED_AI_PROVIDERS = SUPPORTED_LLM_PROVIDERS;
export type AIProviderType = LLMProviderType;

export const DEFAULT_LLM_PROVIDER: LLMProviderType = 'groq';
export const DEFAULT_EMBEDDING_PROVIDER: EmbeddingProviderType = 'none';
export const DEFAULT_AI_PROVIDER: AIProviderType = DEFAULT_LLM_PROVIDER;

export const DEFAULT_GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
export const DEFAULT_GROQ_CHAT_MODEL = 'qwen/qwen3.8-27b';

export const DEFAULT_GEMINI_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta';
export const DEFAULT_GEMINI_EMBEDDING_MODEL = 'gemini-embedding-001';
export const DEFAULT_GEMINI_EMBEDDING_DIMENSIONS = EMBEDDING_DIMENSIONS;
export const DEFAULT_GEMINI_EMBEDDING_BATCH_SIZE = 20;
export const DEFAULT_GEMINI_CHAT_MODEL = 'gemini-2.5-flash';

export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';
export const DEFAULT_OPENAI_EMBEDDING_DIMENSIONS = EMBEDDING_DIMENSIONS;
export const DEFAULT_OPENAI_CHAT_MODEL = 'gpt-4o-mini';

export const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';
export const DEFAULT_OLLAMA_EMBEDDING_MODEL = 'nomic-embed-text';
export const DEFAULT_OLLAMA_EMBEDDING_DIMENSIONS = EMBEDDING_DIMENSIONS;
export const DEFAULT_OLLAMA_CHAT_MODEL = 'llama3.1';

export const DEFAULT_AI_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_AI_MAX_RETRIES = 3;
export const DEFAULT_AI_RETRY_BASE_DELAY_MS = 500;
export const DEFAULT_AI_EMBEDDING_BATCH_SIZE = 64;
export const DEFAULT_AI_EMBEDDING_BATCH_DELAY_MS = 1000;

function emptyStringToUndefined(value: unknown): unknown {
  if (typeof value === 'string' && value.trim() === '') {
    return undefined;
  }
  return value;
}

const aiEnvSchema = z.object({
  AI_PROVIDER: z.preprocess(
    emptyStringToUndefined,
    z.enum(SUPPORTED_AI_PROVIDERS).optional(),
  ),
  AI_LLM_PROVIDER: z.preprocess(
    emptyStringToUndefined,
    z.enum(SUPPORTED_LLM_PROVIDERS).optional(),
  ),
  AI_EMBEDDING_PROVIDER: z.preprocess(
    emptyStringToUndefined,
    z.enum(SUPPORTED_EMBEDDING_PROVIDERS).optional(),
  ),
  GROQ_API_KEY: z.preprocess(
    emptyStringToUndefined,
    z.string().trim().min(1).optional(),
  ),
  GROQ_BASE_URL: z
    .preprocess(emptyStringToUndefined, z.string().trim().url().optional())
    .default(DEFAULT_GROQ_BASE_URL)
    .transform((url) => url.replace(/\/+$/, '')),
  GROQ_CHAT_MODEL: z
    .preprocess(emptyStringToUndefined, z.string().trim().min(1).optional())
    .default(DEFAULT_GROQ_CHAT_MODEL),
  GEMINI_API_KEY: z.preprocess(
    emptyStringToUndefined,
    z.string().trim().min(1).optional(),
  ),
  GEMINI_BASE_URL: z
    .preprocess(emptyStringToUndefined, z.string().trim().url().optional())
    .default(DEFAULT_GEMINI_BASE_URL)
    .transform((url) => url.replace(/\/+$/, '')),
  GEMINI_EMBEDDING_MODEL: z
    .preprocess(emptyStringToUndefined, z.string().trim().min(1).optional())
    .default(DEFAULT_GEMINI_EMBEDDING_MODEL),
  GEMINI_EMBEDDING_DIMENSIONS: z.coerce
    .number()
    .int()
    .refine((value) => value === EMBEDDING_DIMENSIONS, {
      message: `GEMINI_EMBEDDING_DIMENSIONS must be ${EMBEDDING_DIMENSIONS} to match the database vector index`,
    })
    .default(DEFAULT_GEMINI_EMBEDDING_DIMENSIONS),
  GEMINI_CHAT_MODEL: z
    .preprocess(emptyStringToUndefined, z.string().trim().min(1).optional())
    .default(DEFAULT_GEMINI_CHAT_MODEL),
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
  OLLAMA_BASE_URL: z
    .preprocess(emptyStringToUndefined, z.string().trim().url().optional())
    .default(DEFAULT_OLLAMA_BASE_URL)
    .transform((url) => url.replace(/\/+$/, '')),
  OLLAMA_EMBEDDING_MODEL: z
    .preprocess(emptyStringToUndefined, z.string().trim().min(1).optional())
    .default(DEFAULT_OLLAMA_EMBEDDING_MODEL),
  OLLAMA_EMBEDDING_DIMENSIONS: z.coerce
    .number()
    .int()
    .refine((value) => value === EMBEDDING_DIMENSIONS, {
      message: `OLLAMA_EMBEDDING_DIMENSIONS must be ${EMBEDDING_DIMENSIONS} to avoid mixing incompatible embeddings in the database vector index`,
    })
    .default(DEFAULT_OLLAMA_EMBEDDING_DIMENSIONS),
  OLLAMA_CHAT_MODEL: z
    .preprocess(emptyStringToUndefined, z.string().trim().min(1).optional())
    .default(DEFAULT_OLLAMA_CHAT_MODEL),
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
  AI_EMBEDDING_BATCH_SIZE: z.preprocess(
    emptyStringToUndefined,
    z.coerce.number().int().min(1).max(2048).optional(),
  ),
  AI_EMBEDDING_BATCH_DELAY_MS: z.coerce
    .number()
    .int()
    .min(0)
    .max(60_000)
    .default(DEFAULT_AI_EMBEDDING_BATCH_DELAY_MS),
});

export interface AIConfig {
  /** Mirrors llmProvider for backwards compatibility with callers reading config.provider. */
  provider: AIProviderType;
  llmProvider: LLMProviderType;
  embeddingProvider: EmbeddingProviderType;
  groq: {
    apiKey?: string;
    baseUrl: string;
    chatModel: string;
  };
  gemini: {
    apiKey?: string;
    baseUrl: string;
    embeddingModel: string;
    embeddingDimensions: number;
    embeddingBatchSize: number;
    chatModel: string;
  };
  openai: {
    apiKey?: string;
    baseUrl: string;
    embeddingModel: string;
    embeddingDimensions: number;
    chatModel: string;
  };
  ollama: {
    baseUrl: string;
    embeddingModel: string;
    embeddingDimensions: number;
    chatModel: string;
  };
  requestTimeoutMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
  embeddingBatchSize: number;
  embeddingBatchDelayMs: number;
}

/**
 * Returns whether the selected LLM provider has the credentials required to initialize.
 */
export function hasLLMCredentials(config: AIConfig): boolean {
  switch (config.llmProvider) {
    case 'ollama':
      return true;
    case 'groq':
      return Boolean(config.groq.apiKey);
    case 'gemini':
      return Boolean(config.gemini.apiKey);
    case 'openai':
      return Boolean(config.openai.apiKey);
  }
}

/**
 * Returns whether the selected embedding provider has the credentials required to initialize.
 */
export function hasEmbeddingCredentials(config: AIConfig): boolean {
  switch (config.embeddingProvider) {
    case 'none':
      return false;
    case 'ollama':
      return true;
    case 'gemini':
      return Boolean(config.gemini.apiKey);
    case 'openai':
      return Boolean(config.openai.apiKey);
  }
}

/**
 * Returns whether both the selected LLM and embedding providers have required credentials.
 */
export function hasProviderCredentials(config: AIConfig): boolean {
  return hasLLMCredentials(config) && hasEmbeddingCredentials(config);
}

/**
 * Parses and validates centralized AI provider configuration from environment variables.
 * API keys remain optional at parse time so tests and non-AI endpoints can start
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

  const llmProvider: LLMProviderType =
    parsed.data.AI_LLM_PROVIDER ??
    parsed.data.AI_PROVIDER ??
    DEFAULT_LLM_PROVIDER;

  let embeddingProvider: EmbeddingProviderType;
  if (parsed.data.AI_EMBEDDING_PROVIDER !== undefined) {
    embeddingProvider = parsed.data.AI_EMBEDDING_PROVIDER;
  } else if (parsed.data.AI_PROVIDER !== undefined) {
    embeddingProvider =
      parsed.data.AI_PROVIDER !== 'groq'
        ? parsed.data.AI_PROVIDER
        : DEFAULT_EMBEDDING_PROVIDER;
  } else {
    embeddingProvider = parsed.data.GEMINI_API_KEY
      ? 'gemini'
      : DEFAULT_EMBEDDING_PROVIDER;
  }

  return {
    provider: llmProvider,
    llmProvider,
    embeddingProvider,
    groq: {
      apiKey: parsed.data.GROQ_API_KEY,
      baseUrl: parsed.data.GROQ_BASE_URL,
      chatModel: parsed.data.GROQ_CHAT_MODEL,
    },
    gemini: {
      apiKey: parsed.data.GEMINI_API_KEY,
      baseUrl: parsed.data.GEMINI_BASE_URL,
      embeddingModel: parsed.data.GEMINI_EMBEDDING_MODEL,
      embeddingDimensions: parsed.data.GEMINI_EMBEDDING_DIMENSIONS,
      embeddingBatchSize:
        parsed.data.AI_EMBEDDING_BATCH_SIZE ??
        DEFAULT_GEMINI_EMBEDDING_BATCH_SIZE,
      chatModel: parsed.data.GEMINI_CHAT_MODEL,
    },
    openai: {
      apiKey: parsed.data.OPENAI_API_KEY,
      baseUrl: parsed.data.OPENAI_BASE_URL,
      embeddingModel: parsed.data.OPENAI_EMBEDDING_MODEL,
      embeddingDimensions: parsed.data.OPENAI_EMBEDDING_DIMENSIONS,
      chatModel: parsed.data.OPENAI_CHAT_MODEL,
    },
    ollama: {
      baseUrl: parsed.data.OLLAMA_BASE_URL,
      embeddingModel: parsed.data.OLLAMA_EMBEDDING_MODEL,
      embeddingDimensions: parsed.data.OLLAMA_EMBEDDING_DIMENSIONS,
      chatModel: parsed.data.OLLAMA_CHAT_MODEL,
    },
    requestTimeoutMs: parsed.data.AI_REQUEST_TIMEOUT_MS,
    maxRetries: parsed.data.AI_MAX_RETRIES,
    retryBaseDelayMs: parsed.data.AI_RETRY_BASE_DELAY_MS,
    embeddingBatchSize:
      parsed.data.AI_EMBEDDING_BATCH_SIZE ?? DEFAULT_AI_EMBEDDING_BATCH_SIZE,
    embeddingBatchDelayMs: parsed.data.AI_EMBEDDING_BATCH_DELAY_MS,
  };
}
