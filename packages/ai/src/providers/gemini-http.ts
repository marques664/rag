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

const geminiErrorEnvelopeSchema = z.object({
  error: z
    .object({
      message: z.string().optional(),
      status: z.string().optional(),
      code: z.number().optional(),
    })
    .optional(),
});

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
