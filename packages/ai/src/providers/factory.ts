import type { AIConfig } from '../config/ai-config.js';
import { OpenAIEmbeddingProvider } from '../embeddings/openai-embedding.provider.js';
import type { EmbeddingProvider } from '../embeddings/types.js';
import { AIProviderNotConfiguredError } from '../errors/ai-error.js';
import { OpenAILLMProvider } from '../generation/openai-llm.provider.js';
import type { LLMProvider } from '../generation/types.js';
import type { FetchLike, SleepLike } from './openai-http.js';

export interface ProviderFactoryOverrides {
  fetchImpl?: FetchLike;
  sleepImpl?: SleepLike;
}

/**
 * Instantiates the configured EmbeddingProvider from centralized AIConfig.
 */
export function createEmbeddingProvider(
  config: AIConfig,
  overrides?: ProviderFactoryOverrides,
): EmbeddingProvider {
  if (config.provider === 'openai') {
    if (!config.openai.apiKey) {
      throw new AIProviderNotConfiguredError(
        'openai',
        'OPENAI_API_KEY must be set to initialize OpenAIEmbeddingProvider',
      );
    }

    return new OpenAIEmbeddingProvider({
      apiKey: config.openai.apiKey,
      baseUrl: config.openai.baseUrl,
      model: config.openai.embeddingModel,
      dimensions: config.openai.embeddingDimensions,
      batchSize: config.embeddingBatchSize,
      timeoutMs: config.requestTimeoutMs,
      maxRetries: config.maxRetries,
      retryBaseDelayMs: config.retryBaseDelayMs,
      fetchImpl: overrides?.fetchImpl,
      sleepImpl: overrides?.sleepImpl,
    });
  }

  throw new AIProviderNotConfiguredError(
    config.provider,
    `Unsupported embedding provider: ${String(config.provider)}`,
  );
}

/**
 * Instantiates the configured LLMProvider from centralized AIConfig.
 */
export function createLLMProvider(
  config: AIConfig,
  overrides?: ProviderFactoryOverrides,
): LLMProvider {
  if (config.provider === 'openai') {
    if (!config.openai.apiKey) {
      throw new AIProviderNotConfiguredError(
        'openai',
        'OPENAI_API_KEY must be set to initialize OpenAILLMProvider',
      );
    }

    return new OpenAILLMProvider({
      apiKey: config.openai.apiKey,
      baseUrl: config.openai.baseUrl,
      model: config.openai.chatModel,
      timeoutMs: config.requestTimeoutMs,
      maxRetries: config.maxRetries,
      retryBaseDelayMs: config.retryBaseDelayMs,
      fetchImpl: overrides?.fetchImpl,
      sleepImpl: overrides?.sleepImpl,
    });
  }

  throw new AIProviderNotConfiguredError(
    config.provider,
    `Unsupported LLM provider: ${String(config.provider)}`,
  );
}
