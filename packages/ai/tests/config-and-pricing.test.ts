import { describe, expect, it } from 'vitest';
import {
  AIProviderNotConfiguredError,
  createEmbeddingProvider,
  createLLMProvider,
  DEFAULT_AI_PROVIDER,
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
  DEFAULT_OLLAMA_EMBEDDING_MODEL,
  DEFAULT_OPENAI_CHAT_MODEL,
  DEFAULT_OPENAI_EMBEDDING_DIMENSIONS,
  DEFAULT_OPENAI_EMBEDDING_MODEL,
  estimateModelCostUsd,
  hasEmbeddingCredentials,
  hasLLMCredentials,
  hasProviderCredentials,
  loadAIConfig,
} from '../src/index.js';

describe('AI config, factories, and pricing', () => {
  it('defaults to Groq for LLM and none for embeddings even when API keys are unset', () => {
    const config = loadAIConfig({});

    expect(DEFAULT_LLM_PROVIDER).toBe('groq');
    expect(DEFAULT_EMBEDDING_PROVIDER).toBe('none');
    expect(DEFAULT_AI_PROVIDER).toBe('groq');
    expect(config.provider).toBe('groq');
    expect(config.llmProvider).toBe('groq');
    expect(config.embeddingProvider).toBe('none');

    expect(config.groq.apiKey).toBeUndefined();
    expect(config.groq.baseUrl).toBe(DEFAULT_GROQ_BASE_URL);
    expect(config.groq.chatModel).toBe(DEFAULT_GROQ_CHAT_MODEL);

    expect(config.gemini.apiKey).toBeUndefined();
    expect(config.gemini.baseUrl).toBe(DEFAULT_GEMINI_BASE_URL);
    expect(config.gemini.embeddingModel).toBe(DEFAULT_GEMINI_EMBEDDING_MODEL);
    expect(config.gemini.embeddingDimensions).toBe(
      DEFAULT_GEMINI_EMBEDDING_DIMENSIONS,
    );
    expect(config.gemini.chatModel).toBe(DEFAULT_GEMINI_CHAT_MODEL);

    expect(config.openai.apiKey).toBeUndefined();
    expect(config.openai.baseUrl).toBe('https://api.openai.com/v1');
    expect(config.openai.embeddingModel).toBe(DEFAULT_OPENAI_EMBEDDING_MODEL);
    expect(config.openai.embeddingDimensions).toBe(
      DEFAULT_OPENAI_EMBEDDING_DIMENSIONS,
    );
    expect(config.openai.chatModel).toBe(DEFAULT_OPENAI_CHAT_MODEL);
    expect(config.ollama.baseUrl).toBe(DEFAULT_OLLAMA_BASE_URL);
    expect(config.ollama.embeddingModel).toBe(DEFAULT_OLLAMA_EMBEDDING_MODEL);
    expect(config.ollama.embeddingDimensions).toBe(1536);
    expect(config.ollama.chatModel).toBe(DEFAULT_OLLAMA_CHAT_MODEL);
    expect(config.requestTimeoutMs).toBe(30_000);
    expect(config.maxRetries).toBe(3);
    expect(config.retryBaseDelayMs).toBe(500);
    expect(config.embeddingBatchSize).toBe(64);
  });

  it('supports AI_PROVIDER backwards-compatibility and explicit AI_LLM_PROVIDER / AI_EMBEDDING_PROVIDER split', () => {
    const groqShortcut = loadAIConfig({ AI_PROVIDER: 'groq' });
    expect(groqShortcut.llmProvider).toBe('groq');
    expect(groqShortcut.embeddingProvider).toBe('none');

    const geminiShortcut = loadAIConfig({ AI_PROVIDER: 'gemini' });
    expect(geminiShortcut.llmProvider).toBe('gemini');
    expect(geminiShortcut.embeddingProvider).toBe('gemini');

    const openaiShortcut = loadAIConfig({ AI_PROVIDER: 'openai' });
    expect(openaiShortcut.llmProvider).toBe('openai');
    expect(openaiShortcut.embeddingProvider).toBe('openai');

    const ollamaShortcut = loadAIConfig({ AI_PROVIDER: 'ollama' });
    expect(ollamaShortcut.llmProvider).toBe('ollama');
    expect(ollamaShortcut.embeddingProvider).toBe('ollama');

    const splitConfig = loadAIConfig({
      AI_PROVIDER: 'openai',
      AI_LLM_PROVIDER: 'groq',
      AI_EMBEDDING_PROVIDER: 'ollama',
    });
    expect(splitConfig.llmProvider).toBe('groq');
    expect(splitConfig.embeddingProvider).toBe('ollama');
    expect(splitConfig.provider).toBe('groq');

    const groqPlusGemini = loadAIConfig({
      AI_EMBEDDING_PROVIDER: 'gemini',
    });
    expect(groqPlusGemini.llmProvider).toBe('groq');
    expect(groqPlusGemini.embeddingProvider).toBe('gemini');

    expect(() =>
      loadAIConfig({ AI_EMBEDDING_PROVIDER: 'groq' }),
    ).toThrow(/Invalid AI provider configuration/);
  });

  it('rejects incompatible embedding dimensions across all providers to protect the pgvector index', () => {
    expect(() =>
      loadAIConfig({
        GEMINI_EMBEDDING_DIMENSIONS: '768',
      }),
    ).toThrow(/1536/);

    expect(() =>
      loadAIConfig({
        AI_PROVIDER: 'openai',
        OPENAI_EMBEDDING_DIMENSIONS: '768',
      }),
    ).toThrow(/1536/);

    expect(() =>
      loadAIConfig({
        AI_PROVIDER: 'ollama',
        OLLAMA_EMBEDDING_DIMENSIONS: '768',
      }),
    ).toThrow(/1536/);
  });

  it('evaluates hasLLMCredentials, hasEmbeddingCredentials, and hasProviderCredentials', () => {
    expect(hasLLMCredentials(loadAIConfig({}))).toBe(false);
    expect(hasEmbeddingCredentials(loadAIConfig({}))).toBe(false);
    expect(hasProviderCredentials(loadAIConfig({}))).toBe(false);

    const onlyGroq = loadAIConfig({
      GROQ_API_KEY: 'gsk_test_1234567890',
      GEMINI_API_KEY: 'AIzaTestKey123456789012345',
    });
    expect(hasLLMCredentials(onlyGroq)).toBe(true);
    expect(hasEmbeddingCredentials(onlyGroq)).toBe(false);
    expect(hasProviderCredentials(onlyGroq)).toBe(false);

    const groqPlusGemini = loadAIConfig({
      AI_EMBEDDING_PROVIDER: 'gemini',
      GROQ_API_KEY: 'gsk_test_1234567890',
      GEMINI_API_KEY: 'AIzaTestKey123456789012345',
    });
    expect(hasLLMCredentials(groqPlusGemini)).toBe(true);
    expect(hasEmbeddingCredentials(groqPlusGemini)).toBe(true);
    expect(hasProviderCredentials(groqPlusGemini)).toBe(true);

    const groqPlusOpenAI = loadAIConfig({
      AI_EMBEDDING_PROVIDER: 'openai',
      GROQ_API_KEY: 'gsk_test_1234567890',
      OPENAI_API_KEY: 'sk-test-1234567890',
    });
    expect(hasLLMCredentials(groqPlusOpenAI)).toBe(true);
    expect(hasEmbeddingCredentials(groqPlusOpenAI)).toBe(true);
    expect(hasProviderCredentials(groqPlusOpenAI)).toBe(true);

    const ollamaBoth = loadAIConfig({ AI_PROVIDER: 'ollama' });
    expect(hasLLMCredentials(ollamaBoth)).toBe(true);
    expect(hasEmbeddingCredentials(ollamaBoth)).toBe(true);
    expect(hasProviderCredentials(ollamaBoth)).toBe(true);
  });

  it('creates default Groq LLM when key is present, rejects disabled embeddings, and creates explicit embedding providers', () => {
    const missing = loadAIConfig({});
    expect(() => createLLMProvider(missing)).toThrow(
      AIProviderNotConfiguredError,
    );
    expect(() => createEmbeddingProvider(missing)).toThrow(
      AIProviderNotConfiguredError,
    );

    const configured = loadAIConfig({
      AI_EMBEDDING_PROVIDER: 'gemini',
      GROQ_API_KEY: 'gsk_test_1234567890',
      GROQ_BASE_URL: 'https://api.groq.com/openai/v1///',
      GEMINI_API_KEY: 'AIzaTestKey123456789012345',
    });
    expect(configured.groq.baseUrl).toBe('https://api.groq.com/openai/v1');

    const llmProvider = createLLMProvider(configured);
    const embeddingProvider = createEmbeddingProvider(configured);

    expect(llmProvider.providerName).toBe('groq');
    expect(llmProvider.model).toBe('qwen/qwen3.8-27b');
    expect(embeddingProvider.providerName).toBe('gemini');
    expect(embeddingProvider.model).toBe('gemini-embedding-001');
    expect(embeddingProvider.dimensions).toBe(1536);

    // Explicitly passing invalid embeddingProvider: 'groq' throws AIProviderNotConfiguredError
    const invalidEmbedConfig = {
      ...configured,
      embeddingProvider: 'groq' as unknown as typeof configured.embeddingProvider,
    };
    expect(() => createEmbeddingProvider(invalidEmbedConfig)).toThrow(
      AIProviderNotConfiguredError,
    );
  });

  it('creates Gemini LLM + Embedding providers when AI_PROVIDER=gemini', () => {
    const configured = loadAIConfig({
      AI_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'AIzaTestKey123456789012345',
      GEMINI_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta///',
      GEMINI_CHAT_MODEL: 'gemini-2.5-pro',
    });

    expect(configured.gemini.baseUrl).toBe(
      'https://generativelanguage.googleapis.com/v1beta',
    );
    const embeddingProvider = createEmbeddingProvider(configured);
    const llmProvider = createLLMProvider(configured);

    expect(embeddingProvider.providerName).toBe('gemini');
    expect(embeddingProvider.model).toBe('gemini-embedding-001');
    expect(embeddingProvider.dimensions).toBe(1536);
    expect(llmProvider.providerName).toBe('gemini');
    expect(llmProvider.model).toBe('gemini-2.5-pro');
  });

  it('creates Ollama providers via factories without requiring API keys', () => {
    const config = loadAIConfig({
      AI_PROVIDER: 'ollama',
      OLLAMA_BASE_URL: 'http://127.0.0.1:11434///',
      OLLAMA_EMBEDDING_MODEL: 'nomic-embed-text',
      OLLAMA_CHAT_MODEL: 'llama3.1:8b',
    });

    expect(config.ollama.baseUrl).toBe('http://127.0.0.1:11434');
    const embeddingProvider = createEmbeddingProvider(config);
    const llmProvider = createLLMProvider(config);

    expect(embeddingProvider.providerName).toBe('ollama');
    expect(embeddingProvider.model).toBe('nomic-embed-text');
    expect(embeddingProvider.dimensions).toBe(1536);
    expect(llmProvider.providerName).toBe('ollama');
    expect(llmProvider.model).toBe('llama3.1:8b');
  });

  it('normalizes trailing slashes on OPENAI_BASE_URL and blank API keys', () => {
    const config = loadAIConfig({
      AI_PROVIDER: 'openai',
      GROQ_API_KEY: '   ',
      GEMINI_API_KEY: '   ',
      OPENAI_API_KEY: '   ',
      OPENAI_BASE_URL: 'https://proxy.example.com/v1///',
    });

    expect(config.groq.apiKey).toBeUndefined();
    expect(config.gemini.apiKey).toBeUndefined();
    expect(config.openai.apiKey).toBeUndefined();
    expect(config.openai.baseUrl).toBe('https://proxy.example.com/v1');
  });

  it('throws AIProviderNotConfiguredError from factories when OPENAI_API_KEY is missing', () => {
    const config = loadAIConfig({ AI_PROVIDER: 'openai' });

    expect(() => createEmbeddingProvider(config)).toThrow(
      AIProviderNotConfiguredError,
    );
    expect(() => createLLMProvider(config)).toThrow(
      AIProviderNotConfiguredError,
    );
  });

  it('creates configured OpenAI providers via factories when AI_PROVIDER=openai and OPENAI_API_KEY is present', () => {
    const config = loadAIConfig({
      AI_PROVIDER: 'openai',
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

  it('estimates USD cost for Groq, Gemini, and OpenAI models and returns null for unknown models', () => {
    expect(
      estimateModelCostUsd({
        model: 'llama-3.3-70b-versatile',
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBe(1.38);

    expect(
      estimateModelCostUsd({
        model: 'llama-3.1-8b-instant',
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBe(0.13);

    expect(
      estimateModelCostUsd({
        model: 'mixtral-8x7b-32768',
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBe(0.48);

    expect(
      estimateModelCostUsd({
        model: 'gemini-embedding-001',
        inputTokens: 1_000_000,
      }),
    ).toBe(0.15);

    expect(
      estimateModelCostUsd({
        model: 'models/gemini-2.5-flash',
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBe(2.8);

    expect(
      estimateModelCostUsd({
        model: 'gemini-2.5-pro',
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBe(11.25);

    expect(
      estimateModelCostUsd({
        model: 'gemini-2.0-flash',
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBe(0.5);

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
