import { z } from 'zod';
import { DEFAULT_OPENAI_CHAT_MODEL } from '../config/ai-config.js';
import {
  AIInvalidRequestError,
  AIInvalidResponseError,
} from '../errors/ai-error.js';
import {
  OpenAIHttpClient,
  type OpenAIClientOptions,
} from '../providers/openai-http.js';
import type {
  LLMGenerateRequest,
  LLMGenerateResult,
  LLMProvider,
  LLMUsage,
} from './types.js';

export interface OpenAILLMProviderOptions extends OpenAIClientOptions {
  model?: string;
}

const openAIChatResponseSchema = z.object({
  model: z.string().min(1).optional(),
  choices: z
    .array(
      z.object({
        index: z.number().int().nonnegative().optional(),
        message: z.object({
          role: z.string().optional(),
          content: z.string().nullable().optional(),
        }),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative(),
      completion_tokens: z.number().int().nonnegative(),
      total_tokens: z.number().int().nonnegative(),
    })
    .optional(),
});

const PROVIDER_NAME = 'openai';

/**
 * OpenAI chat completions LLM provider with grounded system prompt support,
 * optional JSON object response mode, usage extraction, and latency measurement.
 */
export class OpenAILLMProvider implements LLMProvider {
  public readonly providerName = PROVIDER_NAME;
  public readonly model: string;
  private readonly client: OpenAIHttpClient;

  constructor(options: OpenAILLMProviderOptions) {
    const model = (options.model ?? DEFAULT_OPENAI_CHAT_MODEL).trim();
    if (!model) {
      throw new AIInvalidRequestError(
        PROVIDER_NAME,
        'LLM model name must be non-empty',
      );
    }

    this.model = model;
    this.client = new OpenAIHttpClient(options);
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
    };

    if (request.temperature !== undefined) {
      payload.temperature = request.temperature;
    }
    if (request.maxTokens !== undefined) {
      payload.max_tokens = request.maxTokens;
    }
    if (request.responseFormat === 'json_object') {
      payload.response_format = { type: 'json_object' };
    }

    const startTime = performance.now();
    const response = await this.client.postJson(
      '/chat/completions',
      payload,
      openAIChatResponseSchema,
      request.signal,
    );
    const latencyMs = Math.max(0, Math.round(performance.now() - startTime));

    const firstChoice = response.choices[0];
    const content = firstChoice?.message?.content;
    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new AIInvalidResponseError(
        PROVIDER_NAME,
        'OpenAI returned an empty completion message',
      );
    }

    const usage: LLMUsage | undefined = response.usage
      ? {
          inputTokens: response.usage.prompt_tokens,
          outputTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
        }
      : undefined;

    return {
      content,
      model: response.model ?? this.model,
      finishReason: firstChoice?.finish_reason ?? undefined,
      usage,
      latencyMs,
    };
  }
}
