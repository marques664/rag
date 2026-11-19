export interface EmbeddingUsage {
  inputTokens: number;
  totalTokens: number;
}

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  dimensions: number;
  usage?: EmbeddingUsage;
  latencyMs: number;
}

export interface BatchEmbeddingResult {
  embeddings: number[][];
  model: string;
  dimensions: number;
  usage?: EmbeddingUsage;
  latencyMs: number;
}

export interface EmbeddingRequestOptions {
  signal?: AbortSignal;
}

/**
 * Replaceable vector embedding provider contract (e.g., OpenAI, future Ollama).
 */
export interface EmbeddingProvider {
  readonly providerName: string;
  readonly model: string;
  readonly dimensions: number;
  embedQuery(
    text: string,
    options?: EmbeddingRequestOptions,
  ): Promise<EmbeddingResult>;
  embedDocuments(
    texts: string[],
    options?: EmbeddingRequestOptions,
  ): Promise<BatchEmbeddingResult>;
}
