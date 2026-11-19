import { z } from 'zod';
import { DEFAULT_OLLAMA_BASE_URL } from '../config/ai-config.js';
import {
  JsonHttpClient,
  type FetchLike,
  type SleepLike,
} from './http-client.js';

export interface OllamaClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  fetchImpl?: FetchLike;
  sleepImpl?: SleepLike;
}

const PROVIDER_NAME = 'ollama';

const ollamaErrorEnvelopeSchema = z.object({
  error: z.string().optional(),
});

function extractOllamaErrorDetail(rawBody: string, status: number): string {
  try {
    const parsedJson: unknown = JSON.parse(rawBody);
    const parsedError = ollamaErrorEnvelopeSchema.safeParse(parsedJson);
    if (parsedError.success && parsedError.data.error) {
      return parsedError.data.error;
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
 * Shared Ollama REST JSON transport built on JsonHttpClient.
 */
export class OllamaHttpClient {
  private readonly client: JsonHttpClient;

  constructor(options: OllamaClientOptions = {}) {
    this.client = new JsonHttpClient({
      providerName: PROVIDER_NAME,
      baseUrl: options.baseUrl ?? DEFAULT_OLLAMA_BASE_URL,
      timeoutMs: options.timeoutMs,
      maxRetries: options.maxRetries,
      retryBaseDelayMs: options.retryBaseDelayMs,
      fetchImpl: options.fetchImpl,
      sleepImpl: options.sleepImpl,
      extractErrorDetail: extractOllamaErrorDetail,
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
