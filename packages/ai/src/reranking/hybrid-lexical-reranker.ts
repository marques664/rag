import type { RetrievedChunk } from '@enterprise-ai/shared';
import { AIInvalidRequestError } from '../errors/ai-error.js';
import type {
  RerankerService,
  RerankResult,
  RerankScoreBreakdown,
} from './types.js';

export interface HybridLexicalRerankerOptions {
  baseWeight?: number;
  lexicalWeight?: number;
  phraseWeight?: number;
}

interface ChunkWithOptionalRrf {
  rrfScore?: number;
}

const DEFAULT_BASE_WEIGHT = 0.55;
const DEFAULT_LEXICAL_WEIGHT = 0.3;
const DEFAULT_PHRASE_WEIGHT = 0.15;
const MIN_EXACT_PHRASE_LENGTH = 3;

const RERANKER_STOPWORDS = new Set([
  'a', 'ao', 'aos', 'as', 'com', 'como', 'da', 'das', 'de', 'do', 'dos',
  'e', 'em', 'essa', 'esse', 'esta', 'este', 'na', 'nas', 'no', 'nos',
  'o', 'os', 'ou', 'para', 'pela', 'pelo', 'por', 'qual', 'quais', 'que',
  'sao', 'se', 'sem', 'ser', 'sobre', 'um', 'uma', 'lista', 'realizar',
  'an', 'and', 'are', 'at', 'by', 'for', 'from', 'how', 'in', 'is', 'of',
  'on', 'or', 'the', 'to', 'what', 'which', 'with',
]);

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function foldForLexicalMatch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function tokenizeNormalized(foldedText: string): string[] {
  const matches = foldedText.match(/[\p{L}\p{N}]+/gu);
  if (!matches || matches.length === 0) {
    return [];
  }

  const longerTokens = matches.filter((token) => token.length >= 2);
  return longerTokens.length > 0 ? longerTokens : matches;
}

function normalizeWhitespace(foldedText: string): string {
  return foldedText.replace(/\s+/g, ' ').trim();
}

/**
 * Deterministic, dependency-free reranker combining normalized retrieval score
 * (similarity or RRF score) with query term overlap and exact phrase matching.
 */
export class HybridLexicalReranker implements RerankerService {
  private readonly baseWeight: number;
  private readonly lexicalWeight: number;
  private readonly phraseWeight: number;

  constructor(options: HybridLexicalRerankerOptions = {}) {
    const baseWeight = options.baseWeight ?? DEFAULT_BASE_WEIGHT;
    const lexicalWeight = options.lexicalWeight ?? DEFAULT_LEXICAL_WEIGHT;
    const phraseWeight = options.phraseWeight ?? DEFAULT_PHRASE_WEIGHT;

    const weights = [baseWeight, lexicalWeight, phraseWeight];
    if (
      weights.some((weight) => !Number.isFinite(weight) || weight < 0) ||
      baseWeight + lexicalWeight + phraseWeight <= 0
    ) {
      throw new AIInvalidRequestError(
        'reranker',
        'Reranker weights must be non-negative finite numbers with a positive sum',
      );
    }

    const total = baseWeight + lexicalWeight + phraseWeight;
    this.baseWeight = baseWeight / total;
    this.lexicalWeight = lexicalWeight / total;
    this.phraseWeight = phraseWeight / total;
  }

  public async rerank<TChunk extends RetrievedChunk = RetrievedChunk>(
    query: string,
    chunks: readonly TChunk[],
    topK?: number,
  ): Promise<TChunk[]> {
    return this.rerankDetailed(query, chunks, topK).chunks;
  }

  public rerankDetailed<TChunk extends RetrievedChunk = RetrievedChunk>(
    query: string,
    chunks: readonly TChunk[],
    topK?: number,
  ): RerankResult<TChunk> {
    if (topK !== undefined && (!Number.isInteger(topK) || topK < 0)) {
      throw new AIInvalidRequestError(
        'reranker',
        'topK must be a non-negative integer',
      );
    }

    if (chunks.length === 0 || topK === 0) {
      return { chunks: [], scores: [] };
    }

    const maxRrfScore = this.findMaxRrfScore(chunks);
    const foldedQuery = normalizeWhitespace(foldForLexicalMatch(query));
    const rawQueryTokens = tokenizeNormalized(foldedQuery);
    const filteredQueryTokens = rawQueryTokens.filter(
      (token) => !RERANKER_STOPWORDS.has(token),
    );
    const uniqueQueryTerms = Array.from(
      new Set(
        filteredQueryTokens.length > 0 ? filteredQueryTokens : rawQueryTokens,
      ),
    );

    if (uniqueQueryTerms.length === 0) {
      const sliced = topK !== undefined ? chunks.slice(0, topK) : [...chunks];
      const scores = sliced.map((chunk) => {
        const baseScore = this.resolveBaseScore(chunk, maxRrfScore);
        return {
          chunk,
          rerankScore: baseScore,
          baseScore,
          lexicalOverlapScore: 0,
          exactPhraseBoost: 0,
          matchedTerms: [],
        };
      });
      return { chunks: sliced, scores };
    }

    const scored = chunks.map((chunk, originalIndex) => {
      const baseScore = this.resolveBaseScore(chunk, maxRrfScore);
      const foldedContent = foldForLexicalMatch(chunk.content);
      const contentTokens = new Set(tokenizeNormalized(foldedContent));

      const matchedTerms = uniqueQueryTerms.filter((term) =>
        contentTokens.has(term),
      );
      const lexicalOverlapScore = matchedTerms.length / uniqueQueryTerms.length;

      const normalizedContent = normalizeWhitespace(foldedContent);
      const exactPhraseBoost =
        foldedQuery.length >= MIN_EXACT_PHRASE_LENGTH &&
        normalizedContent.includes(foldedQuery)
          ? 1
          : 0;

      const rerankScore = Number(
        (
          this.baseWeight * baseScore +
          this.lexicalWeight * lexicalOverlapScore +
          this.phraseWeight * exactPhraseBoost
        ).toFixed(6),
      );

      return {
        originalIndex,
        breakdown: {
          chunk,
          rerankScore,
          baseScore,
          lexicalOverlapScore,
          exactPhraseBoost,
          matchedTerms,
        } satisfies RerankScoreBreakdown<TChunk>,
      };
    });

    scored.sort(
      (a, b) =>
        b.breakdown.rerankScore - a.breakdown.rerankScore ||
        b.breakdown.baseScore - a.breakdown.baseScore ||
        a.originalIndex - b.originalIndex,
    );

    const limited = topK !== undefined ? scored.slice(0, topK) : scored;
    return {
      chunks: limited.map((entry) => entry.breakdown.chunk),
      scores: limited.map((entry) => entry.breakdown),
    };
  }

  private findMaxRrfScore(chunks: readonly RetrievedChunk[]): number {
    let maxRrf = 0;
    for (const chunk of chunks) {
      const candidate = (chunk as RetrievedChunk & ChunkWithOptionalRrf)
        .rrfScore;
      if (
        typeof candidate === 'number' &&
        Number.isFinite(candidate) &&
        candidate > maxRrf
      ) {
        maxRrf = candidate;
      }
    }
    return maxRrf;
  }

  private resolveBaseScore(
    chunk: RetrievedChunk,
    maxRrfScore: number,
  ): number {
    if (maxRrfScore > 0) {
      const candidate = (chunk as RetrievedChunk & ChunkWithOptionalRrf)
        .rrfScore;
      if (
        typeof candidate === 'number' &&
        Number.isFinite(candidate) &&
        candidate >= 0
      ) {
        return clamp01(candidate / maxRrfScore);
      }
    }
    return clamp01(chunk.similarity);
  }
}
