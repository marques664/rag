import { z } from 'zod';
import { DEFAULT_GEMINI_BASE_URL } from '../config/ai-config.js';
import { AIProviderNotConfiguredError } from '../errors/ai-error.js';
import {
  JsonHttpClient,
  type FetchLike,
  type SleepLike,
} from './http-client.js';

export interface GeminiClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  fetchImpl?: FetchLike;
  sleepImpl?: SleepLike;
}

const PROVIDER_NAME = 'gemini';

const geminiErrorDetailSchema = z
  .object({
    '@type': z.string().optional(),
    retryDelay: z.string().optional(),
  })
  .loose();

const geminiErrorEnvelopeSchema = z.object({
  error: z
    .object({
      message: z.string().optional(),
      status: z.string().optional(),
      code: z.number().optional(),
      details: z.array(geminiErrorDetailSchema).optional(),
    })
    .optional(),
});

function parseGoogleDurationMs(duration: string): number | undefined {
  const match = duration.trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s)$/i);
  if (!match) {
    return undefined;
  }

  const numeric = Number(match[1]);
  const unit = match[2]?.toLowerCase();
  if (!Number.isFinite(numeric) || numeric < 0) {
    return undefined;
  }

  return unit === 'ms' ? Math.ceil(numeric) : Math.ceil(numeric * 1000);
}

/**
 * Extracts retry delay hints from Gemini 429 JSON bodies:
 * - google.rpc.RetryInfo (`error.details[].retryDelay`, e.g. `"42.5s"`)
 * - Inline prose hint (`"Please retry in 42.5s"` / `"Please retry in 500ms"`)
 */
export function extractGeminiRetryAfterMs(rawBody: string): number | undefined {
  let messageToScan = rawBody;

  try {
    const parsedJson: unknown = JSON.parse(rawBody);
    const parsedError = geminiErrorEnvelopeSchema.safeParse(parsedJson);
    if (parsedError.success && parsedError.data.error) {
      const details = parsedError.data.error.details ?? [];
      for (const detail of details) {
        if (typeof detail.retryDelay === 'string') {
          const parsedDelay = parseGoogleDurationMs(detail.retryDelay);
          if (parsedDelay !== undefined) {
            return parsedDelay;
          }
        }
      }

      if (parsedError.data.error.message) {
        messageToScan = parsedError.data.error.message;
      }
    }
  } catch {
    // Non-JSON body; scan raw text below.
  }

  const proseMatch = messageToScan.match(
    /retry\s+in\s+(\d+(?:\.\d+)?)\s*(ms|s)\b/i,
  );
  if (proseMatch) {
    const numeric = Number(proseMatch[1]);
    const unit = proseMatch[2]?.toLowerCase();
    if (Number.isFinite(numeric) && numeric >= 0) {
      return unit === 'ms' ? Math.ceil(numeric) : Math.ceil(numeric * 1000);
    }
  }

  return undefined;
}

function extractGeminiErrorDetail(rawBody: string, status: number): string {
  try {
    const parsedJson: unknown = JSON.parse(rawBody);
    const parsedError = geminiErrorEnvelopeSchema.safeParse(parsedJson);
    if (parsedError.success && parsedError.data.error?.message) {
      return parsedError.data.error.message;
    }
  } catch {
    const trimmed = rawBody.replace(/\s+/g, ' ').trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return `HTTP ${status}`;
}

/**
 * Shared Google Gemini REST JSON transport built on JsonHttpClient.
 */
export class GeminiHttpClient {
  private readonly client: JsonHttpClient;

  constructor(options: GeminiClientOptions) {
    const trimmedKey = options.apiKey.trim();
    if (!trimmedKey) {
      throw new AIProviderNotConfiguredError(
        PROVIDER_NAME,
        'GEMINI_API_KEY is required for Gemini provider',
      );
    }

    this.client = new JsonHttpClient({
      providerName: PROVIDER_NAME,
      baseUrl: options.baseUrl ?? DEFAULT_GEMINI_BASE_URL,
      headers: {
        'x-goog-api-key': trimmedKey,
      },
      secretsToRedact: [trimmedKey],
      timeoutMs: options.timeoutMs,
      maxRetries: options.maxRetries,
      retryBaseDelayMs: options.retryBaseDelayMs,
      fetchImpl: options.fetchImpl,
      sleepImpl: options.sleepImpl,
      extractErrorDetail: extractGeminiErrorDetail,
      extractRetryAfterMs: extractGeminiRetryAfterMs,
    });
  }

  public postJson<TResponse>(
    path: string,
    body: unknown,
    schema: z.ZodType<TResponse>,
    signal?: AbortSignal,
  ): Promise<TResponse> {
    return this.client.postJson(path, body, schema, signal);
  }
}
