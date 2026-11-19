import { z } from 'zod';
import {
  DEFAULT_AI_MAX_RETRIES,
  DEFAULT_AI_REQUEST_TIMEOUT_MS,
  DEFAULT_AI_RETRY_BASE_DELAY_MS,
} from '../config/ai-config.js';
import {
  AIAbortedError,
  AIAuthenticationError,
  AIInvalidRequestError,
  AIInvalidResponseError,
  AIProviderError,
  AIRateLimitError,
  AITimeoutError,
  AIUpstreamError,
  redactProviderSecrets,
} from '../errors/ai-error.js';

export type FetchLike = typeof fetch;
export type SleepLike = (ms: number, signal?: AbortSignal) => Promise<void>;

export interface JsonHttpClientOptions {
  providerName: string;
  baseUrl: string;
  headers?: Record<string, string>;
  secretsToRedact?: string[];
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  fetchImpl?: FetchLike;
  sleepImpl?: SleepLike;
  extractErrorDetail?: (rawBody: string, status: number) => string;
}

const MAX_RETRY_DELAY_MS = 60_000;
const MAX_ERROR_BODY_LENGTH = 300;

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

async function defaultSleep(
  providerName: string,
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    throw new AIAbortedError(providerName);
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
      reject(new AIAbortedError(providerName));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function defaultExtractErrorDetail(rawBody: string, status: number): string {
  const trimmed = rawBody.replace(/\s+/g, ' ').trim();
  return trimmed || `HTTP ${status}`;
}

export function sanitizeProviderMessage(
  message: string,
  secretsToRedact: readonly string[],
): string {
  let sanitized = message;
  for (const secret of secretsToRedact) {
    if (secret) {
      sanitized = sanitized.replaceAll(secret, '[REDACTED]');
    }
  }
  return redactProviderSecrets(sanitized);
}

/**
 * Shared JSON HTTP client using Node 24 built-in fetch with per-attempt AbortSignal
 * timeouts, bounded exponential backoff retries, and secret redaction.
 */
export class JsonHttpClient {
  private readonly providerName: string;
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly secretsToRedact: string[];
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly fetchImpl: FetchLike;
  private readonly sleepImpl: SleepLike;
  private readonly extractErrorDetailFn: (
    rawBody: string,
    status: number,
  ) => string;

  constructor(options: JsonHttpClientOptions) {
    this.providerName = options.providerName;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.headers = options.headers ?? {};
    this.secretsToRedact = options.secretsToRedact ?? [];
    this.timeoutMs = options.timeoutMs ?? DEFAULT_AI_REQUEST_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_AI_MAX_RETRIES;
    this.retryBaseDelayMs =
      options.retryBaseDelayMs ?? DEFAULT_AI_RETRY_BASE_DELAY_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleepImpl =
      options.sleepImpl ??
      ((ms, signal) => defaultSleep(this.providerName, ms, signal));
    this.extractErrorDetailFn =
      options.extractErrorDetail ?? defaultExtractErrorDetail;
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
        throw new AIAbortedError(this.providerName);
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
      this.providerName,
      `${this.providerName} request exhausted retry attempts`,
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
          ...this.headers,
        },
        body: serializedBody,
        signal: attemptController.signal,
      });
    } catch (error) {
      if (timedOut) {
        throw new AITimeoutError(
          this.providerName,
          `${this.providerName} request timed out after ${this.timeoutMs}ms`,
          error,
        );
      }
      if (callerSignal?.aborted) {
        throw new AIAbortedError(
          this.providerName,
          `${this.providerName} request was aborted by caller`,
          error,
        );
      }

      const rawMessage =
        error instanceof Error ? error.message : 'Network request failed';
      throw new AIUpstreamError(
        this.providerName,
        `${this.providerName} network failure: ${sanitizeProviderMessage(rawMessage, this.secretsToRedact)}`,
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
        this.providerName,
        `${this.providerName} returned invalid JSON response`,
        error,
      );
    }

    const validated = schema.safeParse(parsedJson);
    if (!validated.success) {
      throw new AIInvalidResponseError(
        this.providerName,
        `${this.providerName} response failed schema validation: ${validated.error.issues
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
        this.providerName,
        `Failed to read ${this.providerName} response body`,
        { statusCode: response.status, cause: error },
      );
    }
  }

  private mapHttpError(
    status: number,
    headers: Headers,
    rawBody: string,
  ): AIProviderError {
    const rawDetail = this.extractErrorDetailFn(rawBody, status);
    const sanitized = sanitizeProviderMessage(rawDetail, this.secretsToRedact);
    const detail =
      sanitized.length <= MAX_ERROR_BODY_LENGTH
        ? sanitized
        : `${sanitized.slice(0, MAX_ERROR_BODY_LENGTH - 3)}...`;

    if (status === 401 || status === 403) {
      return new AIAuthenticationError(
        this.providerName,
        `${this.providerName} authentication failed (${status}): ${detail}`,
        status,
      );
    }

    if (status === 429) {
      const retryAfterMs = parseRetryAfterMs(headers.get('retry-after'));
      return new AIRateLimitError(
        this.providerName,
        `${this.providerName} rate limit exceeded (429): ${detail}`,
        { statusCode: status, retryAfterMs },
      );
    }

    if (status === 400 || status === 404 || status === 422) {
      return new AIInvalidRequestError(
        this.providerName,
        `${this.providerName} rejected request (${status}): ${detail}`,
        status,
      );
    }

    if (status >= 500) {
      return new AIUpstreamError(
        this.providerName,
        `${this.providerName} upstream server error (${status}): ${detail}`,
        { statusCode: status },
      );
    }

    return new AIInvalidRequestError(
      this.providerName,
      `${this.providerName} returned unexpected client error (${status}): ${detail}`,
      status,
    );
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
