export {
  DEFAULT_AI_EMBEDDING_BATCH_SIZE,
  DEFAULT_AI_MAX_RETRIES,
  DEFAULT_AI_PROVIDER,
  DEFAULT_AI_REQUEST_TIMEOUT_MS,
  DEFAULT_AI_RETRY_BASE_DELAY_MS,
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_OPENAI_CHAT_MODEL,
  DEFAULT_OPENAI_EMBEDDING_DIMENSIONS,
  DEFAULT_OPENAI_EMBEDDING_MODEL,
  loadAIConfig,
  SUPPORTED_AI_PROVIDERS,
} from './config/ai-config.js';
export type { AIConfig, AIProviderType } from './config/ai-config.js';

export {
  OpenAIEmbeddingProvider,
  validateEmbeddingVector,
} from './embeddings/openai-embedding.provider.js';
export type { OpenAIEmbeddingProviderOptions } from './embeddings/openai-embedding.provider.js';
export type {
  BatchEmbeddingResult,
  EmbeddingProvider,
  EmbeddingRequestOptions,
  EmbeddingResult,
  EmbeddingUsage,
} from './embeddings/types.js';

export {
  AIAbortedError,
  AIAuthenticationError,
  AIInvalidRequestError,
  AIInvalidResponseError,
  AIProviderError,
  AIProviderNotConfiguredError,
  AIRateLimitError,
  AITimeoutError,
  AIUpstreamError,
  redactProviderSecrets,
} from './errors/ai-error.js';
export type { AIErrorCode, AIProviderErrorOptions } from './errors/ai-error.js';

export { OpenAILLMProvider } from './generation/openai-llm.provider.js';
export type { OpenAILLMProviderOptions } from './generation/openai-llm.provider.js';
export type {
  LLMGenerateRequest,
  LLMGenerateResult,
  LLMMessage,
  LLMMessageRole,
  LLMProvider,
  LLMResponseFormat,
  LLMUsage,
} from './generation/types.js';

export {
  createEmbeddingProvider,
  createLLMProvider,
} from './providers/factory.js';
export type { ProviderFactoryOverrides } from './providers/factory.js';
export type { FetchLike, OpenAIClientOptions, SleepLike } from './providers/openai-http.js';
export { estimateModelCostUsd } from './providers/pricing.js';
export type {
  EstimateModelCostInput,
  ModelPricingPerMillionUsd,
} from './providers/pricing.js';
