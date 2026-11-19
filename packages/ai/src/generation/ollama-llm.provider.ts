import { z } from 'zod';
import { DEFAULT_OLLAMA_CHAT_MODEL } from '../config/ai-config.js';
import {
  AIInvalidRequestError,
  AIInvalidResponseError,
} from '../errors/ai-error.js';
import {
  OllamaHttpClient,
  type OllamaClientOptions,
} from '../providers/ollama-http.js';
import type {
  LLMGenerateRequest,
  LLMGenerateResult,
  LLMProvider,
  LLMUsage,
} from './types.js';

export interface OllamaLLMProviderOptions extends OllamaClientOptions {
  model?: string;
}

const ollamaChatResponseSchema = z.object({
  model: z.string().min(1).optional(),
  message: z.object({
    role: z.string().optional(),
    content: z.string().nullable().optional(),
  }),
  done: z.boolean().optional(),
  done_reason: z.string().nullable().optional(),
  prompt_eval_count: z.number().int().nonnegative().optional(),
  eval_count: z.number().int().nonnegative().optional(),
});

const PROVIDER_NAME = 'ollama';

/**
 * Local Ollama chat provider calling POST /api/chat (stream: false) with
 * JSON response format support, usage extraction, and latency measurement.
 */
export class OllamaLLMProvider implements LLMProvider {
  public readonly providerName = PROVIDER_NAME;
  public readonly model: string;
  private readonly client: OllamaHttpClient;

  constructor(options: OllamaLLMProviderOptions = {}) {
    const model = (options.model ?? DEFAULT_OLLAMA_CHAT_MODEL).trim();
    if (!model) {
      throw new AIInvalidRequestError(
        PROVIDER_NAME,
        'LLM model name must be non-empty',
      );
    }

    this.model = model;
    this.client = new OllamaHttpClient(options);
  }

  public async generate(
    request: LLMGenerateRequest,
  ): Promise<LLMGenerateResult> {
    if (
      typeof request.systemPrompt !== 'string' ||
      request.systemPrompt.trim().length === 0
    ) {
      throw new AIInvalidRequestError(
        PROVIDER_NAME,
        'systemPrompt must be non-empty',
      );
    }

    if (!Array.isArray(request.messages) || request.messages.length === 0) {
      throw new AIInvalidRequestError(
        PROVIDER_NAME,
        'messages must contain at least one message',
      );
    }

    for (let i = 0; i < request.messages.length; i += 1) {
      const msg = request.messages[i];
      if (!msg || msg.content.trim().length === 0) {
        throw new AIInvalidRequestError(
          PROVIDER_NAME,
          `Message at index ${i} must have non-empty content`,
        );
      }
    }

    const payload: Record<string, unknown> = {
      model: this.model,
      messages: [
        { role: 'system', content: request.systemPrompt },
        ...request.messages,
      ],
      stream: false,
    };

    if (request.responseFormat === 'json_object') {
      payload.format = 'json';
    }

    const modelOptions: Record<string, number> = {};
    if (request.temperature !== undefined) {
      modelOptions.temperature = request.temperature;
    }
    if (request.maxTokens !== undefined) {
      modelOptions.num_predict = request.maxTokens;
    }
    if (Object.keys(modelOptions).length > 0) {
      payload.options = modelOptions;
    }

    const startTime = performance.now();
    const response = await this.client.postJson(
      '/api/chat',
      payload,
      ollamaChatResponseSchema,
      request.signal,
    );
    const latencyMs = Math.max(0, Math.round(performance.now() - startTime));

    const content = response.message.content;
    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new AIInvalidResponseError(
        PROVIDER_NAME,
        'Ollama returned an empty completion message',
      );
    }

    let usage: LLMUsage | undefined;
    if (
      response.prompt_eval_count !== undefined ||
      response.eval_count !== undefined
    ) {
      const inputTokens = response.prompt_eval_count ?? 0;
      const outputTokens = response.eval_count ?? 0;
      usage = {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      };
    }

    return {
      content,
      model: response.model ?? this.model,
      finishReason: response.done_reason ?? undefined,
      usage,
      latencyMs,
    };
  }
}
