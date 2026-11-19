import { z } from 'zod';
import { DEFAULT_GEMINI_CHAT_MODEL } from '../config/ai-config.js';
import {
  AIInvalidRequestError,
  AIInvalidResponseError,
} from '../errors/ai-error.js';
import {
  GeminiHttpClient,
  type GeminiClientOptions,
} from '../providers/gemini-http.js';
import type {
  LLMGenerateRequest,
  LLMGenerateResult,
  LLMProvider,
  LLMUsage,
} from './types.js';

export interface GeminiLLMProviderOptions extends GeminiClientOptions {
  model?: string;
}

const geminiGenerateContentResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({
            parts: z
              .array(
                z.object({
                  text: z.string().optional(),
                }),
              )
              .optional(),
          })
          .optional(),
        finishReason: z.string().nullable().optional(),
      }),
    )
    .optional(),
  usageMetadata: z
    .object({
      promptTokenCount: z.number().int().nonnegative().optional(),
      candidatesTokenCount: z.number().int().nonnegative().optional(),
      totalTokenCount: z.number().int().nonnegative().optional(),
    })
    .optional(),
  modelVersion: z.string().min(1).optional(),
});

const PROVIDER_NAME = 'gemini';

function normalizeGeminiModelId(model: string): string {
  return model.replace(/^models\//, '');
}

/**
 * Google Gemini chat provider calling :generateContent with systemInstruction,
 * JSON response MIME type support, usageMetadata extraction, and latency tracking.
 */
export class GeminiLLMProvider implements LLMProvider {
  public readonly providerName = PROVIDER_NAME;
  public readonly model: string;
  private readonly client: GeminiHttpClient;

  constructor(options: GeminiLLMProviderOptions) {
    const model = normalizeGeminiModelId(
      (options.model ?? DEFAULT_GEMINI_CHAT_MODEL).trim(),
    );
    if (!model) {
      throw new AIInvalidRequestError(
        PROVIDER_NAME,
        'LLM model name must be non-empty',
      );
    }

    this.model = model;
    this.client = new GeminiHttpClient(options);
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

    const systemParts: string[] = [request.systemPrompt];
    const contents: Array<{
      role: 'user' | 'model';
      parts: Array<{ text: string }>;
    }> = [];

    for (let i = 0; i < request.messages.length; i += 1) {
      const msg = request.messages[i];
      if (!msg || msg.content.trim().length === 0) {
        throw new AIInvalidRequestError(
          PROVIDER_NAME,
          `Message at index ${i} must have non-empty content`,
        );
      }

      if (msg.role === 'system') {
        systemParts.push(msg.content);
        continue;
      }

      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      });
    }

    if (contents.length === 0) {
      throw new AIInvalidRequestError(
        PROVIDER_NAME,
        'messages must contain at least one user or assistant message',
      );
    }

    const payload: Record<string, unknown> = {
      systemInstruction: {
        parts: [{ text: systemParts.join('\n\n') }],
      },
      contents,
    };

    const generationConfig: Record<string, unknown> = {};
    if (request.temperature !== undefined) {
      generationConfig.temperature = request.temperature;
    }
    if (request.maxTokens !== undefined) {
      generationConfig.maxOutputTokens = request.maxTokens;
    }
    if (request.responseFormat === 'json_object') {
      generationConfig.responseMimeType = 'application/json';
    }
    if (Object.keys(generationConfig).length > 0) {
      payload.generationConfig = generationConfig;
    }

    const startTime = performance.now();
    const response = await this.client.postJson(
      `/models/${encodeURIComponent(this.model)}:generateContent`,
      payload,
      geminiGenerateContentResponseSchema,
      request.signal,
    );
    const latencyMs = Math.max(0, Math.round(performance.now() - startTime));

    const firstCandidate = response.candidates?.[0];
    const parts = firstCandidate?.content?.parts ?? [];
    const content = parts
      .map((part) => (typeof part.text === 'string' ? part.text : ''))
      .join('');

    if (content.trim().length === 0) {
      throw new AIInvalidResponseError(
        PROVIDER_NAME,
        'Gemini returned an empty completion message',
      );
    }

    let usage: LLMUsage | undefined;
    if (
      response.usageMetadata &&
      (response.usageMetadata.promptTokenCount !== undefined ||
        response.usageMetadata.candidatesTokenCount !== undefined ||
        response.usageMetadata.totalTokenCount !== undefined)
    ) {
      const inputTokens = response.usageMetadata.promptTokenCount ?? 0;
      const outputTokens = response.usageMetadata.candidatesTokenCount ?? 0;
      const totalTokens =
        response.usageMetadata.totalTokenCount ?? inputTokens + outputTokens;
      usage = {
        inputTokens,
        outputTokens,
        totalTokens,
      };
    }

    return {
      content,
      model: response.modelVersion ?? this.model,
      finishReason: firstCandidate?.finishReason ?? undefined,
      usage,
      latencyMs,
    };
  }
}
