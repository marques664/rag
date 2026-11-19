import {
  DEFAULT_RETRIEVAL_TOP_K,
  EMBEDDING_DIMENSIONS,
  MAX_RETRIEVAL_TOP_K,
  type DocumentChunkMetadata,
  type RetrievalService,
  type RetrieveChunksInput,
  type RetrievedChunk,
} from '@enterprise-ai/shared';
import { Prisma } from './generated/prisma/client.js';
import { formatPgVectorLiteral } from './vector.js';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SqlQueryDatabase {
  $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T>;
}

export interface PgVectorRetrievalOptions {
  defaultTopK?: number;
  expectedDimensions?: number;
}

interface RetrievedChunkRow {
  chunkId: string;
  documentId: string;
  filename: string;
  pageNumber: number;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  metadata: unknown;
  distance: number;
  similarity: number;
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
 * Tenant-isolated semantic retrieval backed by PostgreSQL + pgvector cosine distance (`<=>`).
 * Organization filtering, COMPLETED document status, and non-null embedding guards are
 * enforced directly inside the parameterized SQL query.
 */
export class PgVectorRetrievalService implements RetrievalService {
  private readonly defaultTopK: number;
  private readonly expectedDimensions: number;

  constructor(
    private readonly db: SqlQueryDatabase,
    options: PgVectorRetrievalOptions = {},
  ) {
    this.defaultTopK = validateTopK(
      options.defaultTopK ?? DEFAULT_RETRIEVAL_TOP_K,
      'defaultTopK',
    );
    const expectedDimensions =
      options.expectedDimensions ?? EMBEDDING_DIMENSIONS;
    if (!Number.isInteger(expectedDimensions) || expectedDimensions <= 0) {
      throw new Error('expectedDimensions must be a positive integer');
    }
    this.expectedDimensions = expectedDimensions;
  }

  public async retrieve(input: RetrieveChunksInput): Promise<RetrievedChunk[]> {
    assertUuid(input.organizationId, 'organizationId');

    if (!input.queryEmbedding) {
      throw new Error('queryEmbedding is required for semantic retrieval');
    }

    const topK = validateTopK(input.topK ?? this.defaultTopK, 'topK');

    const vectorLiteral = formatPgVectorLiteral(
      input.queryEmbedding,
      this.expectedDimensions,
      { rejectZeroNorm: true },
    );

    let distanceFilter = Prisma.empty;
    if (input.minSimilarity !== undefined) {
      if (
        typeof input.minSimilarity !== 'number' ||
        !Number.isFinite(input.minSimilarity) ||
        input.minSimilarity < -1 ||
        input.minSimilarity > 1
      ) {
        throw new Error(
          'minSimilarity must be a finite number between -1 and 1',
        );
      }
      const maxDistance = 1 - input.minSimilarity;
      distanceFilter = Prisma.sql`AND (dc."embedding" <=> ${vectorLiteral}::vector(1536)) <= ${maxDistance}::double precision`;
    }

    let documentFilter = Prisma.empty;
    if (input.documentIds !== undefined) {
      if (input.documentIds.length === 0) {
        return [];
      }
      const uniqueDocumentIds = Array.from(new Set(input.documentIds));
      for (const documentId of uniqueDocumentIds) {
        assertUuid(documentId, 'documentIds[]');
      }
      documentFilter = Prisma.sql`AND dc."document_id" IN (${Prisma.join(
        uniqueDocumentIds.map((id) => Prisma.sql`${id}::uuid`),
      )})`;
    }

    const rows = await this.db.$queryRaw<RetrievedChunkRow[]>(Prisma.sql`
      SELECT
        dc."id"::text AS "chunkId",
        dc."document_id"::text AS "documentId",
        d."filename" AS "filename",
        dc."page_number" AS "pageNumber",
        dc."chunk_index" AS "chunkIndex",
        dc."content" AS "content",
        dc."token_count" AS "tokenCount",
        dc."metadata" AS "metadata",
        (dc."embedding" <=> ${vectorLiteral}::vector(1536))::double precision AS "distance",
        (1 - (dc."embedding" <=> ${vectorLiteral}::vector(1536)))::double precision AS "similarity"
      FROM "document_chunks" dc
      INNER JOIN "documents" d
        ON d."id" = dc."document_id"
        AND d."organization_id" = dc."organization_id"
      WHERE dc."organization_id" = ${input.organizationId}::uuid
        AND d."organization_id" = ${input.organizationId}::uuid
        AND d."status" = 'COMPLETED'::"DocumentStatus"
        AND dc."embedding" IS NOT NULL
        ${distanceFilter}
        ${documentFilter}
      ORDER BY dc."embedding" <=> ${vectorLiteral}::vector(1536) ASC, dc."id" ASC
      LIMIT ${topK}::integer
    `);

    return rows.map((row) => {
      const pageNumber = Number(row.pageNumber);
      const chunkIndex = Number(row.chunkIndex);
      const tokenCount = Number(row.tokenCount);
      const distance = Number(row.distance);
      const similarity = Number(row.similarity);

      if (!Number.isFinite(distance) || !Number.isFinite(similarity)) {
        throw new Error(
          `Retrieved chunk ${row.chunkId} returned non-finite vector distance`,
        );
      }

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
      };
    });
  }
}
