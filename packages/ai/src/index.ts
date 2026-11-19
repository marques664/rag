export {
  DEFAULT_AI_EMBEDDING_BATCH_SIZE,
  DEFAULT_AI_MAX_RETRIES,
  DEFAULT_AI_PROVIDER,
  DEFAULT_AI_REQUEST_TIMEOUT_MS,
  DEFAULT_AI_RETRY_BASE_DELAY_MS,
  DEFAULT_EMBEDDING_PROVIDER,
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_GEMINI_CHAT_MODEL,
  DEFAULT_GEMINI_EMBEDDING_DIMENSIONS,
  DEFAULT_GEMINI_EMBEDDING_MODEL,
  DEFAULT_GROQ_BASE_URL,
  DEFAULT_GROQ_CHAT_MODEL,
  DEFAULT_LLM_PROVIDER,
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_CHAT_MODEL,
  DEFAULT_OLLAMA_EMBEDDING_DIMENSIONS,
  DEFAULT_OLLAMA_EMBEDDING_MODEL,
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_OPENAI_CHAT_MODEL,
  DEFAULT_OPENAI_EMBEDDING_DIMENSIONS,
  DEFAULT_OPENAI_EMBEDDING_MODEL,
  hasEmbeddingCredentials,
  hasLLMCredentials,
  hasProviderCredentials,
  loadAIConfig,
  SUPPORTED_AI_PROVIDERS,
  SUPPORTED_EMBEDDING_PROVIDERS,
  SUPPORTED_LLM_PROVIDERS,
} from './config/ai-config.js';
export type {
  AIConfig,
  AIProviderType,
  EmbeddingProviderType,
  LLMProviderType,
} from './config/ai-config.js';

export { GeminiEmbeddingProvider } from './embeddings/gemini-embedding.provider.js';
export type { GeminiEmbeddingProviderOptions } from './embeddings/gemini-embedding.provider.js';
export { OllamaEmbeddingProvider } from './embeddings/ollama-embedding.provider.js';
export type { OllamaEmbeddingProviderOptions } from './embeddings/ollama-embedding.provider.js';
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

export { GeminiLLMProvider } from './generation/gemini-llm.provider.js';
export type { GeminiLLMProviderOptions } from './generation/gemini-llm.provider.js';
export { GroqLLMProvider } from './generation/groq-llm.provider.js';
export type { GroqLLMProviderOptions } from './generation/groq-llm.provider.js';
export { OllamaLLMProvider } from './generation/ollama-llm.provider.js';
export type { OllamaLLMProviderOptions } from './generation/ollama-llm.provider.js';
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
export type { GeminiClientOptions } from './providers/gemini-http.js';
export { GeminiHttpClient } from './providers/gemini-http.js';
export type {
  FetchLike,
  JsonHttpClientOptions,
  SleepLike,
} from './providers/http-client.js';
export { JsonHttpClient } from './providers/http-client.js';
export type { OllamaClientOptions } from './providers/ollama-http.js';
export { OllamaHttpClient } from './providers/ollama-http.js';
export type { OpenAIClientOptions } from './providers/openai-http.js';
export { OpenAIHttpClient } from './providers/openai-http.js';
export { estimateModelCostUsd } from './providers/pricing.js';
export type {
  EstimateModelCostInput,
  ModelPricingPerMillionUsd,
} from './providers/pricing.js';

export { HybridLexicalReranker } from './reranking/hybrid-lexical-reranker.js';
export type { HybridLexicalRerankerOptions } from './reranking/hybrid-lexical-reranker.js';
export type {
  RerankerService,
  RerankResult,
  RerankScoreBreakdown,
} from './reranking/types.js';
export {
  computePrecisionAtK,
  computeRecallAtK,
  computeReciprocalRank,
  summarizeStrategyBenchmark,
} from './evaluation/retrieval-metrics.js';
export type {
  CaseRetrievalMetrics,
  RetrievalEvaluationCase,
  StrategyBenchmarkSummary,
  StrategyRetrievalRun,
} from './evaluation/retrieval-metrics.js';
