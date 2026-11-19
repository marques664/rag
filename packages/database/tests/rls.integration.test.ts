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
import { DocumentStatus, Prisma } from '../src/generated/prisma/client.js';
import { withTenantRlsContext } from '../src/rls.js';
import { insertDocumentChunksWithEmbeddings } from '../src/vector.js';

loadDotenv({ path: path.resolve(import.meta.dirname, '../../../.env') });

const TEST_DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  'postgresql://postgres:postgres@localhost:5432/enterprise_knowledge_ai_test?schema=public';

function makeBasisVector(hotIndex = 0): number[] {
  const vec = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  vec[hotIndex] = 1;
  return vec;
}

describe('Sprint 6 PostgreSQL Row-Level Security (RLS) defense-in-depth integration', () => {
  let db: DatabaseClient;

  beforeAll(async () => {
    db = createDatabaseClient(TEST_DATABASE_URL);
    await db.$connect();
  });

  beforeEach(async () => {
    await db.$executeRawUnsafe(
      'TRUNCATE TABLE "message_feedback", "usage_events", "message_citations", "messages", "conversations", "document_chunks", "processing_jobs", "documents", "organization_invitations", "refresh_tokens", "memberships", "organizations", "users" RESTART IDENTITY CASCADE;',
    );
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('verifies RLS is enabled on tenant tables and isolates unfiltered queries by app.current_organization_id', async () => {
    const rlsTables = await db.$queryRaw<
      Array<{ relname: string; relrowsecurity: boolean }>
    >`
      SELECT relname, relrowsecurity
      FROM pg_class
      WHERE relname IN (
        'documents',
        'document_chunks',
        'conversations',
        'usage_events',
        'memberships',
        'organization_invitations',
        'messages',
        'message_citations',
        'message_feedback',
        'processing_jobs'
      )
      ORDER BY relname
    `;

    expect(rlsTables).toHaveLength(10);
    expect(rlsTables.every((row) => row.relrowsecurity === true)).toBe(true);

    const user = await db.user.create({
      data: {
        name: 'RLS Owner',
        email: `rls-${randomUUID().slice(0, 8)}@example.com`,
        passwordHash: 'hashed-password-placeholder',
      },
    });

    const orgA = await db.organization.create({
      data: { name: 'RLS Tenant A', slug: `rls-a-${randomUUID().slice(0, 8)}` },
    });
    const orgB = await db.organization.create({
      data: { name: 'RLS Tenant B', slug: `rls-b-${randomUUID().slice(0, 8)}` },
    });

    const docA = await db.document.create({
      data: {
        organizationId: orgA.id,
        filename: 'tenant-a-only.pdf',
        storageKey: `orgs/${orgA.id}/a.pdf`,
        mimeType: 'application/pdf',
        fileSize: 512,
        checksum: randomUUID().replaceAll('-', ''),
        status: DocumentStatus.COMPLETED,
      },
    });
    const docB = await db.document.create({
      data: {
        organizationId: orgB.id,
        filename: 'tenant-b-secret.pdf',
        storageKey: `orgs/${orgB.id}/b.pdf`,
        mimeType: 'application/pdf',
        fileSize: 512,
        checksum: randomUUID().replaceAll('-', ''),
        status: DocumentStatus.COMPLETED,
      },
    });

    await insertDocumentChunksWithEmbeddings(db, [
      {
        documentId: docA.id,
        organizationId: orgA.id,
        content: 'Tenant A confidential protocol.',
        embedding: makeBasisVector(0),
        pageNumber: 1,
        chunkIndex: 0,
        tokenCount: 4,
        metadata: { pageNumber: 1, chunkIndex: 0, tokenCount: 4 },
      },
      {
        documentId: docB.id,
        organizationId: orgB.id,
        content: 'Tenant B top secret protocol.',
        embedding: makeBasisVector(1),
        pageNumber: 1,
        chunkIndex: 0,
        tokenCount: 5,
        metadata: { pageNumber: 1, chunkIndex: 0, tokenCount: 5 },
      },
    ]);

    await db.conversation.createMany({
      data: [
        { organizationId: orgA.id, userId: user.id, title: 'Conv A' },
        { organizationId: orgB.id, userId: user.id, title: 'Conv B' },
      ],
    });

    // Unfiltered queries (no WHERE organization_id) executed inside Tenant A RLS context
    // must strictly see only Tenant A rows.
    const tenantAResult = await withTenantRlsContext(
      db,
      orgA.id,
      async (tx) => {
        const docs = await tx.document.findMany();
        const chunks = await tx.$queryRaw<Array<{ documentId: string }>>(
          Prisma.sql`SELECT "document_id"::text AS "documentId" FROM "document_chunks"`,
        );
        const convs = await tx.conversation.findMany();
        return { docs, chunks, convs };
      },
    );

    expect(tenantAResult.docs).toHaveLength(1);
    expect(tenantAResult.docs[0]!.id).toBe(docA.id);
    expect(tenantAResult.chunks).toHaveLength(1);
    expect(tenantAResult.chunks[0]!.documentId).toBe(docA.id);
    expect(tenantAResult.convs).toHaveLength(1);
    expect(tenantAResult.convs[0]!.organizationId).toBe(orgA.id);

    // Fail-closed check: under enterprise_ai_app with unset tenant setting, zero rows are visible.
    const unsetTenantDocs = await db.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SET LOCAL ROLE "enterprise_ai_app"`);
      return tx.document.findMany();
    });

    expect(unsetTenantDocs).toHaveLength(0);
  });
});
