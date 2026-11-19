import {
  DEFAULT_GROQ_BASE_URL,
  DEFAULT_GROQ_CHAT_MODEL,
} from '../config/ai-config.js';
import type { OpenAIClientOptions } from '../providers/openai-http.js';
import { OpenAILLMProvider } from './openai-llm.provider.js';

export interface GroqLLMProviderOptions
  extends Omit<OpenAIClientOptions, 'providerName' | 'missingKeyMessage'> {
  model?: string;
}

/**
 * Groq OpenAI-compatible chat completions provider (https://api.groq.com/openai/v1).
 * Reuses OpenAILLMProvider HTTP/retry/Zod parsing without duplicating transport logic.
 */
export class GroqLLMProvider extends OpenAILLMProvider {
  constructor(options: GroqLLMProviderOptions) {
    super({
      ...options,
      providerName: 'groq',
      missingKeyMessage: 'GROQ_API_KEY is required for Groq provider',
      baseUrl: options.baseUrl ?? DEFAULT_GROQ_BASE_URL,
      model: options.model ?? DEFAULT_GROQ_CHAT_MODEL,
    });
  }
}
