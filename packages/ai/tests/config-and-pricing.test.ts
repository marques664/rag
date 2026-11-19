import { describe, expect, it } from 'vitest';
import {
  AIProviderNotConfiguredError,
  createEmbeddingProvider,
  createLLMProvider,
  DEFAULT_OPENAI_CHAT_MODEL,
  DEFAULT_OPENAI_EMBEDDING_DIMENSIONS,
  DEFAULT_OPENAI_EMBEDDING_MODEL,
  estimateModelCostUsd,
  loadAIConfig,
} from '../src/index.js';

describe('AI config, factories, and pricing', () => {
  it('loads defaults cleanly even when OPENAI_API_KEY is unset', () => {
    const config = loadAIConfig({});

    expect(config.provider).toBe('openai');
    expect(config.openai.apiKey).toBeUndefined();
    expect(config.openai.baseUrl).toBe('https://api.openai.com/v1');
    expect(config.openai.embeddingModel).toBe(DEFAULT_OPENAI_EMBEDDING_MODEL);
    expect(config.openai.embeddingDimensions).toBe(
      DEFAULT_OPENAI_EMBEDDING_DIMENSIONS,
    );
    expect(config.openai.chatModel).toBe(DEFAULT_OPENAI_CHAT_MODEL);
    expect(config.requestTimeoutMs).toBe(30_000);
    expect(config.maxRetries).toBe(3);
    expect(config.retryBaseDelayMs).toBe(500);
    expect(config.embeddingBatchSize).toBe(64);
  });

  it('rejects incompatible embedding dimensions to protect the pgvector index', () => {
    expect(() =>
      loadAIConfig({
        OPENAI_EMBEDDING_DIMENSIONS: '768',
      }),
    ).toThrow(/1536/);
  });

  it('normalizes trailing slashes on OPENAI_BASE_URL and blank API keys', () => {
    const config = loadAIConfig({
      OPENAI_API_KEY: '   ',
      OPENAI_BASE_URL: 'https://proxy.example.com/v1///',
    });

    expect(config.openai.apiKey).toBeUndefined();
    expect(config.openai.baseUrl).toBe('https://proxy.example.com/v1');
  });

  it('throws AIProviderNotConfiguredError from factories when OPENAI_API_KEY is missing', () => {
    const config = loadAIConfig({});

    expect(() => createEmbeddingProvider(config)).toThrow(
      AIProviderNotConfiguredError,
    );
    expect(() => createLLMProvider(config)).toThrow(
      AIProviderNotConfiguredError,
    );
  });

  it('creates configured providers via factories when OPENAI_API_KEY is present', () => {
    const config = loadAIConfig({
      OPENAI_API_KEY: 'sk-test-valid-1234567890',
      OPENAI_CHAT_MODEL: 'gpt-4o',
    });

    const embeddingProvider = createEmbeddingProvider(config);
    const llmProvider = createLLMProvider(config);

    expect(embeddingProvider.providerName).toBe('openai');
    expect(embeddingProvider.model).toBe('text-embedding-3-small');
    expect(embeddingProvider.dimensions).toBe(1536);
    expect(llmProvider.providerName).toBe('openai');
    expect(llmProvider.model).toBe('gpt-4o');
  });

  it('estimates USD cost for known and dated-snapshot models and returns null for unknown models', () => {
    const embedCost = estimateModelCostUsd({
      model: 'text-embedding-3-small',
      inputTokens: 1_000_000,
    });
    expect(embedCost).toBe(0.02);

    const chatCost = estimateModelCostUsd({
      model: 'gpt-4o-mini-2024-07-18',
      inputTokens: 100_000,
      outputTokens: 50_000,
    });
    expect(chatCost).toBe(0.045);

    expect(
      estimateModelCostUsd({
        model: 'custom-local-llama',
        inputTokens: 500,
        outputTokens: 100,
      }),
    ).toBeNull();

    expect(
      estimateModelCostUsd({
        model: 'gpt-4o-mini',
        inputTokens: -1,
        outputTokens: 10,
      }),
    ).toBeNull();
  });
});
