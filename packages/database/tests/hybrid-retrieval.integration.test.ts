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
import { HybridRetrievalService } from '../src/hybrid-retrieval.js';
import { insertDocumentChunksWithEmbeddings } from '../src/vector.js';

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

describe('Sprint 5-7 Hybrid & FTS retrieval integration (PostgreSQL + pgvector + GIN)', () => {
  let db: DatabaseClient;
  let retrievalService: HybridRetrievalService;

  beforeAll(async () => {
    db = createDatabaseClient(TEST_DATABASE_URL);
    await db.$connect();
    retrievalService = new HybridRetrievalService(db, {
      defaultStrategy: 'hybrid',
    });
  });

  beforeEach(async () => {
    await db.$executeRawUnsafe(
      'TRUNCATE TABLE "message_feedback", "usage_events", "message_citations", "messages", "conversations", "document_chunks", "processing_jobs", "documents", "organization_invitations", "refresh_tokens", "memberships", "organizations", "users" RESTART IDENTITY CASCADE;',
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

  it('verifies document_chunks_content_fts_gin_idx exists in pg_indexes', async () => {
    const indexes = await db.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef
      FROM pg_indexes
      WHERE tablename = 'document_chunks'
        AND indexname = 'document_chunks_content_fts_gin_idx'
    `;

    expect(indexes).toHaveLength(1);
    expect(indexes[0]?.indexdef).toContain('USING gin');
    expect(indexes[0]?.indexdef).toContain('to_tsvector');
  });

  it('executes lexical FTS with strict tenant isolation and COMPLETED status guard', async () => {
    const { org: orgA, doc: completedDocA } = await seedOrganizationAndDoc({
      orgName: 'Lexical Tenant A',
      orgSlug: `lex-a-${randomUUID().slice(0, 8)}`,
      filename: 'turbine-manual-a.pdf',
      status: DocumentStatus.COMPLETED,
    });

    const pendingDocA = await db.document.create({
      data: {
        organizationId: orgA.id,
        filename: 'turbine-pending-a.pdf',
        storageKey: `organizations/${orgA.id}/documents/${randomUUID()}/pending.pdf`,
        mimeType: 'application/pdf',
        fileSize: 512,
        checksum: randomUUID().replaceAll('-', ''),
        status: DocumentStatus.PENDING,
        processingVersion: 1,
      },
    });

    const { org: orgB, doc: completedDocB } = await seedOrganizationAndDoc({
      orgName: 'Lexical Tenant B',
      orgSlug: `lex-b-${randomUUID().slice(0, 8)}`,
      filename: 'turbine-secrets-b.pdf',
      status: DocumentStatus.COMPLETED,
    });

    const matchingChunkA = randomUUID();

    await insertDocumentChunksWithEmbeddings(db, [
      {
        id: matchingChunkA,
        documentId: completedDocA.id,
        organizationId: orgA.id,
        content:
          'Inspection protocol for KV-4200 turbo-compressor cavitation threshold under peak load.',
        embedding: makeBasisVector(0),
        pageNumber: 4,
        chunkIndex: 0,
        tokenCount: 14,
        metadata: { pageNumber: 4, chunkIndex: 0, tokenCount: 14 },
      },
      {
        documentId: completedDocA.id,
        organizationId: orgA.id,
        content: 'Unrelated office fire evacuation guidelines.',
        embedding: makeBasisVector(1),
        pageNumber: 1,
        chunkIndex: 1,
        tokenCount: 6,
        metadata: { pageNumber: 1, chunkIndex: 1, tokenCount: 6 },
      },
      {
        documentId: pendingDocA.id,
        organizationId: orgA.id,
        content:
          'Pending draft mentioning KV-4200 turbo-compressor cavitation threshold.',
        embedding: makeBasisVector(0),
        pageNumber: 1,
        chunkIndex: 0,
        tokenCount: 9,
        metadata: { pageNumber: 1, chunkIndex: 0, tokenCount: 9 },
      },
      {
        documentId: completedDocB.id,
        organizationId: orgB.id,
        content:
          'Tenant B confidential KV-4200 turbo-compressor cavitation threshold limits.',
        embedding: makeBasisVector(0),
        pageNumber: 2,
        chunkIndex: 0,
        tokenCount: 10,
        metadata: { pageNumber: 2, chunkIndex: 0, tokenCount: 10 },
      },
    ]);

    const resultsA = await retrievalService.retrieve({
      organizationId: orgA.id,
      strategy: 'lexical',
      queryText: 'KV-4200 cavitation',
      topK: 10,
    });

    expect(resultsA).toHaveLength(1);
    expect(resultsA[0]).toMatchObject({
      chunkId: matchingChunkA,
      documentId: completedDocA.id,
      filename: 'turbine-manual-a.pdf',
      pageNumber: 4,
      matchedBy: ['lexical'],
      lexicalRank: 1,
    });
    expect(resultsA.some((c) => c.documentId === completedDocB.id)).toBe(false);
    expect(resultsA.some((c) => c.documentId === pendingDocA.id)).toBe(false);
  });

  it('fuses semantic pgvector and lexical FTS with Reciprocal Rank Fusion scoped by organizationId', async () => {
    const { org: orgA, doc: docA } = await seedOrganizationAndDoc({
      orgName: 'Hybrid Tenant A',
      orgSlug: `hyb-a-${randomUUID().slice(0, 8)}`,
      filename: 'calibration-a.pdf',
    });
    const { org: orgB, doc: docB } = await seedOrganizationAndDoc({
      orgName: 'Hybrid Tenant B',
      orgSlug: `hyb-b-${randomUUID().slice(0, 8)}`,
      filename: 'calibration-b.pdf',
    });

    const chunkSemanticOnly = randomUUID();
    const chunkOverlap = randomUUID();
    const chunkLexicalOnly = randomUUID();

    const queryVec = makeBasisVector(0);

    await insertDocumentChunksWithEmbeddings(db, [
      {
        id: chunkSemanticOnly,
        documentId: docA.id,
        organizationId: orgA.id,
        content: 'General equipment safety overview for plant operators.',
        embedding: makeBasisVector(0), // semantic rank 1 (similarity = 1.0), no lexical match
        pageNumber: 1,
        chunkIndex: 0,
        tokenCount: 8,
        metadata: { pageNumber: 1, chunkIndex: 0, tokenCount: 8 },
      },
      {
        id: chunkOverlap,
        documentId: docA.id,
        organizationId: orgA.id,
        content:
          'Apply calibration torque 45Nm to the manifold bolts before startup.',
        embedding: makeWeightedVector([
          [0, 0.85],
          [1, Math.sqrt(1 - 0.85 * 0.85)],
        ]), // semantic rank 2 AND lexical match
        pageNumber: 2,
        chunkIndex: 1,
        tokenCount: 12,
        metadata: { pageNumber: 2, chunkIndex: 1, tokenCount: 12 },
      },
      {
        id: chunkLexicalOnly,
        documentId: docA.id,
        organizationId: orgA.id,
        content: 'Spare seal kit includes calibration torque 45Nm gauge.',
        embedding: makeBasisVector(3), // orthogonal (similarity 0.0) -> lexical match
        pageNumber: 3,
        chunkIndex: 2,
        tokenCount: 10,
        metadata: { pageNumber: 3, chunkIndex: 2, tokenCount: 10 },
      },
      {
        documentId: docB.id,
        organizationId: orgB.id,
        content:
          'Tenant B secret calibration torque 45Nm specification override.',
        embedding: makeBasisVector(0),
        pageNumber: 1,
        chunkIndex: 0,
        tokenCount: 10,
        metadata: { pageNumber: 1, chunkIndex: 0, tokenCount: 10 },
      },
    ]);

    const hybridResults = await retrievalService.retrieve({
      organizationId: orgA.id,
      strategy: 'hybrid',
      queryEmbedding: queryVec,
      queryText: 'calibration torque 45Nm',
      topK: 5,
      minSimilarity: 0.5,
    });

    expect(hybridResults).toHaveLength(3);
    expect(hybridResults.every((c) => c.documentId === docA.id)).toBe(true);

    // Overlapping semantic+lexical hit must rank #1 via RRF
    expect(hybridResults[0]!.chunkId).toBe(chunkOverlap);
    expect(hybridResults[0]!.matchedBy).toEqual(
      expect.arrayContaining(['semantic', 'lexical']),
    );
    expect(hybridResults[0]!.semanticRank).toBe(2);
    expect(hybridResults[0]!.lexicalRank).toBeDefined();
    expect(hybridResults[0]!.rrfScore).toBeGreaterThan(
      hybridResults[1]!.rrfScore!,
    );

    const semanticHit = hybridResults.find(
      (c) => c.chunkId === chunkSemanticOnly,
    );
    const lexicalHit = hybridResults.find(
      (c) => c.chunkId === chunkLexicalOnly,
    );

    expect(semanticHit?.matchedBy).toEqual(['semantic']);
    expect(semanticHit?.semanticRank).toBe(1);
    expect(semanticHit?.lexicalRank).toBeUndefined();

    expect(lexicalHit?.matchedBy).toEqual(['lexical']);
    expect(lexicalHit?.lexicalRank).toBeDefined();
    expect(lexicalHit?.semanticRank).toBeUndefined();
  });

  it('retrieves relevant Portuguese chunks for natural-language questions and plural inflections in lexical mode', async () => {
    const { org, doc } = await seedOrganizationAndDoc({
      orgName: 'Lexical PT Tenant',
      orgSlug: `lex-pt-${randomUUID().slice(0, 8)}`,
      filename: 'livro-regras.pdf',
      status: DocumentStatus.COMPLETED,
    });

    const shirtChunkId = randomUUID();
    const unrelatedChunkId = randomUUID();

    await insertDocumentChunksWithEmbeddings(db, [
      {
        id: shirtChunkId,
        documentId: doc.id,
        organizationId: org.id,
        content:
          '3.2. CAMISETA Uma camiseta deve ser usada sob o maiô de levantamento por todos os levantadores no agachamento, supino e levantamento terra.',
        embedding: makeBasisVector(0),
        pageNumber: 14,
        chunkIndex: 0,
        tokenCount: 25,
        metadata: { pageNumber: 14, chunkIndex: 0, tokenCount: 25 },
      },
      {
        id: unrelatedChunkId,
        documentId: doc.id,
        organizationId: org.id,
        content:
          'Horário da pesagem oficial e procedimentos de conferência documental dos árbitros.',
        embedding: makeBasisVector(1),
        pageNumber: 26,
        chunkIndex: 1,
        tokenCount: 14,
        metadata: { pageNumber: 26, chunkIndex: 1, tokenCount: 14 },
      },
    ]);

    const questionResults = await retrievalService.retrieve({
      organizationId: org.id,
      strategy: 'lexical',
      queryText: 'Que tipo de camiseta devo usar em competições de powerlifting?',
      topK: 5,
    });

    expect(questionResults.length).toBeGreaterThanOrEqual(1);
    expect(questionResults[0]!.chunkId).toBe(shirtChunkId);

    const pluralResults = await retrievalService.retrieve({
      organizationId: org.id,
      strategy: 'lexical',
      queryText: 'camisetas',
      topK: 5,
    });

    expect(pluralResults.length).toBeGreaterThanOrEqual(1);
    expect(pluralResults[0]!.chunkId).toBe(shirtChunkId);
  });
});
