import type { AIConfig } from '../config/ai-config.js';
import { GeminiEmbeddingProvider } from '../embeddings/gemini-embedding.provider.js';
import { OllamaEmbeddingProvider } from '../embeddings/ollama-embedding.provider.js';
import { OpenAIEmbeddingProvider } from '../embeddings/openai-embedding.provider.js';
import type { EmbeddingProvider } from '../embeddings/types.js';
import { AIProviderNotConfiguredError } from '../errors/ai-error.js';
import { GeminiLLMProvider } from '../generation/gemini-llm.provider.js';
import { GroqLLMProvider } from '../generation/groq-llm.provider.js';
import { OllamaLLMProvider } from '../generation/ollama-llm.provider.js';
import { OpenAILLMProvider } from '../generation/openai-llm.provider.js';
import type { LLMProvider } from '../generation/types.js';
import type { FetchLike, SleepLike } from './http-client.js';

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
  if (config.embeddingProvider === 'none') {
    throw new AIProviderNotConfiguredError(
      'embedding',
      'Embedding provider is disabled (AI_EMBEDDING_PROVIDER=none); configure gemini, openai, or ollama to enable vector embeddings',
    );
  }

  if ((config.embeddingProvider as string) === 'groq') {
    throw new AIProviderNotConfiguredError(
      'groq',
      'Groq does not provide an embeddings endpoint; configure AI_EMBEDDING_PROVIDER to gemini, openai, or ollama',
    );
  }

  if (config.embeddingProvider === 'gemini') {
    if (!config.gemini.apiKey) {
      throw new AIProviderNotConfiguredError(
        'gemini',
        'GEMINI_API_KEY must be set to initialize GeminiEmbeddingProvider',
      );
    }

    return new GeminiEmbeddingProvider({
      apiKey: config.gemini.apiKey,
      baseUrl: config.gemini.baseUrl,
      model: config.gemini.embeddingModel,
      dimensions: config.gemini.embeddingDimensions,
      batchSize: config.embeddingBatchSize,
      timeoutMs: config.requestTimeoutMs,
      maxRetries: config.maxRetries,
      retryBaseDelayMs: config.retryBaseDelayMs,
      fetchImpl: overrides?.fetchImpl,
      sleepImpl: overrides?.sleepImpl,
    });
  }

  if (config.embeddingProvider === 'openai') {
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

  if (config.embeddingProvider === 'ollama') {
    return new OllamaEmbeddingProvider({
      baseUrl: config.ollama.baseUrl,
      model: config.ollama.embeddingModel,
      dimensions: config.ollama.embeddingDimensions,
      batchSize: config.embeddingBatchSize,
      timeoutMs: config.requestTimeoutMs,
      maxRetries: config.maxRetries,
      retryBaseDelayMs: config.retryBaseDelayMs,
      fetchImpl: overrides?.fetchImpl,
      sleepImpl: overrides?.sleepImpl,
    });
  }

  throw new AIProviderNotConfiguredError(
    config.embeddingProvider,
    `Unsupported embedding provider: ${String(config.embeddingProvider)}`,
  );
}

/**
 * Instantiates the configured LLMProvider from centralized AIConfig.
 */
export function createLLMProvider(
  config: AIConfig,
  overrides?: ProviderFactoryOverrides,
): LLMProvider {
  if (config.llmProvider === 'groq') {
    if (!config.groq.apiKey) {
      throw new AIProviderNotConfiguredError(
        'groq',
        'GROQ_API_KEY must be set to initialize GroqLLMProvider',
      );
    }

    return new GroqLLMProvider({
      apiKey: config.groq.apiKey,
      baseUrl: config.groq.baseUrl,
      model: config.groq.chatModel,
      timeoutMs: config.requestTimeoutMs,
      maxRetries: config.maxRetries,
      retryBaseDelayMs: config.retryBaseDelayMs,
      fetchImpl: overrides?.fetchImpl,
      sleepImpl: overrides?.sleepImpl,
    });
  }

  if (config.llmProvider === 'gemini') {
    if (!config.gemini.apiKey) {
      throw new AIProviderNotConfiguredError(
        'gemini',
        'GEMINI_API_KEY must be set to initialize GeminiLLMProvider',
      );
    }

    return new GeminiLLMProvider({
      apiKey: config.gemini.apiKey,
      baseUrl: config.gemini.baseUrl,
      model: config.gemini.chatModel,
      timeoutMs: config.requestTimeoutMs,
      maxRetries: config.maxRetries,
      retryBaseDelayMs: config.retryBaseDelayMs,
      fetchImpl: overrides?.fetchImpl,
      sleepImpl: overrides?.sleepImpl,
    });
  }

  if (config.llmProvider === 'openai') {
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

  if (config.llmProvider === 'ollama') {
    return new OllamaLLMProvider({
      baseUrl: config.ollama.baseUrl,
      model: config.ollama.chatModel,
      timeoutMs: config.requestTimeoutMs,
      maxRetries: config.maxRetries,
      retryBaseDelayMs: config.retryBaseDelayMs,
      fetchImpl: overrides?.fetchImpl,
      sleepImpl: overrides?.sleepImpl,
    });
  }

  throw new AIProviderNotConfiguredError(
    config.llmProvider,
    `Unsupported LLM provider: ${String(config.llmProvider)}`,
  );
}
