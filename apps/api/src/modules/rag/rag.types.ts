import type { EmbeddingProvider, LLMProvider } from '@enterprise-ai/ai';
import type {
  Citation,
  RAGResponse,
  RetrievalService,
  RetrievedChunk,
  UsageInformation,
} from '@enterprise-ai/shared';

export type {
  Citation,
  RAGResponse,
  RetrievalService,
  RetrievedChunk,
  UsageInformation,
};

export interface ContextAssemblyOptions {
  maxContextChars?: number;
}

export interface AssembledSource {
  index: number;
  chunk: RetrievedChunk;
}

export interface AssembledContext {
  formattedContext: string;
  sources: readonly AssembledSource[];
  chunksById: ReadonlyMap<string, RetrievedChunk>;
  includedChunkIds: readonly string[];
  truncatedChunkIds: readonly string[];
}

export interface ContextAssemblyService {
  assemble(
    chunks: readonly RetrievedChunk[],
    options?: ContextAssemblyOptions,
  ): AssembledContext;
}

export interface AnswerQuestionInput {
  organizationId: string;
  question: string;
  topK?: number;
  minSimilarity?: number;
  documentIds?: string[];
  signal?: AbortSignal;
}

export interface StructuredLLMOutput {
  answer: string;
  insufficientContext: boolean;
  citedChunkIds: string[];
}

export interface RagServiceDependencies {
  embeddingProvider: EmbeddingProvider;
  retrievalService: RetrievalService;
  llmProvider: LLMProvider;
  contextAssemblyService?: ContextAssemblyService;
  defaultTopK?: number;
  maxContextChars?: number;
}
