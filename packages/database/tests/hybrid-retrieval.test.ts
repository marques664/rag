import {
  DEFAULT_RRF_K,
  EMBEDDING_DIMENSIONS,
  MAX_RETRIEVAL_TOP_K,
  type RetrievalService,
  type RetrievedChunk,
} from '@enterprise-ai/shared';
import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../src/generated/prisma/client.js';
import {
  fuseWithReciprocalRankFusion,
  HybridRetrievalService,
} from '../src/hybrid-retrieval.js';
import type { SqlQueryDatabase } from '../src/retrieval.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const DOC_ID = '22222222-2222-4222-8222-222222222222';
const CHUNK_A = '33333333-3333-4333-8333-333333333331';
const CHUNK_B = '33333333-3333-4333-8333-333333333332';
const CHUNK_C = '33333333-3333-4333-8333-333333333333';

function makeUnitVector(hotIndex = 0): number[] {
  const vec = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  vec[hotIndex] = 1;
  return vec;
}

function makeChunk(
  chunkId: string,
  overrides: Partial<RetrievedChunk> = {},
): RetrievedChunk {
  return {
    chunkId,
    documentId: DOC_ID,
    filename: 'manual.pdf',
    pageNumber: 1,
    chunkIndex: 0,
    content: `Content for ${chunkId}`,
    tokenCount: 20,
    metadata: {
      filename: 'manual.pdf',
      pageNumber: 1,
      chunkIndex: 0,
      tokenCount: 20,
    },
    distance: 0.2,
    similarity: 0.8,
    ...overrides,
  };
}

describe('fuseWithReciprocalRankFusion', () => {
  it('boosts chunks appearing in both semantic and lexical lists using k=60', () => {
    const chunkA = makeChunk(CHUNK_A, { similarity: 0.9, distance: 0.1 });
    const chunkB = makeChunk(CHUNK_B, { similarity: 0.85, distance: 0.15 });
    const chunkC = makeChunk(CHUNK_C, { similarity: 0.75, distance: 0.25 });

    // Semantic: [A (rank 1), B (rank 2)]
    // Lexical:  [B (rank 1), C (rank 2)]
    // RRF(B) = 1/(60+2) + 1/(60+1) > RRF(A) = 1/(60+1) > RRF(C) = 1/(60+2)
    const fused = fuseWithReciprocalRankFusion({
      semanticChunks: [chunkA, chunkB],
      lexicalChunks: [chunkB, chunkC],
      topK: 3,
      rrfK: DEFAULT_RRF_K,
    });

    expect(fused.map((c) => c.chunkId)).toEqual([CHUNK_B, CHUNK_A, CHUNK_C]);

    expect(fused[0]!.matchedBy).toEqual(['semantic', 'lexical']);
    expect(fused[0]!.semanticRank).toBe(2);
    expect(fused[0]!.lexicalRank).toBe(1);
    expect(fused[0]!.rrfScore).toBeCloseTo(1 / 62 + 1 / 61, 10);

    expect(fused[1]!.matchedBy).toEqual(['semantic']);
    expect(fused[1]!.semanticRank).toBe(1);
    expect(fused[1]!.lexicalRank).toBeUndefined();
    expect(fused[1]!.rrfScore).toBeCloseTo(1 / 61, 10);

    expect(fused[2]!.matchedBy).toEqual(['lexical']);
    expect(fused[2]!.lexicalRank).toBe(2);
  });

  it('truncates fused results to topK', () => {
    const fused = fuseWithReciprocalRankFusion({
      semanticChunks: [makeChunk(CHUNK_A), makeChunk(CHUNK_B)],
      lexicalChunks: [makeChunk(CHUNK_C)],
      topK: 2,
    });

    expect(fused).toHaveLength(2);
  });
});

describe('HybridRetrievalService', () => {
  it('executes parameterized PostgreSQL FTS query in lexical mode with tenant & COMPLETED guards', async () => {
    let capturedQuery: Prisma.Sql | undefined;
    const db: SqlQueryDatabase = {
      $queryRaw: vi.fn(async (query: Prisma.Sql) => {
        capturedQuery = query;
        return [
          {
            chunkId: CHUNK_A,
            documentId: DOC_ID,
            filename: 'policy.pdf',
            pageNumber: 2,
            chunkIndex: 1,
            content: 'Maintenance procedure for pump X.',
            tokenCount: 14,
            metadata: {
              filename: 'policy.pdf',
              pageNumber: 2,
              chunkIndex: 1,
              tokenCount: 14,
            },
            lexicalScore: 0.5,
          },
        ];
      }) as SqlQueryDatabase['$queryRaw'],
    };

    const service = new HybridRetrievalService(db);
    const results = await service.retrieve({
      organizationId: ORG_ID,
      strategy: 'lexical',
      queryText: 'pump maintenance',
      topK: 4,
      documentIds: [DOC_ID],
    });

    expect(capturedQuery).toBeDefined();
    expect(capturedQuery!.sql).toContain("to_tsvector('simple', dc.\"content\")");
    expect(capturedQuery!.sql).toContain("websearch_to_tsquery('simple',");
    expect(capturedQuery!.sql).toContain('ts_rank_cd(');
    expect(capturedQuery!.sql).toContain('dc."organization_id" =');
    expect(capturedQuery!.sql).toContain('d."organization_id" =');
    expect(capturedQuery!.sql).toContain(
      'd."status" = \'COMPLETED\'::"DocumentStatus"',
    );
    expect(capturedQuery!.sql).toContain('dc."document_id" IN');
    expect(capturedQuery!.values).toContain(ORG_ID);
    expect(capturedQuery!.values).toContain('pump maintenance');
    expect(capturedQuery!.values).toContain('pump OR maintenance');
    expect(capturedQuery!.values).toContain(4);
    expect(capturedQuery!.values).toContain(DOC_ID);

    expect(results).toHaveLength(1);
    expect(results[0]!.chunkId).toBe(CHUNK_A);
    expect(results[0]!.matchedBy).toEqual(['lexical']);
    expect(results[0]!.lexicalRank).toBe(1);
    expect(results[0]!.similarity).toBeCloseTo(0.5 / 1.5, 8);
    expect(results[0]!.distance).toBeCloseTo(1 - 0.5 / 1.5, 8);
  });

  it('builds stopword-filtered relaxed OR websearch query and falls back to portuguese FTS when primary returns 0 rows', async () => {
    const capturedQueries: Prisma.Sql[] = [];
    const db: SqlQueryDatabase = {
      $queryRaw: vi.fn(async (query: Prisma.Sql) => {
        capturedQueries.push(query);
        if (capturedQueries.length === 1) {
          return [];
        }
        return [
          {
            chunkId: CHUNK_B,
            documentId: DOC_ID,
            filename: 'livro-regras.pdf',
            pageNumber: 14,
            chunkIndex: 28,
            content: 'Uma camiseta deve ser usada sob o maiô de levantamento.',
            tokenCount: 12,
            metadata: {},
            lexicalScore: 0.25,
          },
        ];
      }) as SqlQueryDatabase['$queryRaw'],
    };

    const service = new HybridRetrievalService(db);
    const results = await service.retrieve({
      organizationId: ORG_ID,
      strategy: 'lexical',
      queryText: 'Quais as regras para camisetas em competições?',
      topK: 5,
    });

    expect(capturedQueries).toHaveLength(2);
    expect(capturedQueries[0]!.values).toContain(
      'regras OR camisetas OR competições',
    );
    expect(capturedQueries[1]!.sql).toContain(
      "to_tsvector('portuguese', dc.\"content\")",
    );
    expect(capturedQueries[1]!.values).toContain(
      'regras OR camisetas OR competições',
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.chunkId).toBe(CHUNK_B);
  });

  it('combines semantic and lexical results via RRF in hybrid mode', async () => {
    const db: SqlQueryDatabase = {
      $queryRaw: vi.fn(async () => [
        {
          chunkId: CHUNK_B,
          documentId: DOC_ID,
          filename: 'manual.pdf',
          pageNumber: 1,
          chunkIndex: 1,
          content: 'Valve pressure spec.',
          tokenCount: 10,
          metadata: {},
          lexicalScore: 0.9,
        },
        {
          chunkId: CHUNK_C,
          documentId: DOC_ID,
          filename: 'manual.pdf',
          pageNumber: 2,
          chunkIndex: 2,
          content: 'Inspection checklist.',
          tokenCount: 10,
          metadata: {},
          lexicalScore: 0.4,
        },
      ]) as SqlQueryDatabase['$queryRaw'],
    };

    const semanticRetriever: RetrievalService = {
      retrieve: vi.fn(async () => [
        makeChunk(CHUNK_A, { similarity: 0.92, distance: 0.08 }),
        makeChunk(CHUNK_B, { similarity: 0.88, distance: 0.12 }),
      ]),
    };

    const service = new HybridRetrievalService(db, {
      defaultStrategy: 'hybrid',
      semanticRetriever,
    });

    const results = await service.retrieve({
      organizationId: ORG_ID,
      queryEmbedding: makeUnitVector(),
      queryText: 'valve pressure',
      topK: 3,
    });

    expect(semanticRetriever.retrieve).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG_ID,
        topK: 9,
      }),
    );
    expect(results.map((r) => r.chunkId)).toEqual([CHUNK_B, CHUNK_A, CHUNK_C]);
    expect(results[0]!.matchedBy).toEqual(['semantic', 'lexical']);
    expect(results[0]!.rrfScore).toBeGreaterThan(results[1]!.rrfScore!);
  });

  it('falls back cleanly to semantic-only in hybrid mode when queryText is omitted', async () => {
    const queryRaw = vi.fn(async () => []) as SqlQueryDatabase['$queryRaw'];
    const semanticRetriever: RetrievalService = {
      retrieve: vi.fn(async () => [makeChunk(CHUNK_A)]),
    };

    const service = new HybridRetrievalService(
      { $queryRaw: queryRaw },
      { defaultStrategy: 'hybrid', semanticRetriever },
    );

    const results = await service.retrieve({
      organizationId: ORG_ID,
      queryEmbedding: makeUnitVector(),
    });

    expect(queryRaw).not.toHaveBeenCalled();
    expect(results).toHaveLength(1);
    expect(results[0]!.matchedBy).toEqual(['semantic']);
    expect(results[0]!.semanticRank).toBe(1);
  });

  it('defaults to semantic mode for backwards compatibility and validates inputs', async () => {
    const queryRaw = vi.fn(async () => []) as SqlQueryDatabase['$queryRaw'];
    const semanticRetriever: RetrievalService = {
      retrieve: vi.fn(async () => [makeChunk(CHUNK_A)]),
    };

    const service = new HybridRetrievalService(
      { $queryRaw: queryRaw },
      { semanticRetriever },
    );

    const semanticResults = await service.retrieve({
      organizationId: ORG_ID,
      queryEmbedding: makeUnitVector(),
    });
    expect(semanticResults).toHaveLength(1);
    expect(queryRaw).not.toHaveBeenCalled();

    await expect(
      service.retrieve({
        organizationId: ORG_ID,
        strategy: 'lexical',
        queryText: '   ',
      }),
    ).rejects.toThrow('queryText is required for lexical retrieval');

    await expect(
      service.retrieve({
        organizationId: ORG_ID,
        strategy: 'lexical',
        queryText: 'test',
        topK: MAX_RETRIEVAL_TOP_K + 1,
      }),
    ).rejects.toThrow(`between 1 and ${MAX_RETRIEVAL_TOP_K}`);
  });
});
