export type LLMMessageRole = 'system' | 'user' | 'assistant';

export interface LLMMessage {
  role: LLMMessageRole;
  content: string;
}

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export type LLMResponseFormat = 'text' | 'json_object';

export interface LLMGenerateRequest {
  systemPrompt: string;
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: LLMResponseFormat;
  signal?: AbortSignal;
}

export interface LLMGenerateResult {
  content: string;
  model: string;
  finishReason?: string;
  usage?: LLMUsage;
  latencyMs: number;
}

/**
 * Replaceable chat/completion LLM provider contract (e.g., OpenAI, future Ollama).
 */
export interface LLMProvider {
  readonly providerName: string;
  readonly model: string;
  generate(request: LLMGenerateRequest): Promise<LLMGenerateResult>;
}
