import type { DocumentChunkMetadata } from './documents.js';

export interface RetrieveChunksInput {
  organizationId: string;
  queryEmbedding: number[];
  topK?: number;
  minSimilarity?: number;
  documentIds?: string[];
}

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  filename: string;
  pageNumber: number;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  metadata: DocumentChunkMetadata;
  distance: number;
  similarity: number;
}

export interface RetrievalService {
  retrieve(input: RetrieveChunksInput): Promise<RetrievedChunk[]>;
}

export interface Citation {
  chunkId: string;
  documentId: string;
  filename: string;
  pageNumber: number;
  chunkIndex: number;
  relevanceScore: number | null;
  excerpt: string;
}

export interface UsageInformation {
  model: string;
  embeddingModel: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  embeddingInputTokens?: number;
  latencyMs: number;
  estimatedCost: number | null;
}

export interface RAGResponse {
  answer: string;
  insufficientContext: boolean;
  citations: Citation[];
  usage: UsageInformation | null;
}
