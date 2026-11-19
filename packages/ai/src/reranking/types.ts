import type { RetrievedChunk } from '@enterprise-ai/shared';

export interface RerankScoreBreakdown<
  TChunk extends RetrievedChunk = RetrievedChunk,
> {
  chunk: TChunk;
  rerankScore: number;
  baseScore: number;
  lexicalOverlapScore: number;
  exactPhraseBoost: number;
  matchedTerms: string[];
}

export interface RerankResult<TChunk extends RetrievedChunk = RetrievedChunk> {
  chunks: TChunk[];
  scores: RerankScoreBreakdown<TChunk>[];
}

/**
 * Contract for reranking retrieved document chunks before context assembly.
 */
export interface RerankerService {
  rerank<TChunk extends RetrievedChunk = RetrievedChunk>(
    query: string,
    chunks: readonly TChunk[],
    topK?: number,
  ): Promise<TChunk[]>;
}
