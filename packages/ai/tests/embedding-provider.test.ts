import { describe, expect, it, vi } from 'vitest';
import {
  AIAbortedError,
  AIAuthenticationError,
  AIInvalidRequestError,
  AIInvalidResponseError,
  AIRateLimitError,
  AITimeoutError,
  AIUpstreamError,
  DEFAULT_OPENAI_EMBEDDING_DIMENSIONS,
  OpenAIEmbeddingProvider,
} from '../src/index.js';

function makeVector(seed: number, length = DEFAULT_OPENAI_EMBEDDING_DIMENSIONS): number[] {
  return Array.from({ length }, (_, idx) => (seed + idx) * 0.001);
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

describe('OpenAIEmbeddingProvider', () => {
  it('embeds a single query and validates dimensions and usage', async () => {
    const expected = makeVector(1);
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        model: 'text-embedding-3-small',
        data: [{ index: 0, embedding: expected }],
        usage: { prompt_tokens: 7, total_tokens: 7 },
      }),
    );

    const provider = new OpenAIEmbeddingProvider({
      apiKey: 'sk-test-1234567890',
      fetchImpl,
      sleepImpl: async () => {},
    });

    const result = await provider.embedQuery('What is the refund policy?');

    expect(result.embedding).toEqual(expected);
    expect(result.dimensions).toBe(1536);
    expect(result.model).toBe('text-embedding-3-small');
    expect(result.usage).toEqual({ inputTokens: 7, totalTokens: 7 });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/embeddings');
    const parsedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(parsedBody).toEqual({
      model: 'text-embedding-3-small',
      input: ['What is the refund policy?'],
      dimensions: 1536,
      encoding_format: 'float',
    });
  });

  it('batches document chunks, preserves index ordering, and aggregates usage', async () => {
    const vec0 = makeVector(1);
    const vec1 = makeVector(2);
    const vec2 = makeVector(3);

    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          model: 'text-embedding-3-small',
          // Out-of-order indexes to verify deterministic reordering
          data: [
            { index: 1, embedding: vec1 },
            { index: 0, embedding: vec0 },
          ],
          usage: { prompt_tokens: 20, total_tokens: 20 },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          model: 'text-embedding-3-small',
          data: [{ index: 0, embedding: vec2 }],
          usage: { prompt_tokens: 11, total_tokens: 11 },
        }),
      );

    const provider = new OpenAIEmbeddingProvider({
      apiKey: 'sk-test-1234567890',
      batchSize: 2,
      fetchImpl,
      sleepImpl: async () => {},
    });

    const result = await provider.embedDocuments([
      'Chunk 1 content',
      'Chunk 2 content',
      'Chunk 3 content',
    ]);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.embeddings).toEqual([vec0, vec1, vec2]);
    expect(result.usage).toEqual({ inputTokens: 31, totalTokens: 31 });
  });

  it('returns empty embeddings immediately when given an empty array', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const provider = new OpenAIEmbeddingProvider({
      apiKey: 'sk-test-1234567890',
      fetchImpl,
    });

    const result = await provider.embedDocuments([]);
    expect(result.embeddings).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects dimension mismatches and NaN/Infinity coordinates', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ index: 0, embedding: makeVector(1, 1535) }],
        }),
      );

    const provider = new OpenAIEmbeddingProvider({
      apiKey: 'sk-test-1234567890',
      fetchImpl,
      sleepImpl: async () => {},
    });

    await expect(provider.embedQuery('hello')).rejects.toThrow(
      AIInvalidResponseError,
    );

    await expect(provider.embedQuery('hello')).rejects.toThrow(
      /expected 1536, received 1535/i,
    );
  });

  it('retries 429 honoring Retry-After and retries 5xx errors', async () => {
    const sleepDelays: number[] = [];
    const expected = makeVector(5);

    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { message: 'Rate limit reached' } },
          429,
          { 'Retry-After': '2' },
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({ error: { message: 'Temporary server error' } }, 503),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ index: 0, embedding: expected }],
          usage: { prompt_tokens: 4, total_tokens: 4 },
        }),
      );

    const provider = new OpenAIEmbeddingProvider({
      apiKey: 'sk-test-1234567890',
      maxRetries: 3,
      retryBaseDelayMs: 100,
      fetchImpl,
      sleepImpl: async (ms) => {
        sleepDelays.push(ms);
      },
    });

    const result = await provider.embedQuery('retry test');
    expect(result.embedding).toEqual(expected);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleepDelays[0]).toBe(2000);
    expect(sleepDelays[1]).toBeGreaterThanOrEqual(150);
  });

  it('does not retry 401/400 errors and redacts API keys from error messages', async () => {
    const secretKey = 'sk-super-secret-value-987654';
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { message: `Incorrect API key provided: ${secretKey}` } },
          401,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({ error: { message: 'Invalid input payload' } }, 400),
      );

    const provider = new OpenAIEmbeddingProvider({
      apiKey: secretKey,
      maxRetries: 3,
      fetchImpl,
      sleepImpl: async () => {},
    });

    let capturedError: unknown;
    try {
      await provider.embedQuery('bad auth');
    } catch (error) {
      capturedError = error;
    }

    expect(capturedError).toBeInstanceOf(AIAuthenticationError);
    expect((capturedError as Error).message).not.toContain(secretKey);
    expect((capturedError as Error).message).toContain('[REDACTED]');
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await expect(provider.embedQuery('bad request')).rejects.toThrow(
      AIInvalidRequestError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('throws AIRateLimitError / AIUpstreamError when retries are exhausted', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        jsonResponse({ error: { message: 'Still rate limited' } }, 429),
      );

    const provider = new OpenAIEmbeddingProvider({
      apiKey: 'sk-test-1234567890',
      maxRetries: 1,
      retryBaseDelayMs: 0,
      fetchImpl,
      sleepImpl: async () => {},
    });

    await expect(provider.embedQuery('exhaust')).rejects.toThrow(
      AIRateLimitError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const serverErrorFetch = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        jsonResponse({ error: { message: 'Down' } }, 500),
      );
    const serverProvider = new OpenAIEmbeddingProvider({
      apiKey: 'sk-test-1234567890',
      maxRetries: 1,
      retryBaseDelayMs: 0,
      fetchImpl: serverErrorFetch,
      sleepImpl: async () => {},
    });

    await expect(serverProvider.embedQuery('exhaust')).rejects.toThrow(
      AIUpstreamError,
    );
  });

  it('throws AITimeoutError on timeout and AIAbortedError on caller abort', async () => {
    const hangingFetch = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted', 'AbortError'));
          });
        }),
    );

    const timeoutProvider = new OpenAIEmbeddingProvider({
      apiKey: 'sk-test-1234567890',
      timeoutMs: 25,
      maxRetries: 0,
      fetchImpl: hangingFetch,
    });

    await expect(timeoutProvider.embedQuery('slow request')).rejects.toThrow(
      AITimeoutError,
    );

    const callerController = new AbortController();
    callerController.abort();
    await expect(
      timeoutProvider.embedQuery('aborted request', {
        signal: callerController.signal,
      }),
    ).rejects.toThrow(AIAbortedError);
  });
});
