import {
  DEFAULT_RETRIEVAL_TOP_K,
  EMBEDDING_DIMENSIONS,
  MAX_RETRIEVAL_TOP_K,
} from '@enterprise-ai/shared';
import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../src/generated/prisma/client.js';
import {
  PgVectorRetrievalService,
  type SqlQueryDatabase,
} from '../src/retrieval.js';
import {
  assertValidVector,
  formatPgVectorLiteral,
  insertDocumentChunksWithEmbeddings,
  updateDocumentChunkEmbedding,
  type SqlExecuteDatabase,
} from '../src/vector.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const DOC_ID = '22222222-2222-4222-8222-222222222222';
const CHUNK_ID = '33333333-3333-4333-8333-333333333333';

function makeUnitVector(
  dimensions: number = EMBEDDING_DIMENSIONS,
  hotIndex = 0,
): number[] {
  const vec = new Array<number>(dimensions).fill(0);
  vec[hotIndex] = 1;
  return vec;
}

describe('vector validation and formatting', () => {
  it('validates and formats a 1536-dimension finite vector', () => {
    const vec = makeUnitVector();
    expect(() => assertValidVector(vec)).not.toThrow();
    const literal = formatPgVectorLiteral(vec);
    expect(literal.startsWith('[1,0,0,')).toBe(true);
    expect(literal.endsWith(',0]')).toBe(true);
  });

  it('rejects vector dimension mismatch', () => {
    expect(() => assertValidVector([0.1, 0.2])).toThrow(
      `expected ${EMBEDDING_DIMENSIONS}, received 2`,
    );
    expect(() =>
      assertValidVector(new Array<number>(EMBEDDING_DIMENSIONS + 1).fill(0.1)),
    ).toThrow(`expected ${EMBEDDING_DIMENSIONS}, received ${EMBEDDING_DIMENSIONS + 1}`);
  });

  it('rejects NaN and Infinity coordinates', () => {
    const withNaN = makeUnitVector();
    withNaN[42] = Number.NaN;
    expect(() => assertValidVector(withNaN)).toThrow('non-finite value at index 42');

    const withInfinity = makeUnitVector();
    withInfinity[7] = Number.POSITIVE_INFINITY;
    expect(() => assertValidVector(withInfinity)).toThrow(
      'non-finite value at index 7',
    );
  });

  it('rejects zero-norm vectors when rejectZeroNorm is true', () => {
    const zeroVec = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
    expect(() => assertValidVector(zeroVec)).not.toThrow();
    expect(() => assertValidVector(zeroVec, EMBEDDING_DIMENSIONS, { rejectZeroNorm: true })).toThrow(
      'non-zero norm',
    );
  });
});

describe('vector persistence helpers', () => {
  it('returns 0 without querying when chunk list is empty', async () => {
    const executeRaw = vi.fn(async () => 0);
    const db: SqlExecuteDatabase = { $executeRaw: executeRaw };

    const inserted = await insertDocumentChunksWithEmbeddings(db, []);

    expect(inserted).toBe(0);
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it('inserts chunks with parameterized pgvector embeddings in batches', async () => {
    const capturedQueries: Prisma.Sql[] = [];
    const db: SqlExecuteDatabase = {
      $executeRaw: vi.fn(async (query: Prisma.Sql) => {
        capturedQueries.push(query);
        return 2;
      }),
    };

    const chunks = [0, 1, 2].map((index) => ({
      documentId: DOC_ID,
      organizationId: ORG_ID,
      content: `Chunk content ${index}`,
      embedding: makeUnitVector(EMBEDDING_DIMENSIONS, index),
      pageNumber: 1,
      chunkIndex: index,
      tokenCount: 12,
      metadata: {
        filename: 'manual.pdf',
        pageNumber: 1,
        chunkIndex: index,
        tokenCount: 12,
      },
    }));

    const inserted = await insertDocumentChunksWithEmbeddings(db, chunks, {
      batchSize: 2,
    });

    expect(inserted).toBe(4);
    expect(capturedQueries).toHaveLength(2);

    const firstSql = capturedQueries[0]!.sql;
    expect(firstSql).toContain('INSERT INTO "document_chunks"');
    expect(firstSql).toContain('"embedding"');
    expect(firstSql).toContain('::vector(1536)');
    expect(capturedQueries[0]!.values).toContain(ORG_ID);
    expect(capturedQueries[0]!.values).toContain(DOC_ID);
    expect(capturedQueries[0]!.values).toContain(
      formatPgVectorLiteral(makeUnitVector(EMBEDDING_DIMENSIONS, 0)),
    );
  });

  it('rejects invalid chunk embeddings before calling database', async () => {
    const executeRaw = vi.fn(async () => 1);
    const db: SqlExecuteDatabase = { $executeRaw: executeRaw };

    await expect(
      insertDocumentChunksWithEmbeddings(db, [
        {
          documentId: DOC_ID,
          organizationId: ORG_ID,
          content: 'Bad vector',
          embedding: [0.1, 0.2],
          pageNumber: 1,
          chunkIndex: 0,
          tokenCount: 5,
          metadata: { pageNumber: 1, chunkIndex: 0, tokenCount: 5 },
        },
      ]),
    ).rejects.toThrow('dimension mismatch');
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it('updates an existing chunk embedding scoped by chunkId and organizationId', async () => {
    let capturedQuery: Prisma.Sql | undefined;
    const db: SqlExecuteDatabase = {
      $executeRaw: vi.fn(async (query: Prisma.Sql) => {
        capturedQuery = query;
        return 1;
      }),
    };

    const embedding = makeUnitVector(EMBEDDING_DIMENSIONS, 3);
    const updated = await updateDocumentChunkEmbedding(db, {
      chunkId: CHUNK_ID,
      organizationId: ORG_ID,
      embedding,
    });

    expect(updated).toBe(1);
    expect(capturedQuery?.sql).toContain('UPDATE "document_chunks"');
    expect(capturedQuery?.sql).toContain('::vector(1536)');
    expect(capturedQuery?.sql).toContain('"organization_id" =');
    expect(capturedQuery?.values).toContain(CHUNK_ID);
    expect(capturedQuery?.values).toContain(ORG_ID);
  });
});

describe('PgVectorRetrievalService', () => {
  it('executes parameterized SQL with tenant, COMPLETED, and non-null embedding guards and maps results', async () => {
    let capturedQuery: Prisma.Sql | undefined;
    const db: SqlQueryDatabase = {
      $queryRaw: vi.fn(async (query: Prisma.Sql) => {
        capturedQuery = query;
        return [
          {
            chunkId: CHUNK_ID,
            documentId: DOC_ID,
            filename: 'handbook.pdf',
            pageNumber: 3,
            chunkIndex: 4,
            content: 'Reset the valve before calibration.',
            tokenCount: 18,
            metadata: {
              filename: 'handbook.pdf',
              pageNumber: 3,
              chunkIndex: 4,
              tokenCount: 18,
              totalPages: 10,
            },
            distance: 0.125,
            similarity: 0.875,
          },
        ];
      }) as SqlQueryDatabase['$queryRaw'],
    };

    const service = new PgVectorRetrievalService(db);
    const queryEmbedding = makeUnitVector(EMBEDDING_DIMENSIONS, 2);
    const results = await service.retrieve({
      organizationId: ORG_ID,
      queryEmbedding,
    });

    expect(capturedQuery).toBeDefined();
    expect(capturedQuery!.sql).toContain('dc."organization_id" =');
    expect(capturedQuery!.sql).toContain('d."organization_id" =');
    expect(capturedQuery!.sql).toContain('d."status" = \'COMPLETED\'::"DocumentStatus"');
    expect(capturedQuery!.sql).toContain('dc."embedding" IS NOT NULL');
    expect(capturedQuery!.sql).toContain('<=>');
    expect(capturedQuery!.sql).toContain('LIMIT');

    expect(capturedQuery!.values).toContain(ORG_ID);
    expect(capturedQuery!.values).toContain(DEFAULT_RETRIEVAL_TOP_K);
    expect(capturedQuery!.values).toContain(
      formatPgVectorLiteral(queryEmbedding, EMBEDDING_DIMENSIONS, {
        rejectZeroNorm: true,
      }),
    );

    expect(results).toEqual([
      {
        chunkId: CHUNK_ID,
        documentId: DOC_ID,
        filename: 'handbook.pdf',
        pageNumber: 3,
        chunkIndex: 4,
        content: 'Reset the valve before calibration.',
        tokenCount: 18,
        metadata: {
          filename: 'handbook.pdf',
          pageNumber: 3,
          chunkIndex: 4,
          tokenCount: 18,
          totalPages: 10,
        },
        distance: 0.125,
        similarity: 0.875,
      },
    ]);
  });

  it('applies optional minSimilarity and documentIds SQL filters and custom topK', async () => {
    let capturedQuery: Prisma.Sql | undefined;
    const db: SqlQueryDatabase = {
      $queryRaw: vi.fn(async (query: Prisma.Sql) => {
        capturedQuery = query;
        return [];
      }) as SqlQueryDatabase['$queryRaw'],
    };

    const service = new PgVectorRetrievalService(db);
    await service.retrieve({
      organizationId: ORG_ID,
      queryEmbedding: makeUnitVector(),
      topK: 8,
      minSimilarity: 0.75,
      documentIds: [DOC_ID, DOC_ID],
    });

    expect(capturedQuery!.sql).toContain('<=');
    expect(capturedQuery!.sql).toContain('dc."document_id" IN');
    expect(capturedQuery!.values).toContain(8);
    expect(capturedQuery!.values).toContain(0.25);
    expect(capturedQuery!.values.filter((v) => v === DOC_ID)).toHaveLength(1);
  });

  it('returns empty array without querying when documentIds is empty', async () => {
    const queryRaw = vi.fn(async () => []) as SqlQueryDatabase['$queryRaw'];
    const service = new PgVectorRetrievalService({ $queryRaw: queryRaw });

    const results = await service.retrieve({
      organizationId: ORG_ID,
      queryEmbedding: makeUnitVector(),
      documentIds: [],
    });

    expect(results).toEqual([]);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('validates topK bounds, UUIDs, and query vectors', async () => {
    const queryRaw = vi.fn(async () => []) as SqlQueryDatabase['$queryRaw'];
    const service = new PgVectorRetrievalService({ $queryRaw: queryRaw });
    const validVec = makeUnitVector();

    await expect(
      service.retrieve({
        organizationId: 'not-a-uuid',
        queryEmbedding: validVec,
      }),
    ).rejects.toThrow('organizationId must be a valid UUID');

    await expect(
      service.retrieve({
        organizationId: ORG_ID,
        queryEmbedding: validVec,
        topK: 0,
      }),
    ).rejects.toThrow(`between 1 and ${MAX_RETRIEVAL_TOP_K}`);

    await expect(
      service.retrieve({
        organizationId: ORG_ID,
        queryEmbedding: validVec,
        topK: MAX_RETRIEVAL_TOP_K + 1,
      }),
    ).rejects.toThrow(`between 1 and ${MAX_RETRIEVAL_TOP_K}`);

    await expect(
      service.retrieve({
        organizationId: ORG_ID,
        queryEmbedding: new Array<number>(EMBEDDING_DIMENSIONS).fill(0),
      }),
    ).rejects.toThrow('non-zero norm');

    await expect(
      service.retrieve({
        organizationId: ORG_ID,
        queryEmbedding: [1, 2, 3],
      }),
    ).rejects.toThrow('dimension mismatch');

    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('throws if database returns non-finite distance or similarity', async () => {
    const service = new PgVectorRetrievalService({
      $queryRaw: vi.fn(async () => [
        {
          chunkId: CHUNK_ID,
          documentId: DOC_ID,
          filename: 'bad.pdf',
          pageNumber: 1,
          chunkIndex: 0,
          content: 'text',
          tokenCount: 1,
          metadata: {},
          distance: Number.NaN,
          similarity: Number.NaN,
        },
      ]) as SqlQueryDatabase['$queryRaw'],
    });

    await expect(
      service.retrieve({
        organizationId: ORG_ID,
        queryEmbedding: makeUnitVector(),
      }),
    ).rejects.toThrow('non-finite vector distance');
  });
});
