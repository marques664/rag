import { z } from 'zod';
import { DEFAULT_OPENAI_BASE_URL } from '../config/ai-config.js';
import { AIProviderNotConfiguredError } from '../errors/ai-error.js';
import {
  JsonHttpClient,
  type FetchLike,
  type SleepLike,
} from './http-client.js';

export type { FetchLike, SleepLike } from './http-client.js';

export interface OpenAIClientOptions {
  apiKey: string;
  baseUrl?: string;
  providerName?: string;
  missingKeyMessage?: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  fetchImpl?: FetchLike;
  sleepImpl?: SleepLike;
}

const DEFAULT_PROVIDER_NAME = 'openai';

const openAIErrorEnvelopeSchema = z.object({
  error: z
    .object({
      message: z.string().optional(),
      type: z.string().optional(),
      code: z.union([z.string(), z.number()]).nullable().optional(),
    })
    .optional(),
});

function extractOpenAIErrorDetail(rawBody: string, status: number): string {
  try {
    const parsedJson: unknown = JSON.parse(rawBody);
    const parsedError = openAIErrorEnvelopeSchema.safeParse(parsedJson);
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
 * Shared OpenAI REST JSON transport built on JsonHttpClient.
 */
export class OpenAIHttpClient {
  private readonly client: JsonHttpClient;

  constructor(options: OpenAIClientOptions) {
    const providerName = options.providerName ?? DEFAULT_PROVIDER_NAME;
    const trimmedKey = options.apiKey.trim();
    if (!trimmedKey) {
      throw new AIProviderNotConfiguredError(
        providerName,
        options.missingKeyMessage ??
          'OPENAI_API_KEY is required for OpenAI provider',
      );
    }

    this.client = new JsonHttpClient({
      providerName,
      baseUrl: options.baseUrl ?? DEFAULT_OPENAI_BASE_URL,
      headers: {
        Authorization: `Bearer ${trimmedKey}`,
      },
      secretsToRedact: [trimmedKey],
      timeoutMs: options.timeoutMs,
      maxRetries: options.maxRetries,
      retryBaseDelayMs: options.retryBaseDelayMs,
      fetchImpl: options.fetchImpl,
      sleepImpl: options.sleepImpl,
      extractErrorDetail: extractOpenAIErrorDetail,
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
