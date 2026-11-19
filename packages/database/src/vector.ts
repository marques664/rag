import { randomUUID } from 'node:crypto';
import {
  EMBEDDING_DIMENSIONS,
  type DocumentChunkMetadata,
} from '@enterprise-ai/shared';
import { Prisma } from './generated/prisma/client.js';

const DEFAULT_INSERT_BATCH_SIZE = 200;
const MAX_INSERT_BATCH_SIZE = 1000;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface VectorValidationOptions {
  rejectZeroNorm?: boolean;
}

export interface DocumentChunkWithEmbeddingInput {
  id?: string;
  documentId: string;
  organizationId: string;
  content: string;
  embedding: readonly number[];
  pageNumber: number;
  chunkIndex: number;
  tokenCount: number;
  metadata: DocumentChunkMetadata;
  createdAt?: Date;
}

export interface InsertChunksOptions {
  batchSize?: number;
  expectedDimensions?: number;
}

export interface SqlExecuteDatabase {
  $executeRaw(query: Prisma.Sql): Promise<number>;
}

function assertUuid(value: string, fieldName: string): void {
  if (!UUID_REGEX.test(value)) {
    throw new Error(`${fieldName} must be a valid UUID`);
  }
}

/**
 * Validates that an embedding vector has exact fixed dimensionality and finite coordinates.
 */
export function assertValidVector(
  vector: readonly number[],
  expectedDimensions: number = EMBEDDING_DIMENSIONS,
  options: VectorValidationOptions = {},
): void {
  if (!Number.isInteger(expectedDimensions) || expectedDimensions <= 0) {
    throw new Error('expectedDimensions must be a positive integer');
  }

  if (!Array.isArray(vector)) {
    throw new Error('Embedding vector must be an array of numbers');
  }

  if (vector.length !== expectedDimensions) {
    throw new Error(
      `Embedding vector dimension mismatch: expected ${expectedDimensions}, received ${vector.length}`,
    );
  }

  let normSquared = 0;
  for (let i = 0; i < vector.length; i += 1) {
    const value = vector[i];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(
        `Embedding vector contains non-finite value at index ${i}`,
      );
    }
    normSquared += value * value;
  }

  if (options.rejectZeroNorm && normSquared === 0) {
    throw new Error('Embedding vector must have non-zero norm');
  }
}

/**
 * Validates and formats a numeric vector into pgvector text literal syntax (`[v0,v1,...]`).
 */
export function formatPgVectorLiteral(
  vector: readonly number[],
  expectedDimensions: number = EMBEDDING_DIMENSIONS,
  options: VectorValidationOptions = {},
): string {
  assertValidVector(vector, expectedDimensions, options);
  return `[${vector.join(',')}]`;
}

/**
 * Atomically inserts document chunks together with their pgvector embeddings using
 * batched parameterized SQL so newly processed chunks never exist without vectors.
 */
export async function insertDocumentChunksWithEmbeddings(
  executor: SqlExecuteDatabase,
  chunks: readonly DocumentChunkWithEmbeddingInput[],
  options: InsertChunksOptions = {},
): Promise<number> {
  if (chunks.length === 0) {
    return 0;
  }

  const batchSize = options.batchSize ?? DEFAULT_INSERT_BATCH_SIZE;
  if (
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > MAX_INSERT_BATCH_SIZE
  ) {
    throw new Error(
      `batchSize must be an integer between 1 and ${MAX_INSERT_BATCH_SIZE}`,
    );
  }

  const expectedDimensions = options.expectedDimensions ?? EMBEDDING_DIMENSIONS;
  let totalInserted = 0;

  for (let offset = 0; offset < chunks.length; offset += batchSize) {
    const batch = chunks.slice(offset, offset + batchSize);
    const rowTuples = batch.map((chunk) => {
      const id = chunk.id ?? randomUUID();
      assertUuid(id, 'chunk.id');
      assertUuid(chunk.documentId, 'chunk.documentId');
      assertUuid(chunk.organizationId, 'chunk.organizationId');

      const vectorLiteral = formatPgVectorLiteral(
        chunk.embedding,
        expectedDimensions,
      );
      const metadataJson = JSON.stringify(chunk.metadata ?? {});
      const createdAt = chunk.createdAt ?? new Date();

      return Prisma.sql`(
        ${id}::uuid,
        ${chunk.documentId}::uuid,
        ${chunk.organizationId}::uuid,
        ${chunk.content},
        ${vectorLiteral}::vector(1536),
        ${chunk.pageNumber}::integer,
        ${chunk.chunkIndex}::integer,
        ${chunk.tokenCount}::integer,
        ${metadataJson}::jsonb,
        ${createdAt}::timestamptz
      )`;
    });

    const affected = await executor.$executeRaw(Prisma.sql`
      INSERT INTO "document_chunks" (
        "id",
        "document_id",
        "organization_id",
        "content",
        "embedding",
        "page_number",
        "chunk_index",
        "token_count",
        "metadata",
        "created_at"
      )
      VALUES ${Prisma.join(rowTuples)}
    `);

    totalInserted += affected;
  }

  return totalInserted;
}

/**
 * Updates an existing document chunk embedding scoped by both chunk ID and organization ID.
 */
export async function updateDocumentChunkEmbedding(
  executor: SqlExecuteDatabase,
  params: {
    chunkId: string;
    organizationId: string;
    embedding: readonly number[];
    expectedDimensions?: number;
  },
): Promise<number> {
  assertUuid(params.chunkId, 'chunkId');
  assertUuid(params.organizationId, 'organizationId');

  const vectorLiteral = formatPgVectorLiteral(
    params.embedding,
    params.expectedDimensions ?? EMBEDDING_DIMENSIONS,
  );

  return executor.$executeRaw(Prisma.sql`
    UPDATE "document_chunks"
    SET "embedding" = ${vectorLiteral}::vector(1536)
    WHERE "id" = ${params.chunkId}::uuid
      AND "organization_id" = ${params.organizationId}::uuid
  `);
}
