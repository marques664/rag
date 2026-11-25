import { describe, expect, it, vi } from 'vitest';
import {
  AIAbortedError,
  AIAuthenticationError,
  AIInvalidRequestError,
  AIInvalidResponseError,
  AIRateLimitError,
  AITimeoutError,
  AIUpstreamError,
  DEFAULT_GEMINI_EMBEDDING_DIMENSIONS,
  extractGeminiRetryAfterMs,
  GeminiEmbeddingProvider,
  GeminiLLMProvider,
} from '../src/index.js';

function makeVector(
  seed: number,
  length = DEFAULT_GEMINI_EMBEDDING_DIMENSIONS,
): number[] {
  return Array.from({ length }, (_, idx) => (seed + idx) * 0.001);
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

describe('GeminiEmbeddingProvider and GeminiLLMProvider', () => {
  it('embeds a single query via :embedContent with x-goog-api-key and RETRIEVAL_QUERY', async () => {
    const expected = makeVector(1);
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        embedding: { values: expected },
      }),
    );

    const provider = new GeminiEmbeddingProvider({
      apiKey: 'AIzaTestFakeKey123456789012345',
      fetchImpl,
      sleepImpl: async () => {},
    });

    const result = await provider.embedQuery('What is the retention policy?');

    expect(result.embedding).toEqual(expected);
    expect(result.model).toBe('gemini-embedding-001');
    expect(result.dimensions).toBe(1536);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent',
    );
    expect((init?.headers as Record<string, string>)['x-goog-api-key']).toBe(
      'AIzaTestFakeKey123456789012345',
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'models/gemini-embedding-001',
      content: { parts: [{ text: 'What is the retention policy?' }] },
      taskType: 'RETRIEVAL_QUERY',
      outputDimensionality: 1536,
    });
  });

  it('batches documents via :batchEmbedContents (clamped <= 100) and validates dimensions', async () => {
    const vec0 = makeVector(1);
    const vec1 = makeVector(2);
    const vec2 = makeVector(3);

    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          embeddings: [{ values: vec0 }, { values: vec1 }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          embeddings: [{ values: vec2 }],
        }),
      );

    const provider = new GeminiEmbeddingProvider({
      apiKey: 'AIzaTestFakeKey123456789012345',
      batchSize: 2,
      fetchImpl,
      sleepImpl: async () => {},
    });

    const batch = await provider.embedDocuments(['Chunk A', 'Chunk B', 'Chunk C']);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(batch.embeddings).toEqual([vec0, vec1, vec2]);

    const [url1, init1] = fetchImpl.mock.calls[0]!;
    expect(url1).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents',
    );
    expect(JSON.parse(String(init1?.body))).toEqual({
      requests: [
        {
          model: 'models/gemini-embedding-001',
          content: { parts: [{ text: 'Chunk A' }] },
          taskType: 'RETRIEVAL_DOCUMENT',
          outputDimensionality: 1536,
        },
        {
          model: 'models/gemini-embedding-001',
          content: { parts: [{ text: 'Chunk B' }] },
          taskType: 'RETRIEVAL_DOCUMENT',
          outputDimensionality: 1536,
        },
      ],
    });

    // Empty documents array short-circuits cleanly
    const empty = await provider.embedDocuments([]);
    expect(empty.embeddings).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    // Clamps batchSize > 100 down to 100 per Gemini API limit
    const largeBatchFetch = vi.fn<typeof fetch>().mockImplementation(async (_u, init) => {
      const reqs = (JSON.parse(String(init?.body)) as { requests: unknown[] }).requests;
      return jsonResponse({
        embeddings: reqs.map((_, i) => ({ values: makeVector(i) })),
      });
    });
    const clampedProvider = new GeminiEmbeddingProvider({
      apiKey: 'AIzaTestFakeKey123456789012345',
      batchSize: 250,
      fetchImpl: largeBatchFetch,
      sleepImpl: async () => {},
    });
    const texts105 = Array.from({ length: 105 }, (_, i) => `Document chunk ${i}`);
    const largeRes = await clampedProvider.embedDocuments(texts105);
    expect(largeRes.embeddings).toHaveLength(105);
    expect(largeBatchFetch).toHaveBeenCalledTimes(2);
  });

  it('rejects dimension mismatches from Gemini embedding API', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        embedding: { values: makeVector(1, 768) },
      }),
    );

    const provider = new GeminiEmbeddingProvider({
      apiKey: 'AIzaTestFakeKey123456789012345',
      fetchImpl,
      sleepImpl: async () => {},
    });

    await expect(provider.embedQuery('hello')).rejects.toThrow(
      AIInvalidResponseError,
    );
  });

  it('generates structured JSON responses via :generateContent with systemInstruction and usageMetadata', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        modelVersion: 'gemini-2.5-flash',
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    answer: 'Logs are retained for 365 days.',
                    insufficientContext: false,
                    citedChunkIds: ['chunk-1'],
                  }),
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 140,
          candidatesTokenCount: 25,
          totalTokenCount: 165,
        },
      }),
    );

    const provider = new GeminiLLMProvider({
      apiKey: 'AIzaTestFakeKey123456789012345',
      fetchImpl,
      sleepImpl: async () => {},
    });

    const result = await provider.generate({
      systemPrompt: 'Answer only from retrieved evidence.',
      messages: [
        { role: 'user', content: 'Previous question' },
        { role: 'assistant', content: 'Previous answer' },
        { role: 'user', content: 'How long are logs retained?' },
      ],
      temperature: 0.2,
      maxTokens: 512,
      responseFormat: 'json_object',
    });

    expect(result.model).toBe('gemini-2.5-flash');
    expect(result.finishReason).toBe('STOP');
    expect(result.usage).toEqual({
      inputTokens: 140,
      outputTokens: 25,
      totalTokens: 165,
    });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(JSON.parse(result.content)).toEqual({
      answer: 'Logs are retained for 365 days.',
      insufficientContext: false,
      citedChunkIds: ['chunk-1'],
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      systemInstruction: {
        parts: [{ text: 'Answer only from retrieved evidence.' }],
      },
      contents: [
        { role: 'user', parts: [{ text: 'Previous question' }] },
        { role: 'model', parts: [{ text: 'Previous answer' }] },
        { role: 'user', parts: [{ text: 'How long are logs retained?' }] },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 512,
        responseMimeType: 'application/json',
      },
    });
  });

  it('rejects empty Gemini candidate output and validates input messages', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          candidates: [{ content: { parts: [{ text: '   ' }] } }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          candidates: [],
        }),
      );

    const provider = new GeminiLLMProvider({
      apiKey: 'AIzaTestFakeKey123456789012345',
      fetchImpl,
      sleepImpl: async () => {},
    });

    await expect(
      provider.generate({
        systemPrompt: 'System',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    ).rejects.toThrow(AIInvalidResponseError);

    await expect(
      provider.generate({
        systemPrompt: 'System',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    ).rejects.toThrow(AIInvalidResponseError);

    await expect(
      provider.generate({
        systemPrompt: 'System',
        messages: [{ role: 'system', content: 'Only system' }],
      }),
    ).rejects.toThrow(AIInvalidRequestError);
  });

  it('redacts AIza keys on 401/403 auth errors and does not retry them', async () => {
    const secretKey = 'AIzaSyTestSecretKeyValue1234567890';
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: 403,
              status: 'PERMISSION_DENIED',
              message: `API key not valid: ${secretKey}`,
            },
          },
          403,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: 401,
              status: 'UNAUTHENTICATED',
              message: `Unauthorized key AIzaAnotherKey98765432109876`,
            },
          },
          401,
        ),
      );

    const provider = new GeminiLLMProvider({
      apiKey: secretKey,
      maxRetries: 3,
      fetchImpl,
      sleepImpl: async () => {},
    });

    let err403: unknown;
    try {
      await provider.generate({
        systemPrompt: 'System',
        messages: [{ role: 'user', content: 'Hello' }],
      });
    } catch (error) {
      err403 = error;
    }

    expect(err403).toBeInstanceOf(AIAuthenticationError);
    expect((err403 as Error).message).not.toContain(secretKey);
    expect((err403 as Error).message).toContain('[REDACTED]');
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    let err401: unknown;
    try {
      await provider.generate({
        systemPrompt: 'System',
        messages: [{ role: 'user', content: 'Hello' }],
      });
    } catch (error) {
      err401 = error;
    }

    expect(err401).toBeInstanceOf(AIAuthenticationError);
    expect((err401 as Error).message).not.toContain('AIzaAnotherKey');
    expect((err401 as Error).message).toContain('[REDACTED]');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('retries 429 with Retry-After and 5xx errors, and throws AITimeoutError on timeout', async () => {
    const sleepDelays: number[] = [];
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded' } },
          429,
          { 'Retry-After': '1' },
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: 503, status: 'UNAVAILABLE', message: 'Backend unavailable' } },
          503,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          candidates: [{ content: { parts: [{ text: 'Recovered Gemini answer' }] } }],
        }),
      );

    const provider = new GeminiLLMProvider({
      apiKey: 'AIzaTestFakeKey123456789012345',
      maxRetries: 3,
      retryBaseDelayMs: 50,
      fetchImpl,
      sleepImpl: async (ms) => {
        sleepDelays.push(ms);
      },
    });

    const ok = await provider.generate({
      systemPrompt: 'System',
      messages: [{ role: 'user', content: 'Question' }],
    });
    expect(ok.content).toBe('Recovered Gemini answer');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleepDelays[0]).toBe(1000);

    const exhaustedFetch = vi.fn<typeof fetch>().mockImplementation(async () =>
      jsonResponse({ error: { message: 'Rate limited' } }, 429),
    );
    const exhaustedProvider = new GeminiLLMProvider({
      apiKey: 'AIzaTestFakeKey123456789012345',
      maxRetries: 1,
      retryBaseDelayMs: 0,
      fetchImpl: exhaustedFetch,
      sleepImpl: async () => {},
    });
    await expect(
      exhaustedProvider.generate({
        systemPrompt: 'System',
        messages: [{ role: 'user', content: 'Question' }],
      }),
    ).rejects.toThrow(AIRateLimitError);

    const downFetch = vi.fn<typeof fetch>().mockImplementation(async () =>
      jsonResponse({ error: { message: 'Internal error' } }, 500),
    );
    const downProvider = new GeminiLLMProvider({
      apiKey: 'AIzaTestFakeKey123456789012345',
      maxRetries: 1,
      retryBaseDelayMs: 0,
      fetchImpl: downFetch,
      sleepImpl: async () => {},
    });
    await expect(
      downProvider.generate({
        systemPrompt: 'System',
        messages: [{ role: 'user', content: 'Question' }],
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
    const timeoutProvider = new GeminiLLMProvider({
      apiKey: 'AIzaTestFakeKey123456789012345',
      timeoutMs: 20,
      maxRetries: 0,
      fetchImpl: hangingFetch,
    });
    await expect(
      timeoutProvider.generate({
        systemPrompt: 'System',
        messages: [{ role: 'user', content: 'Question' }],
      }),
    ).rejects.toThrow(AITimeoutError);
  });

  it('defaults Gemini batch size to 20 and paces multi-batch calls with AbortSignal-safe sleep', async () => {
    const batchSizes: number[] = [];
    const sleepCalls: number[] = [];

    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_u, init) => {
      const reqs = (JSON.parse(String(init?.body)) as { requests: unknown[] })
        .requests;
      batchSizes.push(reqs.length);
      return jsonResponse({
        embeddings: reqs.map((_, i) => ({ values: makeVector(i) })),
      });
    });

    const provider = new GeminiEmbeddingProvider({
      apiKey: 'AIzaTestFakeKey123456789012345',
      fetchImpl,
      sleepImpl: async (ms) => {
        sleepCalls.push(ms);
      },
    });

    // Single batch (<= 20): zero inter-batch delay
    const singleBatchTexts = Array.from({ length: 15 }, (_, i) => `Small ${i}`);
    await provider.embedDocuments(singleBatchTexts);
    expect(batchSizes).toEqual([15]);
    expect(sleepCalls).toEqual([]);

    // 45 chunks -> batches of 20, 20, 5 with 1000ms sleep between batches
    batchSizes.length = 0;
    const largeTexts = Array.from({ length: 45 }, (_, i) => `Large ${i}`);
    const result = await provider.embedDocuments(largeTexts);
    expect(result.embeddings).toHaveLength(45);
    expect(batchSizes).toEqual([20, 20, 5]);
    expect(sleepCalls).toEqual([1000, 1000]);

    // batchDelayMs = 0 disables pacing sleep
    sleepCalls.length = 0;
    const unpacedProvider = new GeminiEmbeddingProvider({
      apiKey: 'AIzaTestFakeKey123456789012345',
      batchSize: 2,
      batchDelayMs: 0,
      fetchImpl,
      sleepImpl: async (ms) => {
        sleepCalls.push(ms);
      },
    });
    await unpacedProvider.embedDocuments(['A', 'B', 'C']);
    expect(sleepCalls).toEqual([]);

    // AbortSignal cancels inter-batch pacing sleep cleanly
    const abortController = new AbortController();
    const abortFetch = vi.fn<typeof fetch>().mockImplementation(async (_u, init) => {
      const reqs = (JSON.parse(String(init?.body)) as { requests: unknown[] })
        .requests;
      abortController.abort();
      return jsonResponse({
        embeddings: reqs.map((_, i) => ({ values: makeVector(i) })),
      });
    });
    const abortingProvider = new GeminiEmbeddingProvider({
      apiKey: 'AIzaTestFakeKey123456789012345',
      batchSize: 1,
      batchDelayMs: 5000,
      fetchImpl: abortFetch,
    });
    await expect(
      abortingProvider.embedDocuments(['First', 'Second'], {
        signal: abortController.signal,
      }),
    ).rejects.toThrow(AIAbortedError);
  });

  it('extracts Gemini RetryInfo and prose retry delays on 429 and caps sleep at 65000ms', async () => {
    expect(
      extractGeminiRetryAfterMs(
        JSON.stringify({
          error: {
            code: 429,
            message: 'Quota exceeded. Please retry in 42.5s.',
            details: [
              {
                '@type': 'type.googleapis.com/google.rpc.RetryInfo',
                retryDelay: '42.5s',
              },
            ],
          },
        }),
      ),
    ).toBe(42500);

    expect(
      extractGeminiRetryAfterMs(
        JSON.stringify({
          error: {
            code: 429,
            message: 'Rate limit hit. Please retry in 18.2s.',
          },
        }),
      ),
    ).toBe(18200);

    const sleepDelays: number[] = [];
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: 429,
              status: 'RESOURCE_EXHAUSTED',
              message: 'Please retry in 42.5s.',
              details: [
                {
                  '@type': 'type.googleapis.com/google.rpc.RetryInfo',
                  retryDelay: '42.5s',
                },
              ],
            },
          },
          429,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: 429,
              status: 'RESOURCE_EXHAUSTED',
              message: 'Please retry in 90s.',
            },
          },
          429,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          embedding: { values: makeVector(7) },
        }),
      );

    const provider = new GeminiEmbeddingProvider({
      apiKey: 'AIzaTestFakeKey123456789012345',
      maxRetries: 3,
      retryBaseDelayMs: 500,
      fetchImpl,
      sleepImpl: async (ms) => {
        sleepDelays.push(ms);
      },
    });

    const result = await provider.embedQuery('large pdf query');
    expect(result.embedding).toEqual(makeVector(7));
    expect(sleepDelays).toEqual([42500, 65000]);
  });
});
