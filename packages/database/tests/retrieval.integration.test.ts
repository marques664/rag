import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { EMBEDDING_DIMENSIONS } from '@enterprise-ai/shared';
import { config as loadDotenv } from 'dotenv';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { createDatabaseClient, type DatabaseClient } from '../src/client.js';
import { DocumentStatus } from '../src/generated/prisma/client.js';
import { PgVectorRetrievalService } from '../src/retrieval.js';
import {
  insertDocumentChunksWithEmbeddings,
  updateDocumentChunkEmbedding,
} from '../src/vector.js';

loadDotenv({ path: path.resolve(import.meta.dirname, '../../../.env') });

const TEST_DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  'postgresql://postgres:postgres@localhost:5432/enterprise_knowledge_ai_test?schema=public';

function makeBasisVector(hotIndex: number, value = 1): number[] {
  const vec = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  vec[hotIndex] = value;
  return vec;
}

function makeWeightedVector(weights: Array<[number, number]>): number[] {
  const vec = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  for (const [index, weight] of weights) {
    vec[index] = weight;
  }
  return vec;
}

describe('Sprint 4 pgvector semantic retrieval integration (PostgreSQL + HNSW)', () => {
  let db: DatabaseClient;
  let retrievalService: PgVectorRetrievalService;

  beforeAll(async () => {
    db = createDatabaseClient(TEST_DATABASE_URL);
    await db.$connect();
    retrievalService = new PgVectorRetrievalService(db);
  });

  beforeEach(async () => {
    await db.$executeRawUnsafe(
      'TRUNCATE TABLE "usage_events", "message_citations", "messages", "conversations", "document_chunks", "processing_jobs", "documents", "organization_invitations", "refresh_tokens", "memberships", "organizations", "users" RESTART IDENTITY CASCADE;',
    );
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function seedOrganizationAndDoc(params: {
    orgName: string;
    orgSlug: string;
    filename: string;
    status?: DocumentStatus;
  }) {
    const org = await db.organization.create({
      data: {
        name: params.orgName,
        slug: params.orgSlug,
      },
    });

    const doc = await db.document.create({
      data: {
        organizationId: org.id,
        filename: params.filename,
        storageKey: `organizations/${org.id}/documents/${randomUUID()}/file.pdf`,
        mimeType: 'application/pdf',
        fileSize: 1024,
        checksum: randomUUID().replaceAll('-', ''),
        status: params.status ?? DocumentStatus.COMPLETED,
        pageCount: 2,
        processingVersion: 1,
        processedAt: new Date(),
      },
    });

    return { org, doc };
  }

  it('verifies vector(1536) column and HNSW cosine index exist in PostgreSQL', async () => {
    const columns = await db.$queryRaw<Array<{ data_type: string }>>`
      SELECT format_type(a.atttypid, a.atttypmod) AS data_type
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      WHERE c.relname = 'document_chunks'
        AND a.attname = 'embedding'
        AND NOT a.attisdropped
    `;
    expect(columns[0]?.data_type).toBe('vector(1536)');

    const indexes = await db.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef
      FROM pg_indexes
      WHERE tablename = 'document_chunks'
        AND indexname = 'document_chunks_embedding_hnsw_cosine_idx'
    `;
    expect(indexes).toHaveLength(1);
    expect(indexes[0]?.indexdef).toContain('USING hnsw');
    expect(indexes[0]?.indexdef).toContain('vector_cosine_ops');
  });

  it('enforces strict organization_id tenant isolation even when another org has identical vectors', async () => {
    const { org: orgA, doc: docA } = await seedOrganizationAndDoc({
      orgName: 'Tenant A',
      orgSlug: `tenant-a-${randomUUID().slice(0, 8)}`,
      filename: 'tenant-a-handbook.pdf',
    });
    const { org: orgB, doc: docB } = await seedOrganizationAndDoc({
      orgName: 'Tenant B',
      orgSlug: `tenant-b-${randomUUID().slice(0, 8)}`,
      filename: 'tenant-b-secrets.pdf',
    });

    const queryVec = makeBasisVector(0);
    const chunkAId = randomUUID();
    const chunkB1Id = randomUUID();
    const chunkB2Id = randomUUID();

    await insertDocumentChunksWithEmbeddings(db, [
      {
        id: chunkAId,
        documentId: docA.id,
        organizationId: orgA.id,
        content: 'Tenant A moderately relevant procedure.',
        embedding: makeWeightedVector([
          [0, 0.8],
          [1, 0.6],
        ]),
        pageNumber: 1,
        chunkIndex: 0,
        tokenCount: 6,
        metadata: { pageNumber: 1, chunkIndex: 0, tokenCount: 6 },
      },
      {
        id: chunkB1Id,
        documentId: docB.id,
        organizationId: orgB.id,
        content: 'Tenant B exact-match confidential secret.',
        embedding: queryVec,
        pageNumber: 3,
        chunkIndex: 0,
        tokenCount: 6,
        metadata: { pageNumber: 3, chunkIndex: 0, tokenCount: 6 },
      },
      {
        id: chunkB2Id,
        documentId: docB.id,
        organizationId: orgB.id,
        content: 'Tenant B secondary confidential secret.',
        embedding: makeWeightedVector([
          [0, 0.99],
          [1, 0.14],
        ]),
        pageNumber: 4,
        chunkIndex: 1,
        tokenCount: 6,
        metadata: { pageNumber: 4, chunkIndex: 1, tokenCount: 6 },
      },
    ]);

    const resultsForA = await retrievalService.retrieve({
      organizationId: orgA.id,
      queryEmbedding: queryVec,
      topK: 10,
    });

    expect(resultsForA).toHaveLength(1);
    expect(resultsForA[0]).toMatchObject({
      chunkId: chunkAId,
      documentId: docA.id,
      filename: 'tenant-a-handbook.pdf',
      pageNumber: 1,
      chunkIndex: 0,
      content: 'Tenant A moderately relevant procedure.',
    });
    expect(resultsForA.some((c) => c.documentId === docB.id)).toBe(false);

    const resultsForB = await retrievalService.retrieve({
      organizationId: orgB.id,
      queryEmbedding: queryVec,
      topK: 10,
    });
    expect(resultsForB).toHaveLength(2);
    expect(resultsForB.map((c) => c.chunkId)).toEqual([chunkB1Id, chunkB2Id]);
  });

  it('excludes chunks with NULL embeddings and non-COMPLETED documents, and supports minSimilarity & documentIds filters', async () => {
    const { org: orgA, doc: completedDoc1 } = await seedOrganizationAndDoc({
      orgName: 'Filter Org',
      orgSlug: `filter-org-${randomUUID().slice(0, 8)}`,
      filename: 'completed-1.pdf',
      status: DocumentStatus.COMPLETED,
    });

    const completedDoc2 = await db.document.create({
      data: {
        organizationId: orgA.id,
        filename: 'completed-2.pdf',
        storageKey: `organizations/${orgA.id}/documents/${randomUUID()}/file2.pdf`,
        mimeType: 'application/pdf',
        fileSize: 512,
        checksum: randomUUID().replaceAll('-', ''),
        status: DocumentStatus.COMPLETED,
        pageCount: 1,
        processingVersion: 1,
        processedAt: new Date(),
      },
    });

    const pendingDoc = await db.document.create({
      data: {
        organizationId: orgA.id,
        filename: 'pending.pdf',
        storageKey: `organizations/${orgA.id}/documents/${randomUUID()}/pending.pdf`,
        mimeType: 'application/pdf',
        fileSize: 512,
        checksum: randomUUID().replaceAll('-', ''),
        status: DocumentStatus.PENDING,
        processingVersion: 1,
      },
    });

    const failedDoc = await db.document.create({
      data: {
        organizationId: orgA.id,
        filename: 'failed.pdf',
        storageKey: `organizations/${orgA.id}/documents/${randomUUID()}/failed.pdf`,
        mimeType: 'application/pdf',
        fileSize: 512,
        checksum: randomUUID().replaceAll('-', ''),
        status: DocumentStatus.FAILED,
        processingVersion: 1,
      },
    });

    // Unembedded chunk on COMPLETED document must be excluded until backfilled.
    const unembeddedChunk = await db.documentChunk.create({
      data: {
        documentId: completedDoc1.id,
        organizationId: orgA.id,
        content: 'Legacy Sprint 3 unembedded chunk.',
        pageNumber: 1,
        chunkIndex: 0,
        tokenCount: 5,
        metadata: { pageNumber: 1, chunkIndex: 0, tokenCount: 5 },
      },
    });

    const highMatchId = randomUUID();
    const midMatchId = randomUUID();
    const lowMatchId = randomUUID();
    const doc2ChunkId = randomUUID();

    await insertDocumentChunksWithEmbeddings(db, [
      {
        id: highMatchId,
        documentId: completedDoc1.id,
        organizationId: orgA.id,
        content: 'Exact semantic match on page 2.',
        embedding: makeBasisVector(0), // cosine similarity = 1.0
        pageNumber: 2,
        chunkIndex: 1,
        tokenCount: 7,
        metadata: { pageNumber: 2, chunkIndex: 1, tokenCount: 7 },
      },
      {
        id: midMatchId,
        documentId: completedDoc1.id,
        organizationId: orgA.id,
        content: 'Moderate semantic match (similarity 0.5).',
        embedding: makeWeightedVector([
          [0, 0.5],
          [1, Math.sqrt(0.75)],
        ]),
        pageNumber: 3,
        chunkIndex: 2,
        tokenCount: 7,
        metadata: { pageNumber: 3, chunkIndex: 2, tokenCount: 7 },
      },
      {
        id: lowMatchId,
        documentId: completedDoc1.id,
        organizationId: orgA.id,
        content: 'Orthogonal non-matching chunk (similarity 0.0).',
        embedding: makeBasisVector(2),
        pageNumber: 4,
        chunkIndex: 3,
        tokenCount: 7,
        metadata: { pageNumber: 4, chunkIndex: 3, tokenCount: 7 },
      },
      {
        id: doc2ChunkId,
        documentId: completedDoc2.id,
        organizationId: orgA.id,
        content: 'Second completed document high match.',
        embedding: makeWeightedVector([
          [0, 0.9],
          [1, Math.sqrt(0.19)],
        ]),
        pageNumber: 1,
        chunkIndex: 0,
        tokenCount: 6,
        metadata: { pageNumber: 1, chunkIndex: 0, tokenCount: 6 },
      },
      {
        documentId: pendingDoc.id,
        organizationId: orgA.id,
        content: 'Pending document must stay invisible.',
        embedding: makeBasisVector(0),
        pageNumber: 1,
        chunkIndex: 0,
        tokenCount: 6,
        metadata: { pageNumber: 1, chunkIndex: 0, tokenCount: 6 },
      },
      {
        documentId: failedDoc.id,
        organizationId: orgA.id,
        content: 'Failed document must stay invisible.',
        embedding: makeBasisVector(0),
        pageNumber: 1,
        chunkIndex: 0,
        tokenCount: 6,
        metadata: { pageNumber: 1, chunkIndex: 0, tokenCount: 6 },
      },
    ]);

    const queryVec = makeBasisVector(0);

    // Default retrieval: excludes unembedded, pending, and failed chunks; ordered by similarity DESC
    const allCompleted = await retrievalService.retrieve({
      organizationId: orgA.id,
      queryEmbedding: queryVec,
      topK: 10,
    });
    expect(allCompleted.map((c) => c.chunkId)).toEqual([
      highMatchId,
      doc2ChunkId,
      midMatchId,
      lowMatchId,
    ]);
    expect(allCompleted[0]!.similarity).toBeCloseTo(1, 5);
    expect(allCompleted[1]!.similarity).toBeCloseTo(0.9, 5);
    expect(allCompleted[2]!.similarity).toBeCloseTo(0.5, 5);
    expect(allCompleted[3]!.similarity).toBeCloseTo(0, 5);

    // minSimilarity filter excludes mid & low matches
    const highOnly = await retrievalService.retrieve({
      organizationId: orgA.id,
      queryEmbedding: queryVec,
      topK: 10,
      minSimilarity: 0.75,
    });
    expect(highOnly.map((c) => c.chunkId)).toEqual([highMatchId, doc2ChunkId]);

    // documentIds filter scopes strictly to requested doc(s)
    const scopedToDoc2 = await retrievalService.retrieve({
      organizationId: orgA.id,
      queryEmbedding: queryVec,
      topK: 10,
      documentIds: [completedDoc2.id],
    });
    expect(scopedToDoc2.map((c) => c.chunkId)).toEqual([doc2ChunkId]);

    // Backfilling the unembedded chunk via updateDocumentChunkEmbedding makes it eligible
    const updatedRows = await updateDocumentChunkEmbedding(db, {
      chunkId: unembeddedChunk.id,
      organizationId: orgA.id,
      embedding: makeWeightedVector([
        [0, 0.95],
        [1, Math.sqrt(1 - 0.95 * 0.95)],
      ]),
    });
    expect(updatedRows).toBe(1);

    const afterBackfill = await retrievalService.retrieve({
      organizationId: orgA.id,
      queryEmbedding: queryVec,
      topK: 2,
    });
    expect(afterBackfill.map((c) => c.chunkId)).toEqual([
      highMatchId,
      unembeddedChunk.id,
    ]);
  });
});
