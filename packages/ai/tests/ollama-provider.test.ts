import { describe, expect, it, vi } from 'vitest';
import {
  AIInvalidRequestError,
  AIInvalidResponseError,
  AITimeoutError,
  AIUpstreamError,
  DEFAULT_OLLAMA_EMBEDDING_DIMENSIONS,
  OllamaEmbeddingProvider,
  OllamaLLMProvider,
} from '../src/index.js';

function makeVector(
  seed: number,
  length = DEFAULT_OLLAMA_EMBEDDING_DIMENSIONS,
): number[] {
  return Array.from({ length }, (_, idx) => (seed + idx) * 0.001);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('OllamaEmbeddingProvider and OllamaLLMProvider', () => {
  it('embeds single query and batched documents via /api/embed', async () => {
    const vec0 = makeVector(1);
    const vec1 = makeVector(2);
    const vec2 = makeVector(3);

    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          model: 'nomic-embed-text',
          embeddings: [vec0],
          prompt_eval_count: 6,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          model: 'nomic-embed-text',
          embeddings: [vec1, vec2],
          prompt_eval_count: 14,
        }),
      );

    const provider = new OllamaEmbeddingProvider({
      baseUrl: 'http://localhost:11434',
      model: 'nomic-embed-text',
      batchSize: 2,
      fetchImpl,
      sleepImpl: async () => {},
    });

    const queryResult = await provider.embedQuery('maintenance policy');
    expect(queryResult.embedding).toEqual(vec0);
    expect(queryResult.dimensions).toBe(1536);
    expect(queryResult.usage).toEqual({ inputTokens: 6, totalTokens: 6 });

    const batchResult = await provider.embedDocuments(['chunk a', 'chunk b']);
    expect(batchResult.embeddings).toEqual([vec1, vec2]);
    expect(batchResult.usage).toEqual({ inputTokens: 14, totalTokens: 14 });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('http://localhost:11434/api/embed');
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'nomic-embed-text',
      input: ['maintenance policy'],
    });
  });

  it('rejects Ollama embedding dimension mismatch against fixed 1536-dim index', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        model: 'nomic-embed-text',
        embeddings: [makeVector(1, 768)],
      }),
    );

    const provider = new OllamaEmbeddingProvider({
      fetchImpl,
      sleepImpl: async () => {},
    });

    await expect(provider.embedQuery('check dims')).rejects.toThrow(
      AIInvalidResponseError,
    );
  });

  it('generates chat completions via /api/chat with json format and usage parsing', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        model: 'llama3.1',
        message: {
          role: 'assistant',
          content: JSON.stringify({
            answer: 'Inspect coolant valves weekly.',
            insufficientContext: false,
            citedChunkIds: ['chunk-1'],
          }),
        },
        done: true,
        done_reason: 'stop',
        prompt_eval_count: 88,
        eval_count: 22,
      }),
    );

    const provider = new OllamaLLMProvider({
      model: 'llama3.1',
      fetchImpl,
      sleepImpl: async () => {},
    });

    const result = await provider.generate({
      systemPrompt: 'Answer strictly from supplied evidence.',
      messages: [{ role: 'user', content: 'How often to inspect valves?' }],
      temperature: 0.1,
      maxTokens: 256,
      responseFormat: 'json_object',
    });

    expect(result.model).toBe('llama3.1');
    expect(result.finishReason).toBe('stop');
    expect(result.usage).toEqual({
      inputTokens: 88,
      outputTokens: 22,
      totalTokens: 110,
    });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('http://localhost:11434/api/chat');
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'llama3.1',
      messages: [
        { role: 'system', content: 'Answer strictly from supplied evidence.' },
        { role: 'user', content: 'How often to inspect valves?' },
      ],
      stream: false,
      format: 'json',
      options: {
        temperature: 0.1,
        num_predict: 256,
      },
    });
  });

  it('retries Ollama 5xx errors, parses Ollama error JSON, and handles timeouts', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: 'model loading' }, 503))
      .mockResolvedValueOnce(
        jsonResponse({
          model: 'llama3.1',
          message: { role: 'assistant', content: 'Ready now' },
        }),
      );

    const provider = new OllamaLLMProvider({
      maxRetries: 1,
      retryBaseDelayMs: 0,
      fetchImpl,
      sleepImpl: async () => {},
    });

    const ok = await provider.generate({
      systemPrompt: 'System',
      messages: [{ role: 'user', content: 'Hello' }],
    });
    expect(ok.content).toBe('Ready now');
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const nonRetryableFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({ error: 'model "unknown" not found' }, 404),
    );
    const badModelProvider = new OllamaLLMProvider({
      model: 'unknown',
      maxRetries: 2,
      fetchImpl: nonRetryableFetch,
      sleepImpl: async () => {},
    });

    await expect(
      badModelProvider.generate({
        systemPrompt: 'System',
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    ).rejects.toThrow(AIInvalidRequestError);
    expect(nonRetryableFetch).toHaveBeenCalledTimes(1);

    const downFetch = vi.fn<typeof fetch>().mockImplementation(async () =>
      jsonResponse({ error: 'backend crashed' }, 500),
    );
    const downProvider = new OllamaLLMProvider({
      maxRetries: 1,
      retryBaseDelayMs: 0,
      fetchImpl: downFetch,
      sleepImpl: async () => {},
    });
    await expect(
      downProvider.generate({
        systemPrompt: 'System',
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    ).rejects.toThrow(AIUpstreamError);

    const hangingFetch = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    );
    const timeoutProvider = new OllamaLLMProvider({
      timeoutMs: 20,
      maxRetries: 0,
      fetchImpl: hangingFetch,
    });
    await expect(
      timeoutProvider.generate({
        systemPrompt: 'System',
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    ).rejects.toThrow(AITimeoutError);
  });
});
