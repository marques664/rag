import {
  DEFAULT_RETRIEVAL_TOP_K,
  DEFAULT_RRF_K,
  EMBEDDING_DIMENSIONS,
  MAX_RETRIEVAL_TOP_K,
  RETRIEVAL_STRATEGIES,
  type DocumentChunkMetadata,
  type RetrievalMatchSource,
  type RetrievalService,
  type RetrievalStrategy,
  type RetrieveChunksInput,
  type RetrievedChunk,
} from '@enterprise-ai/shared';
import { Prisma } from './generated/prisma/client.js';
import {
  PgVectorRetrievalService,
  type SqlQueryDatabase,
} from './retrieval.js';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_CANDIDATE_MULTIPLIER = 3;

const LEXICAL_QUERY_STOPWORDS = new Set([
  // Portuguese grammatical/question words that break strict AND FTS matching
  'a',
  'ao',
  'aos',
  'as',
  'à',
  'às',
  'com',
  'como',
  'da',
  'das',
  'de',
  'deve',
  'devo',
  'do',
  'dos',
  'e',
  'é',
  'em',
  'essa',
  'esse',
  'esta',
  'este',
  'foi',
  'na',
  'nas',
  'no',
  'nos',
  'o',
  'os',
  'ou',
  'para',
  'pela',
  'pelas',
  'pelo',
  'pelos',
  'pode',
  'podem',
  'por',
  'porque',
  'posso',
  'qual',
  'quais',
  'quando',
  'que',
  'quem',
  'são',
  'se',
  'sem',
  'ser',
  'sob',
  'sobre',
  'ter',
  'um',
  'uma',
  'umas',
  'uns',
  'lista',
  'listar',
  'realizar',
  'fazer',
  'usar',
  'tipo',
  'tipos',
  'forma',
  'maneira',
  'dizer',
  'diz',
  'falar',
  'fala',
  'explicar',
  'explica',
  'funciona',
  'funcionar',
  // English grammatical/question words
  'an',
  'and',
  'are',
  'at',
  'be',
  'been',
  'by',
  'can',
  'could',
  'describe',
  'did',
  'do',
  'does',
  'explain',
  'for',
  'from',
  'how',
  'in',
  'is',
  'list',
  'may',
  'tell',
  'type',
  'types',
  'use',
  'using',
  'way',
  'might',
  'of',
  'on',
  'or',
  'should',
  'that',
  'the',
  'these',
  'this',
  'those',
  'to',
  'was',
  'were',
  'what',
  'when',
  'where',
  'which',
  'who',
  'whom',
  'whose',
  'why',
  'with',
  'without',
  'would',
]);

/**
 * Builds a safe websearch OR-query from natural language questions so chunks
 * matching key content terms are still retrieved even when conversational
 * question words do not all co-occur inside a single chunk.
 */
function buildRelaxedWebsearchQuery(queryText: string): string {
  const rawTokens = queryText.match(/[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu);
  if (!rawTokens || rawTokens.length === 0) {
    return queryText.trim();
  }

  const seen = new Set<string>();
  const allTokens: string[] = [];
  const contentTokens: string[] = [];

  for (const token of rawTokens) {
    const normalized = token.toLowerCase();
    if (seen.has(normalized) || normalized === 'or') {
      continue;
    }
    seen.add(normalized);
    allTokens.push(token);
    if (normalized.length >= 2 && !LEXICAL_QUERY_STOPWORDS.has(normalized)) {
      contentTokens.push(token);
    }
  }

  const selected = contentTokens.length > 0 ? contentTokens : allTokens;
  return selected.join(' OR ');
}

export interface HybridRetrievalOptions {
  defaultStrategy?: RetrievalStrategy;
  defaultTopK?: number;
  expectedDimensions?: number;
  rrfK?: number;
  candidateMultiplier?: number;
  semanticRetriever?: RetrievalService;
}

export interface ReciprocalRankFusionInput {
  semanticChunks: readonly RetrievedChunk[];
  lexicalChunks: readonly RetrievedChunk[];
  topK: number;
  rrfK?: number;
  semanticWeight?: number;
  lexicalWeight?: number;
}

interface LexicalChunkRow {
  chunkId: string;
  documentId: string;
  filename: string;
  pageNumber: number;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  metadata: unknown;
  lexicalScore: number;
}

function assertUuid(value: string, fieldName: string): void {
  if (!UUID_REGEX.test(value)) {
    throw new Error(`${fieldName} must be a valid UUID`);
  }
}

function validateTopK(value: number, fieldName: string): number {
  if (
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_RETRIEVAL_TOP_K
  ) {
    throw new Error(
      `${fieldName} must be an integer between 1 and ${MAX_RETRIEVAL_TOP_K}`,
    );
  }
  return value;
}

function validateStrategy(value: string): RetrievalStrategy {
  if (!(RETRIEVAL_STRATEGIES as readonly string[]).includes(value)) {
    throw new Error(
      `Unsupported retrieval strategy: ${value}. Expected one of ${RETRIEVAL_STRATEGIES.join(', ')}`,
    );
  }
  return value as RetrievalStrategy;
}

function normalizeMetadata(
  raw: unknown,
  fallback: { pageNumber: number; chunkIndex: number; tokenCount: number },
): DocumentChunkMetadata {
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    return {
      pageNumber: fallback.pageNumber,
      chunkIndex: fallback.chunkIndex,
      tokenCount: fallback.tokenCount,
      ...(raw as Record<string, unknown>),
    };
  }
  return fallback;
}

/**
 * Fuses ranked semantic and lexical retrieval results using Reciprocal Rank Fusion:
 * score(chunk) = sum(1 / (k + rank_i)) across matching retrieval lists.
 */
export function fuseWithReciprocalRankFusion(
  input: ReciprocalRankFusionInput,
): RetrievedChunk[] {
  const topK = validateTopK(input.topK, 'topK');
  const rrfK = input.rrfK ?? DEFAULT_RRF_K;
  if (!Number.isFinite(rrfK) || rrfK <= 0) {
    throw new Error('rrfK must be a positive finite number');
  }
  const semanticWeight = input.semanticWeight ?? 1;
  const lexicalWeight = input.lexicalWeight ?? 1;

  interface FusedEntry {
    chunk: RetrievedChunk;
    matchedBy: Set<RetrievalMatchSource>;
    semanticRank?: number;
    lexicalRank?: number;
    rrfScore: number;
  }

  const byChunkId = new Map<string, FusedEntry>();

  input.semanticChunks.forEach((chunk, index) => {
    const rank = index + 1;
    const contribution = semanticWeight / (rrfK + rank);
    const existing = byChunkId.get(chunk.chunkId);

    if (existing) {
      if (existing.semanticRank === undefined) {
        existing.semanticRank = rank;
        existing.rrfScore += contribution;
        existing.matchedBy.add('semantic');
      }
      return;
    }

    byChunkId.set(chunk.chunkId, {
      chunk,
      matchedBy: new Set<RetrievalMatchSource>(['semantic']),
      semanticRank: rank,
      rrfScore: contribution,
    });
  });

  input.lexicalChunks.forEach((chunk, index) => {
    const rank = index + 1;
    const contribution = lexicalWeight / (rrfK + rank);
    const existing = byChunkId.get(chunk.chunkId);

    if (existing) {
      if (existing.lexicalRank === undefined) {
        existing.lexicalRank = rank;
        existing.rrfScore += contribution;
        existing.matchedBy.add('lexical');
      }
      return;
    }

    byChunkId.set(chunk.chunkId, {
      chunk,
      matchedBy: new Set<RetrievalMatchSource>(['lexical']),
      lexicalRank: rank,
      rrfScore: contribution,
    });
  });

  return Array.from(byChunkId.values())
    .sort((a, b) => {
      if (b.rrfScore !== a.rrfScore) {
        return b.rrfScore - a.rrfScore;
      }
      if (b.matchedBy.size !== a.matchedBy.size) {
        return b.matchedBy.size - a.matchedBy.size;
      }
      if (b.chunk.similarity !== a.chunk.similarity) {
        return b.chunk.similarity - a.chunk.similarity;
      }
      return a.chunk.chunkId.localeCompare(b.chunk.chunkId);
    })
    .slice(0, topK)
    .map((entry) => ({
      ...entry.chunk,
      matchedBy: Array.from(entry.matchedBy),
      ...(entry.semanticRank !== undefined
        ? { semanticRank: entry.semanticRank }
        : {}),
      ...(entry.lexicalRank !== undefined
        ? { lexicalRank: entry.lexicalRank }
        : {}),
      rrfScore: entry.rrfScore,
    }));
}

/**
 * Tenant-isolated retrieval supporting semantic (`pgvector`), lexical (PostgreSQL FTS),
 * and hybrid Reciprocal Rank Fusion (`k = 60`). Every SQL leg enforces `organization_id`
 * and `COMPLETED` document status directly in PostgreSQL.
 */
export class HybridRetrievalService implements RetrievalService {
  private readonly defaultStrategy: RetrievalStrategy;
  private readonly defaultTopK: number;
  private readonly rrfK: number;
  private readonly candidateMultiplier: number;
  private readonly semanticRetriever: RetrievalService;

  constructor(
    private readonly db: SqlQueryDatabase,
    options: HybridRetrievalOptions = {},
  ) {
    this.defaultStrategy = validateStrategy(
      options.defaultStrategy ?? 'semantic',
    );
    this.defaultTopK = validateTopK(
      options.defaultTopK ?? DEFAULT_RETRIEVAL_TOP_K,
      'defaultTopK',
    );

    const rrfK = options.rrfK ?? DEFAULT_RRF_K;
    if (!Number.isFinite(rrfK) || rrfK <= 0) {
      throw new Error('rrfK must be a positive finite number');
    }
    this.rrfK = rrfK;

    const candidateMultiplier =
      options.candidateMultiplier ?? DEFAULT_CANDIDATE_MULTIPLIER;
    if (!Number.isInteger(candidateMultiplier) || candidateMultiplier < 1) {
      throw new Error('candidateMultiplier must be a positive integer');
    }
    this.candidateMultiplier = candidateMultiplier;

    this.semanticRetriever =
      options.semanticRetriever ??
      new PgVectorRetrievalService(db, {
        defaultTopK: this.defaultTopK,
        expectedDimensions: options.expectedDimensions ?? EMBEDDING_DIMENSIONS,
      });
  }

  public async retrieve(input: RetrieveChunksInput): Promise<RetrievedChunk[]> {
    assertUuid(input.organizationId, 'organizationId');

    const strategy = validateStrategy(input.strategy ?? this.defaultStrategy);
    const topK = validateTopK(input.topK ?? this.defaultTopK, 'topK');

    let uniqueDocumentIds: string[] | undefined;
    if (input.documentIds !== undefined) {
      if (input.documentIds.length === 0) {
        return [];
      }
      uniqueDocumentIds = Array.from(new Set(input.documentIds));
      for (const documentId of uniqueDocumentIds) {
        assertUuid(documentId, 'documentIds[]');
      }
    }

    if (strategy === 'semantic') {
      const semantic = await this.semanticRetriever.retrieve({
        ...input,
        topK,
        documentIds: uniqueDocumentIds,
      });
      return semantic.map((chunk, index) => ({
        ...chunk,
        matchedBy: chunk.matchedBy ?? ['semantic'],
        semanticRank: chunk.semanticRank ?? index + 1,
      }));
    }

    const normalizedQueryText = input.queryText?.trim() ?? '';

    if (strategy === 'lexical') {
      if (!normalizedQueryText) {
        throw new Error('queryText is required for lexical retrieval');
      }
      return this.retrieveLexical({
        organizationId: input.organizationId,
        queryText: normalizedQueryText,
        limit: topK,
        documentIds: uniqueDocumentIds,
      });
    }

    // Hybrid mode: if queryText is empty, fall back cleanly to semantic retrieval.
    if (!normalizedQueryText) {
      const semantic = await this.semanticRetriever.retrieve({
        ...input,
        topK,
        documentIds: uniqueDocumentIds,
      });
      return semantic.map((chunk, index) => ({
        ...chunk,
        matchedBy: chunk.matchedBy ?? ['semantic'],
        semanticRank: chunk.semanticRank ?? index + 1,
      }));
    }

    const candidateLimit = Math.min(
      MAX_RETRIEVAL_TOP_K,
      Math.max(topK, topK * this.candidateMultiplier),
    );

    const [semanticChunks, lexicalChunks] = await Promise.all([
      this.semanticRetriever.retrieve({
        ...input,
        topK: candidateLimit,
        documentIds: uniqueDocumentIds,
      }),
      this.retrieveLexical({
        organizationId: input.organizationId,
        queryText: normalizedQueryText,
        limit: candidateLimit,
        documentIds: uniqueDocumentIds,
      }),
    ]);

    return fuseWithReciprocalRankFusion({
      semanticChunks,
      lexicalChunks,
      topK,
      rrfK: this.rrfK,
      semanticWeight: 1.6,
      lexicalWeight: 0.7,
    });
  }

  private async retrieveLexical(params: {
    organizationId: string;
    queryText: string;
    limit: number;
    documentIds?: string[];
  }): Promise<RetrievedChunk[]> {
    const documentFilter =
      params.documentIds !== undefined
        ? Prisma.sql`AND dc."document_id" IN (${Prisma.join(
            params.documentIds.map((id) => Prisma.sql`${id}::uuid`),
          )})`
        : Prisma.empty;

    const relaxedQuery = buildRelaxedWebsearchQuery(params.queryText);

    // Primary pass uses the 'simple' GIN index (`document_chunks_content_fts_gin_idx`),
    // prioritizing strict all-term websearch matches (+10.0) while falling back to
    // relaxed OR content-keyword matching so natural-language questions retrieve
    // relevant chunks even when conversational filler words are absent from chunks.
    let rows = await this.db.$queryRaw<LexicalChunkRow[]>(Prisma.sql`
      WITH "fts_queries" AS (
        SELECT
          websearch_to_tsquery('simple', ${params.queryText}) AS "strictQuery",
          websearch_to_tsquery('simple', ${relaxedQuery}) AS "relaxedQuery"
      )
      SELECT
        dc."id"::text AS "chunkId",
        dc."document_id"::text AS "documentId",
        d."filename" AS "filename",
        dc."page_number" AS "pageNumber",
        dc."chunk_index" AS "chunkIndex",
        dc."content" AS "content",
        dc."token_count" AS "tokenCount",
        dc."metadata" AS "metadata",
        (
          CASE
            WHEN to_tsvector('simple', dc."content") @@ q."strictQuery" THEN 10.0
            ELSE 0.0
          END
          + ts_rank_cd(to_tsvector('simple', dc."content"), q."relaxedQuery", 1)
        )::double precision AS "lexicalScore"
      FROM "document_chunks" dc
      INNER JOIN "documents" d
        ON d."id" = dc."document_id"
        AND d."organization_id" = dc."organization_id"
      CROSS JOIN "fts_queries" q
      WHERE dc."organization_id" = ${params.organizationId}::uuid
        AND d."organization_id" = ${params.organizationId}::uuid
        AND d."status" = 'COMPLETED'::"DocumentStatus"
        AND (
          to_tsvector('simple', dc."content") @@ q."strictQuery"
          OR to_tsvector('simple', dc."content") @@ q."relaxedQuery"
        )
        ${documentFilter}
      ORDER BY "lexicalScore" DESC, dc."id" ASC
      LIMIT ${params.limit}::integer
    `);

    // Secondary pass rescues Portuguese inflections/plurals (e.g. "camisetas" vs "camiseta")
    // only when exact 'simple' FTS yielded zero matches.
    if (rows.length === 0) {
      rows = await this.db.$queryRaw<LexicalChunkRow[]>(Prisma.sql`
        WITH "fts_pt_query" AS (
          SELECT websearch_to_tsquery('portuguese', ${relaxedQuery}) AS "ptQuery"
        )
        SELECT
          dc."id"::text AS "chunkId",
          dc."document_id"::text AS "documentId",
          d."filename" AS "filename",
          dc."page_number" AS "pageNumber",
          dc."chunk_index" AS "chunkIndex",
          dc."content" AS "content",
          dc."token_count" AS "tokenCount",
          dc."metadata" AS "metadata",
          ts_rank_cd(
            to_tsvector('portuguese', dc."content"),
            q."ptQuery",
            1
          )::double precision AS "lexicalScore"
        FROM "document_chunks" dc
        INNER JOIN "documents" d
          ON d."id" = dc."document_id"
          AND d."organization_id" = dc."organization_id"
        CROSS JOIN "fts_pt_query" q
        WHERE dc."organization_id" = ${params.organizationId}::uuid
          AND d."organization_id" = ${params.organizationId}::uuid
          AND d."status" = 'COMPLETED'::"DocumentStatus"
          AND to_tsvector('portuguese', dc."content") @@ q."ptQuery"
          ${documentFilter}
        ORDER BY "lexicalScore" DESC, dc."id" ASC
        LIMIT ${params.limit}::integer
      `);
    }

    return rows.map((row, index) => {
      const pageNumber = Number(row.pageNumber);
      const chunkIndex = Number(row.chunkIndex);
      const tokenCount = Number(row.tokenCount);
      const rawScore = Number(row.lexicalScore);
      const lexicalScore =
        Number.isFinite(rawScore) && rawScore > 0 ? rawScore : 0;
      const similarity = lexicalScore / (1 + lexicalScore);
      const distance = 1 - similarity;

      return {
        chunkId: row.chunkId,
        documentId: row.documentId,
        filename: row.filename,
        pageNumber,
        chunkIndex,
        content: row.content,
        tokenCount,
        metadata: normalizeMetadata(row.metadata, {
          pageNumber,
          chunkIndex,
          tokenCount,
        }),
        distance,
        similarity,
        matchedBy: ['lexical'],
        lexicalRank: index + 1,
      };
    });
  }
}
