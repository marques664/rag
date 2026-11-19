import { z } from 'zod';
import {
  DEFAULT_AI_MAX_RETRIES,
  DEFAULT_AI_REQUEST_TIMEOUT_MS,
  DEFAULT_AI_RETRY_BASE_DELAY_MS,
  DEFAULT_OPENAI_BASE_URL,
} from '../config/ai-config.js';
import {
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
} from '../errors/ai-error.js';

export type FetchLike = typeof fetch;
export type SleepLike = (ms: number, signal?: AbortSignal) => Promise<void>;

export interface OpenAIClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  fetchImpl?: FetchLike;
  sleepImpl?: SleepLike;
}

const PROVIDER_NAME = 'openai';
const MAX_RETRY_DELAY_MS = 60_000;
const MAX_ERROR_BODY_LENGTH = 300;

const openAIErrorEnvelopeSchema = z.object({
  error: z
    .object({
      message: z.string().optional(),
      type: z.string().optional(),
      code: z.union([z.string(), z.number()]).nullable().optional(),
    })
    .optional(),
});

function parseRetryAfterMs(headerValue: string | null): number | undefined {
  if (!headerValue) {
    return undefined;
  }

  const trimmed = headerValue.trim();
  if (!trimmed) {
    return undefined;
  }

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1000);
  }

  const parsedDate = Date.parse(trimmed);
  if (!Number.isNaN(parsedDate)) {
    return Math.max(0, parsedDate - Date.now());
  }

  return undefined;
}

async function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw new AIAbortedError(PROVIDER_NAME);
  }
  if (ms <= 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new AIAbortedError(PROVIDER_NAME));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function sanitizeMessage(message: string, apiKey: string): string {
  const withoutExactKey = apiKey
    ? message.replaceAll(apiKey, '[REDACTED]')
    : message;
  return redactProviderSecrets(withoutExactKey);
}

/**
 * Shared OpenAI REST JSON transport using Node 24 built-in fetch with
 * per-attempt AbortSignal timeouts, bounded exponential backoff, and secret redaction.
 */
export class OpenAIHttpClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly fetchImpl: FetchLike;
  private readonly sleepImpl: SleepLike;

  constructor(options: OpenAIClientOptions) {
    const trimmedKey = options.apiKey.trim();
    if (!trimmedKey) {
      throw new AIProviderNotConfiguredError(
        PROVIDER_NAME,
        'OPENAI_API_KEY is required for OpenAI provider',
      );
    }

    this.apiKey = trimmedKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_OPENAI_BASE_URL).replace(
      /\/+$/,
      '',
    );
    this.timeoutMs = options.timeoutMs ?? DEFAULT_AI_REQUEST_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_AI_MAX_RETRIES;
    this.retryBaseDelayMs =
      options.retryBaseDelayMs ?? DEFAULT_AI_RETRY_BASE_DELAY_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleepImpl = options.sleepImpl ?? defaultSleep;
  }

  public async postJson<TResponse>(
    path: string,
    body: unknown,
    schema: z.ZodType<TResponse>,
    signal?: AbortSignal,
  ): Promise<TResponse> {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const serializedBody = JSON.stringify(body);

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      if (signal?.aborted) {
        throw new AIAbortedError(PROVIDER_NAME);
      }

      try {
        return await this.executeSingleAttempt(
          url,
          serializedBody,
          schema,
          signal,
        );
      } catch (error) {
        const shouldRetry =
          error instanceof AIProviderError &&
          error.retryable &&
          attempt < this.maxRetries;

        if (!shouldRetry) {
          throw error;
        }

        const delayMs = this.computeRetryDelayMs(attempt, error.retryAfterMs);
        await this.sleepImpl(delayMs, signal);
      }
    }

    throw new AIUpstreamError(
      PROVIDER_NAME,
      'OpenAI request exhausted retry attempts',
    );
  }

  private async executeSingleAttempt<TResponse>(
    url: string,
    serializedBody: string,
    schema: z.ZodType<TResponse>,
    callerSignal?: AbortSignal,
  ): Promise<TResponse> {
    const attemptController = new AbortController();
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      attemptController.abort();
    }, this.timeoutMs);

    const onCallerAbort = (): void => {
      attemptController.abort();
    };
    callerSignal?.addEventListener('abort', onCallerAbort, { once: true });

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: serializedBody,
        signal: attemptController.signal,
      });
    } catch (error) {
      if (timedOut) {
        throw new AITimeoutError(
          PROVIDER_NAME,
          `OpenAI request timed out after ${this.timeoutMs}ms`,
          error,
        );
      }
      if (callerSignal?.aborted) {
        throw new AIAbortedError(
          PROVIDER_NAME,
          'OpenAI request was aborted by caller',
          error,
        );
      }

      const rawMessage =
        error instanceof Error ? error.message : 'Network request failed';
      throw new AIUpstreamError(
        PROVIDER_NAME,
        `OpenAI network failure: ${sanitizeMessage(rawMessage, this.apiKey)}`,
        { cause: error },
      );
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    }

    const rawText = await this.readResponseTextSafely(response);

    if (!response.ok) {
      throw this.mapHttpError(response.status, response.headers, rawText);
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawText);
    } catch (error) {
      throw new AIInvalidResponseError(
        PROVIDER_NAME,
        'OpenAI returned invalid JSON response',
        error,
      );
    }

    const validated = schema.safeParse(parsedJson);
    if (!validated.success) {
      throw new AIInvalidResponseError(
        PROVIDER_NAME,
        `OpenAI response failed schema validation: ${validated.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')}`,
      );
    }

    return validated.data;
  }

  private async readResponseTextSafely(response: Response): Promise<string> {
    try {
      return await response.text();
    } catch (error) {
      throw new AIUpstreamError(
        PROVIDER_NAME,
        'Failed to read OpenAI response body',
        { statusCode: response.status, cause: error },
      );
    }
  }

  private mapHttpError(
    status: number,
    headers: Headers,
    rawBody: string,
  ): AIProviderError {
    const detail = this.extractSafeErrorDetail(rawBody, status);

    if (status === 401 || status === 403) {
      return new AIAuthenticationError(
        PROVIDER_NAME,
        `OpenAI authentication failed (${status}): ${detail}`,
        status,
      );
    }

    if (status === 429) {
      const retryAfterMs = parseRetryAfterMs(headers.get('retry-after'));
      return new AIRateLimitError(
        PROVIDER_NAME,
        `OpenAI rate limit exceeded (429): ${detail}`,
        { statusCode: status, retryAfterMs },
      );
    }

    if (status === 400 || status === 404 || status === 422) {
      return new AIInvalidRequestError(
        PROVIDER_NAME,
        `OpenAI rejected request (${status}): ${detail}`,
        status,
      );
    }

    if (status >= 500) {
      return new AIUpstreamError(
        PROVIDER_NAME,
        `OpenAI upstream server error (${status}): ${detail}`,
        { statusCode: status },
      );
    }

    return new AIInvalidRequestError(
      PROVIDER_NAME,
      `OpenAI returned unexpected client error (${status}): ${detail}`,
      status,
    );
  }

  private extractSafeErrorDetail(rawBody: string, status: number): string {
    let message = `HTTP ${status}`;

    try {
      const parsedJson: unknown = JSON.parse(rawBody);
      const parsedError = openAIErrorEnvelopeSchema.safeParse(parsedJson);
      if (parsedError.success && parsedError.data.error?.message) {
        message = parsedError.data.error.message;
      }
    } catch {
      const trimmed = rawBody.replace(/\s+/g, ' ').trim();
      if (trimmed) {
        message = trimmed;
      }
    }

    const sanitized = sanitizeMessage(message, this.apiKey);
    if (sanitized.length <= MAX_ERROR_BODY_LENGTH) {
      return sanitized;
    }
    return `${sanitized.slice(0, MAX_ERROR_BODY_LENGTH - 3)}...`;
  }

  private computeRetryDelayMs(attempt: number, retryAfterMs?: number): number {
    if (retryAfterMs !== undefined && Number.isFinite(retryAfterMs)) {
      return Math.min(Math.max(0, retryAfterMs), MAX_RETRY_DELAY_MS);
    }

    if (this.retryBaseDelayMs <= 0) {
      return 0;
    }

    const exponential = this.retryBaseDelayMs * 2 ** attempt;
    const jitterFactor = 0.85 + Math.random() * 0.3;
    return Math.min(Math.round(exponential * jitterFactor), MAX_RETRY_DELAY_MS);
  }
}
