import { describe, expect, it, vi } from 'vitest';
import {
  AIAuthenticationError,
  AIInvalidRequestError,
  AIInvalidResponseError,
  AITimeoutError,
  OpenAILLMProvider,
  validateEmbeddingVector,
} from '../src/index.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('OpenAILLMProvider and vector validation', () => {
  it('generates structured JSON response with system prompt, usage, and latency', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        model: 'gpt-4o-mini-2024-07-18',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: JSON.stringify({
                answer: 'Maintenance is required every 90 days.',
                insufficientContext: false,
                citedChunkIds: ['chunk-1'],
              }),
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 120,
          completion_tokens: 30,
          total_tokens: 150,
        },
      }),
    );

    const provider = new OpenAILLMProvider({
      apiKey: 'sk-test-1234567890',
      model: 'gpt-4o-mini',
      fetchImpl,
      sleepImpl: async () => {},
    });

    const result = await provider.generate({
      systemPrompt: 'Answer only from retrieved evidence.',
      messages: [{ role: 'user', content: 'How often is maintenance required?' }],
      temperature: 0,
      maxTokens: 500,
      responseFormat: 'json_object',
    });

    expect(result.model).toBe('gpt-4o-mini-2024-07-18');
    expect(result.finishReason).toBe('stop');
    expect(result.usage).toEqual({
      inputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
    });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(JSON.parse(result.content)).toEqual({
      answer: 'Maintenance is required every 90 days.',
      insufficientContext: false,
      citedChunkIds: ['chunk-1'],
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Answer only from retrieved evidence.' },
        { role: 'user', content: 'How often is maintenance required?' },
      ],
      temperature: 0,
      max_tokens: 500,
      response_format: { type: 'json_object' },
    });
  });

  it('rejects empty or null assistant completion content', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [{ message: { role: 'assistant', content: '   ' } }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [{ message: { role: 'assistant', content: null } }],
        }),
      );

    const provider = new OpenAILLMProvider({
      apiKey: 'sk-test-1234567890',
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
  });

  it('validates non-empty systemPrompt and messages before calling fetch', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const provider = new OpenAILLMProvider({
      apiKey: 'sk-test-1234567890',
      fetchImpl,
    });

    await expect(
      provider.generate({
        systemPrompt: ' ',
        messages: [{ role: 'user', content: 'Question' }],
      }),
    ).rejects.toThrow(AIInvalidRequestError);

    await expect(
      provider.generate({
        systemPrompt: 'System',
        messages: [],
      }),
    ).rejects.toThrow(AIInvalidRequestError);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('retries transient 502 error and handles 401 without leaking secrets', async () => {
    const secretKey = 'custom-secret-token-xyz';
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ error: { message: 'Bad gateway' } }, 502),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [{ message: { content: 'Recovered answer' } }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { message: `Invalid key ${secretKey}` } },
          401,
        ),
      );

    const provider = new OpenAILLMProvider({
      apiKey: secretKey,
      maxRetries: 2,
      retryBaseDelayMs: 0,
      fetchImpl,
      sleepImpl: async () => {},
    });

    const ok = await provider.generate({
      systemPrompt: 'System',
      messages: [{ role: 'user', content: 'Question' }],
    });
    expect(ok.content).toBe('Recovered answer');

    let authErr: unknown;
    try {
      await provider.generate({
        systemPrompt: 'System',
        messages: [{ role: 'user', content: 'Question' }],
      });
    } catch (error) {
      authErr = error;
    }

    expect(authErr).toBeInstanceOf(AIAuthenticationError);
    expect((authErr as Error).message).not.toContain(secretKey);
    expect((authErr as Error).message).toContain('[REDACTED]');
  });

  it('throws AITimeoutError when LLM call exceeds timeoutMs', async () => {
    const hangingFetch = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    );

    const provider = new OpenAILLMProvider({
      apiKey: 'sk-test-1234567890',
      timeoutMs: 20,
      maxRetries: 0,
      fetchImpl: hangingFetch,
    });

    await expect(
      provider.generate({
        systemPrompt: 'System',
        messages: [{ role: 'user', content: 'Question' }],
      }),
    ).rejects.toThrow(AITimeoutError);
  });

  it('rejects NaN and Infinity inside validateEmbeddingVector', () => {
    expect(() => validateEmbeddingVector([0.1, Number.NaN], 2)).toThrow(
      AIInvalidResponseError,
    );
    expect(() =>
      validateEmbeddingVector([0.1, Number.POSITIVE_INFINITY], 2),
    ).toThrow(AIInvalidResponseError);
  });
});
