import { describe, expect, it, vi } from 'vitest';
import {
  AIAuthenticationError,
  AIInvalidResponseError,
  AIProviderNotConfiguredError,
  AIRateLimitError,
  AITimeoutError,
  AIUpstreamError,
  GroqLLMProvider,
} from '../src/index.js';

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

describe('GroqLLMProvider', () => {
  it('calls Groq /chat/completions with qwen/qwen3.8-27b and json_object response format', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        model: 'qwen/qwen3.8-27b',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: JSON.stringify({
                answer: 'Use lockout-tagout before servicing.',
                insufficientContext: false,
                citedChunkIds: ['chunk-1'],
              }),
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 95,
          completion_tokens: 24,
          total_tokens: 119,
        },
      }),
    );

    const provider = new GroqLLMProvider({
      apiKey: 'gsk_test_key_1234567890',
      fetchImpl,
      sleepImpl: async () => {},
    });

    expect(provider.providerName).toBe('groq');
    expect(provider.model).toBe('qwen/qwen3.8-27b');

    const result = await provider.generate({
      systemPrompt: 'Answer only from supplied evidence.',
      messages: [{ role: 'user', content: 'What safety step comes first?' }],
      temperature: 0,
      maxTokens: 400,
      responseFormat: 'json_object',
    });

    expect(result.model).toBe('qwen/qwen3.8-27b');
    expect(result.finishReason).toBe('stop');
    expect(result.usage).toEqual({
      inputTokens: 95,
      outputTokens: 24,
      totalTokens: 119,
    });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(JSON.parse(result.content)).toEqual({
      answer: 'Use lockout-tagout before servicing.',
      insufficientContext: false,
      citedChunkIds: ['chunk-1'],
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect((init?.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer gsk_test_key_1234567890',
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'qwen/qwen3.8-27b',
      messages: [
        { role: 'system', content: 'Answer only from supplied evidence.' },
        { role: 'user', content: 'What safety step comes first?' },
      ],
      temperature: 0,
      max_tokens: 400,
      response_format: { type: 'json_object' },
    });
  });

  it('throws AIProviderNotConfiguredError when GROQ_API_KEY is empty', () => {
    expect(() => new GroqLLMProvider({ apiKey: '   ' })).toThrow(
      AIProviderNotConfiguredError,
    );
  });

  it('redacts gsk_ secrets on 401/403 errors and does not retry them', async () => {
    const secretKey = 'gsk_secret_token_987654321';
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { message: `Invalid API Key: ${secretKey}` } },
          401,
        ),
      );

    const provider = new GroqLLMProvider({
      apiKey: secretKey,
      maxRetries: 3,
      fetchImpl,
      sleepImpl: async () => {},
    });

    let err: unknown;
    try {
      await provider.generate({
        systemPrompt: 'System',
        messages: [{ role: 'user', content: 'Hello' }],
      });
    } catch (caught) {
      err = caught;
    }

    expect(err).toBeInstanceOf(AIAuthenticationError);
    expect((err as Error).message).not.toContain(secretKey);
    expect((err as Error).message).toContain('[REDACTED]');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries 429 with Retry-After and 5xx errors, rejects empty output, and handles timeouts', async () => {
    const sleepDelays: number[] = [];
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { message: 'Rate limit exceeded' } },
          429,
          { 'Retry-After': '2' },
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({ error: { message: 'Service unavailable' } }, 503),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [{ message: { content: 'Groq recovered response' } }],
        }),
      );

    const provider = new GroqLLMProvider({
      apiKey: 'gsk_test_key_1234567890',
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
    expect(ok.content).toBe('Groq recovered response');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleepDelays[0]).toBe(2000);

    const emptyFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        choices: [{ message: { content: '   ' } }],
      }),
    );
    const emptyProvider = new GroqLLMProvider({
      apiKey: 'gsk_test_key_1234567890',
      fetchImpl: emptyFetch,
      sleepImpl: async () => {},
    });
    await expect(
      emptyProvider.generate({
        systemPrompt: 'System',
        messages: [{ role: 'user', content: 'Question' }],
      }),
    ).rejects.toThrow(AIInvalidResponseError);

    const exhaustedFetch = vi.fn<typeof fetch>().mockImplementation(async () =>
      jsonResponse({ error: { message: 'Rate limited' } }, 429),
    );
    const exhaustedProvider = new GroqLLMProvider({
      apiKey: 'gsk_test_key_1234567890',
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
    const downProvider = new GroqLLMProvider({
      apiKey: 'gsk_test_key_1234567890',
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
    const timeoutProvider = new GroqLLMProvider({
      apiKey: 'gsk_test_key_1234567890',
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
});
