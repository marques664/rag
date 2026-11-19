import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  checkDatabaseHealth,
  createDatabaseClient,
  DocumentStatus,
  ProcessingJobStatus,
  type DatabaseClient,
} from '@enterprise-ai/database';
import { DOCUMENT_PROCESS_JOB_NAME } from '@enterprise-ai/shared';
import { Queue } from 'bullmq';
import { config as loadDotenv } from 'dotenv';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { buildApp } from '../src/app.js';
import { BullMqDocumentQueue, type DocumentQueueService } from '../src/infrastructure/queue.js';
import { MinioDocumentStorage, type DocumentStorageService } from '../src/infrastructure/storage.js';

loadDotenv({ path: path.resolve(import.meta.dirname, '../../../.env') });

const TEST_DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  'postgresql://postgres:postgres@localhost:5432/enterprise_knowledge_ai_test?schema=public';
const TEST_REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const MINIO_ENDPOINT = process.env['MINIO_ENDPOINT'] ?? 'localhost';
const MINIO_PORT = Number.parseInt(process.env['MINIO_PORT'] ?? '9000', 10);
const MINIO_USE_SSL = process.env['MINIO_USE_SSL'] === 'true';
const MINIO_ROOT_USER = process.env['MINIO_ROOT_USER'] ?? 'minioadmin';
const MINIO_ROOT_PASSWORD = process.env['MINIO_ROOT_PASSWORD'] ?? 'minioadmin';
const MINIO_BUCKET =
  process.env['MINIO_BUCKET'] ?? 'enterprise-knowledge-documents';

const TEST_JWT_SECRET =
  'integration-test-jwt-secret-key-minimum-32-characters';
const MAX_TEST_UPLOAD_BYTES = 64 * 1024;
const TEST_QUEUE_NAME = 'document-processing-test';

function buildMinimalPdfBuffer(text = 'Enterprise Knowledge AI Test PDF'): Buffer {
  const escaped = text
    .replaceAll('\\', '\\\\')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)');
  const streamBody = `BT\n/F1 12 Tf\n72 720 Td\n(${escaped}) Tj\nET`;

  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [4 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    '4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    `5 0 obj\n<< /Length ${Buffer.byteLength(streamBody, 'utf8')} >>\nstream\n${streamBody}\nendstream\nendobj\n`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += obj;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${String(offsets[i] ?? 0).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'utf8');
}

function buildMultipartPayload(params: {
  fieldName?: string;
  filename: string;
  contentType: string;
  content: Buffer;
}): { body: Buffer; contentTypeHeader: string } {
  const boundary = `----EnterpriseAiIntBoundary${randomUUID().replaceAll('-', '')}`;
  const header = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${params.fieldName ?? 'file'}"; filename="${params.filename}"\r\n` +
      `Content-Type: ${params.contentType}\r\n\r\n`,
    'utf8',
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');

  return {
    body: Buffer.concat([header, params.content, footer]),
    contentTypeHeader: `multipart/form-data; boundary=${boundary}`,
  };
}

describe('Sprint 3 Documents API integration (PostgreSQL + MinIO + BullMQ)', () => {
  let db: DatabaseClient;
  let app: FastifyInstance;
  let documentStorage: MinioDocumentStorage;
  let documentQueue: BullMqDocumentQueue;
  let s3Client: S3Client;
  let redisInspector: Redis;
  let inspectionQueue: Queue;

  const trackedMinioKeys = new Set<string>();
  const trackedJobIds = new Set<string>();

  beforeAll(async () => {
    db = createDatabaseClient(TEST_DATABASE_URL);
    await db.$connect();

    const protocol = MINIO_USE_SSL ? 'https' : 'http';
    s3Client = new S3Client({
      endpoint: `${protocol}://${MINIO_ENDPOINT}:${MINIO_PORT}`,
      region: 'us-east-1',
      credentials: {
        accessKeyId: MINIO_ROOT_USER,
        secretAccessKey: MINIO_ROOT_PASSWORD,
      },
      forcePathStyle: true,
    });

    redisInspector = new Redis(TEST_REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });
    inspectionQueue = new Queue(TEST_QUEUE_NAME, {
      connection: redisInspector,
    });

    documentStorage = new MinioDocumentStorage({
      endpoint: MINIO_ENDPOINT,
      port: MINIO_PORT,
      useSsl: MINIO_USE_SSL,
      accessKeyId: MINIO_ROOT_USER,
      secretAccessKey: MINIO_ROOT_PASSWORD,
      bucket: MINIO_BUCKET,
    });
    documentQueue = new BullMqDocumentQueue(TEST_REDIS_URL, {
      queueName: TEST_QUEUE_NAME,
    });

    app = buildApp({
      nodeEnv: 'test',
      database: db,
      authConfig: {
        jwtSecret: TEST_JWT_SECRET,
        accessTokenExpiresIn: '15m',
        refreshTokenExpiresDays: 7,
      },
      documentStorage,
      documentQueue,
      maxDocumentFileSizeBytes: MAX_TEST_UPLOAD_BYTES,
      checkDatabase: () => checkDatabaseHealth(db),
      checkRedis: async () => ({ status: 'up', latencyMs: 1 }),
    });
  });

  beforeEach(async () => {
    await db.$executeRawUnsafe(
      'TRUNCATE TABLE "document_chunks", "processing_jobs", "documents", "organization_invitations", "refresh_tokens", "memberships", "organizations", "users" RESTART IDENTITY CASCADE;',
    );
  });

  afterEach(async () => {
    for (const jobId of trackedJobIds) {
      const job = await inspectionQueue.getJob(jobId);
      if (job) {
        await job.remove();
      }
    }
    trackedJobIds.clear();

    for (const key of trackedMinioKeys) {
      try {
        await s3Client.send(
          new DeleteObjectCommand({ Bucket: MINIO_BUCKET, Key: key }),
        );
      } catch {
        // Ignore cleanup errors for objects already deleted during tests.
      }
    }
    trackedMinioKeys.clear();
  });

  afterAll(async () => {
    await app.close();
    await documentQueue.close();
    documentStorage.destroy();
    await inspectionQueue.close();
    await redisInspector.quit();
    s3Client.destroy();
    await db.$disconnect();
  });

  async function registerAndCreateOrg(params: {
    name: string;
    email: string;
    orgName: string;
    orgSlug: string;
  }) {
    const regRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        name: params.name,
        email: params.email,
        password: 'StrongPassword123!',
      },
    });
    expect(regRes.statusCode).toBe(201);
    const regBody = regRes.json();
    const accessToken = regBody.tokens.accessToken as string;
    const userId = regBody.user.id as string;

    const orgRes = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { name: params.orgName, slug: params.orgSlug },
    });
    expect(orgRes.statusCode).toBe(201);
    const orgId = orgRes.json().organization.id as string;

    return { userId, accessToken, orgId };
  }

  async function registerUser(params: { name: string; email: string }) {
    const regRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        name: params.name,
        email: params.email,
        password: 'StrongPassword123!',
      },
    });
    expect(regRes.statusCode).toBe(201);
    return {
      userId: regRes.json().user.id as string,
      accessToken: regRes.json().tokens.accessToken as string,
    };
  }

  async function inviteAndAccept(params: {
    ownerToken: string;
    orgId: string;
    inviteeEmail: string;
    inviteeToken: string;
    role: 'ADMIN' | 'MEMBER';
  }) {
    const inviteRes = await app.inject({
      method: 'POST',
      url: `/api/v1/organizations/${params.orgId}/invitations`,
      headers: { authorization: `Bearer ${params.ownerToken}` },
      payload: { email: params.inviteeEmail, role: params.role },
    });
    expect(inviteRes.statusCode).toBe(201);
    const invitationId = inviteRes.json().invitation.id as string;

    const acceptRes = await app.inject({
      method: 'POST',
      url: `/api/v1/organizations/invitations/${invitationId}/accept`,
      headers: { authorization: `Bearer ${params.inviteeToken}` },
    });
    expect(acceptRes.statusCode).toBe(200);
  }

  async function uploadPdf(params: {
    token: string;
    orgId: string;
    filename?: string;
    contentType?: string;
    content?: Buffer;
  }) {
    const pdfBytes = params.content ?? buildMinimalPdfBuffer();
    const multipart = buildMultipartPayload({
      filename: params.filename ?? 'manual.pdf',
      contentType: params.contentType ?? 'application/pdf',
      content: pdfBytes,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: {
        authorization: `Bearer ${params.token}`,
        'x-organization-id': params.orgId,
        'content-type': multipart.contentTypeHeader,
      },
      payload: multipart.body,
    });

    if (res.statusCode === 201) {
      const docId = res.json().document.id as string;
      const dbDoc = await db.document.findUnique({ where: { id: docId } });
      if (dbDoc) {
        trackedMinioKeys.add(dbDoc.storageKey);
      }
      const dbJob = await db.processingJob.findFirst({
        where: { documentId: docId },
        orderBy: { createdAt: 'desc' },
      });
      if (dbJob?.bullmqJobId) {
        trackedJobIds.add(dbJob.bullmqJobId);
      }
    }

    return res;
  }

  it('uploads a valid PDF to MinIO, persists PostgreSQL metadata, enqueues BullMQ job, and supports list/details/status', async () => {
    const owner = await registerAndCreateOrg({
      name: 'Alice Owner',
      email: 'alice-upload@acme.test',
      orgName: 'Acme Docs',
      orgSlug: 'acme-docs',
    });

    const pdfBytes = buildMinimalPdfBuffer('Acme Security Policy v1');
    const expectedChecksum = createHash('sha256').update(pdfBytes).digest('hex');

    const uploadRes = await uploadPdf({
      token: owner.accessToken,
      orgId: owner.orgId,
      filename: '../../etc/passwd/security\u0000policy.pdf',
      content: pdfBytes,
    });

    expect(uploadRes.statusCode).toBe(201);
    const body = uploadRes.json();
    const docId = body.document.id as string;

    expect(body.document.filename).toBe('securitypolicy.pdf');
    expect(body.document.organizationId).toBe(owner.orgId);
    expect(body.document.mimeType).toBe('application/pdf');
    expect(body.document.fileSize).toBe(pdfBytes.length);
    expect(body.document.checksum).toBe(expectedChecksum);
    expect(body.document.status).toBe('PENDING');
    expect(body.document.processingVersion).toBe(1);
    expect(body.document.storageKey).toBeUndefined();

    // Verify PostgreSQL records
    const dbDoc = await db.document.findUnique({ where: { id: docId } });
    expect(dbDoc).not.toBeNull();
    expect(dbDoc?.storageKey).toMatch(
      new RegExp(`^organizations/${owner.orgId}/documents/${docId}/[0-9a-f-]{36}\\.pdf$`),
    );

    const dbJob = await db.processingJob.findFirst({
      where: { documentId: docId },
    });
    expect(dbJob).not.toBeNull();
    expect(dbJob?.status).toBe(ProcessingJobStatus.PENDING);
    expect(dbJob?.bullmqJobId).toBe(dbJob?.id);

    // Verify MinIO object bytes match
    const s3Object = await s3Client.send(
      new GetObjectCommand({
        Bucket: MINIO_BUCKET,
        Key: dbDoc!.storageKey,
      }),
    );
    const storedBytes = Buffer.from(await s3Object.Body!.transformToByteArray());
    expect(storedBytes.equals(pdfBytes)).toBe(true);

    // Verify BullMQ job exists in Redis with expected payload
    const bullJob = await inspectionQueue.getJob(dbJob!.id);
    expect(bullJob).not.toBeUndefined();
    expect(bullJob?.name).toBe(DOCUMENT_PROCESS_JOB_NAME);
    expect(bullJob?.data).toMatchObject({
      documentId: docId,
      organizationId: owner.orgId,
      processingJobId: dbJob!.id,
      storageKey: dbDoc!.storageKey,
      processingVersion: 1,
    });
    expect(bullJob?.data.traceparent).toMatch(
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/,
    );

    // List, detail, and status endpoints
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/documents?status=PENDING&page=1&limit=10',
      headers: {
        authorization: `Bearer ${owner.accessToken}`,
        'x-organization-id': owner.orgId,
      },
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().documents).toHaveLength(1);
    expect(listRes.json().documents[0].storageKey).toBeUndefined();
    expect(listRes.json().pagination).toEqual({
      page: 1,
      limit: 10,
      total: 1,
      totalPages: 1,
    });

    const detailRes = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${docId}`,
      headers: {
        authorization: `Bearer ${owner.accessToken}`,
        'x-organization-id': owner.orgId,
      },
    });
    expect(detailRes.statusCode).toBe(200);
    expect(detailRes.json().document.chunkCount).toBe(0);
    expect(detailRes.json().document.latestJob.id).toBe(dbJob!.id);
    expect(detailRes.json().document.storageKey).toBeUndefined();

    const statusRes = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${docId}/status`,
      headers: {
        authorization: `Bearer ${owner.accessToken}`,
        'x-organization-id': owner.orgId,
      },
    });
    expect(statusRes.statusCode).toBe(200);
    expect(statusRes.json().status.documentId).toBe(docId);
    expect(statusRes.json().status.status).toBe('PENDING');
    expect(statusRes.json().status.processingVersion).toBe(1);
  });

  it('rejects invalid headers, spoofed PDF magic bytes, wrong MIME/extension, empty files, and oversized payloads', async () => {
    const owner = await registerAndCreateOrg({
      name: 'Validation Owner',
      email: 'val@acme.test',
      orgName: 'Val Org',
      orgSlug: 'val-org',
    });

    const validPdf = buildMinimalPdfBuffer();
    const validMultipart = buildMultipartPayload({
      filename: 'ok.pdf',
      contentType: 'application/pdf',
      content: validPdf,
    });

    // Unauthenticated -> 401
    const unauthRes = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: {
        'x-organization-id': owner.orgId,
        'content-type': validMultipart.contentTypeHeader,
      },
      payload: validMultipart.body,
    });
    expect(unauthRes.statusCode).toBe(401);

    // Missing or malformed x-organization-id -> 400
    const missingOrgRes = await app.inject({
      method: 'GET',
      url: '/api/v1/documents',
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect(missingOrgRes.statusCode).toBe(400);

    const invalidOrgUuidRes = await app.inject({
      method: 'GET',
      url: '/api/v1/documents',
      headers: {
        authorization: `Bearer ${owner.accessToken}`,
        'x-organization-id': 'not-a-uuid',
      },
    });
    expect(invalidOrgUuidRes.statusCode).toBe(400);

    // Spoofed PDF (non-PDF magic bytes with .pdf extension & application/pdf MIME) -> 400
    const spoofedRes = await uploadPdf({
      token: owner.accessToken,
      orgId: owner.orgId,
      filename: 'trojan.pdf',
      contentType: 'application/pdf',
      content: Buffer.from('MZ\x90\x00This is not a PDF'),
    });
    expect(spoofedRes.statusCode).toBe(400);
    expect(spoofedRes.json().error).toBe('INVALID_PDF_CONTENT');

    // Wrong MIME -> 415
    const wrongMimeRes = await uploadPdf({
      token: owner.accessToken,
      orgId: owner.orgId,
      filename: 'doc.pdf',
      contentType: 'text/plain',
      content: validPdf,
    });
    expect(wrongMimeRes.statusCode).toBe(415);

    // Wrong extension -> 415
    const wrongExtRes = await uploadPdf({
      token: owner.accessToken,
      orgId: owner.orgId,
      filename: 'doc.txt',
      contentType: 'application/pdf',
      content: validPdf,
    });
    expect(wrongExtRes.statusCode).toBe(415);

    // Empty file -> 400
    const emptyRes = await uploadPdf({
      token: owner.accessToken,
      orgId: owner.orgId,
      filename: 'empty.pdf',
      contentType: 'application/pdf',
      content: Buffer.alloc(0),
    });
    expect(emptyRes.statusCode).toBe(400);
    expect(emptyRes.json().error).toBe('EMPTY_DOCUMENT_FILE');

    // Oversized file -> 413
    const oversizedPayload = Buffer.concat([
      validPdf,
      Buffer.alloc(MAX_TEST_UPLOAD_BYTES + 1024, 0x20),
    ]);
    const oversizedRes = await uploadPdf({
      token: owner.accessToken,
      orgId: owner.orgId,
      filename: 'too-large.pdf',
      contentType: 'application/pdf',
      content: oversizedPayload,
    });
    expect(oversizedRes.statusCode).toBe(413);

    expect(await db.document.count()).toBe(0);
  });

  it('enforces strict cross-tenant isolation and RBAC across all document endpoints', async () => {
    const tenantA = await registerAndCreateOrg({
      name: 'Tenant A Owner',
      email: 'owner-a@tenanta.test',
      orgName: 'Tenant A',
      orgSlug: 'tenant-a-docs',
    });
    const tenantB = await registerAndCreateOrg({
      name: 'Tenant B Owner',
      email: 'owner-b@tenantb.test',
      orgName: 'Tenant B',
      orgSlug: 'tenant-b-docs',
    });

    const memberA = await registerUser({
      name: 'Member A',
      email: 'member-a@tenanta.test',
    });
    const adminA = await registerUser({
      name: 'Admin A',
      email: 'admin-a@tenanta.test',
    });

    await inviteAndAccept({
      ownerToken: tenantA.accessToken,
      orgId: tenantA.orgId,
      inviteeEmail: 'member-a@tenanta.test',
      inviteeToken: memberA.accessToken,
      role: 'MEMBER',
    });
    await inviteAndAccept({
      ownerToken: tenantA.accessToken,
      orgId: tenantA.orgId,
      inviteeEmail: 'admin-a@tenanta.test',
      inviteeToken: adminA.accessToken,
      role: 'ADMIN',
    });

    const uploadARes = await uploadPdf({
      token: memberA.accessToken,
      orgId: tenantA.orgId,
      filename: 'org-a-doc.pdf',
    });
    expect(uploadARes.statusCode).toBe(201);
    const docAId = uploadARes.json().document.id as string;

    const uploadBRes = await uploadPdf({
      token: tenantB.accessToken,
      orgId: tenantB.orgId,
      filename: 'org-b-secret.pdf',
    });
    expect(uploadBRes.statusCode).toBe(201);
    const docBId = uploadBRes.json().document.id as string;

    // Tenant A cannot access Tenant B org header at all -> 403
    for (const [method, url] of [
      ['GET', '/api/v1/documents'],
      ['GET', `/api/v1/documents/${docBId}`],
      ['GET', `/api/v1/documents/${docBId}/status`],
      ['POST', `/api/v1/documents/${docBId}/reprocess`],
      ['DELETE', `/api/v1/documents/${docBId}`],
    ] as const) {
      const res = await app.inject({
        method,
        url,
        headers: {
          authorization: `Bearer ${tenantA.accessToken}`,
          'x-organization-id': tenantB.orgId,
        },
      });
      expect(res.statusCode).toBe(403);
    }

    // Tenant A querying Tenant B's documentId under Tenant A's header -> 404 (no existence leak)
    for (const [method, url] of [
      ['GET', `/api/v1/documents/${docBId}`],
      ['GET', `/api/v1/documents/${docBId}/status`],
      ['POST', `/api/v1/documents/${docBId}/reprocess`],
      ['DELETE', `/api/v1/documents/${docBId}`],
    ] as const) {
      const res = await app.inject({
        method,
        url,
        headers: {
          authorization: `Bearer ${tenantA.accessToken}`,
          'x-organization-id': tenantA.orgId,
        },
      });
      expect(res.statusCode).toBe(404);
    }

    // Listing under Tenant A shows only Tenant A's document
    const listARes = await app.inject({
      method: 'GET',
      url: '/api/v1/documents',
      headers: {
        authorization: `Bearer ${memberA.accessToken}`,
        'x-organization-id': tenantA.orgId,
      },
    });
    expect(listARes.statusCode).toBe(200);
    expect(
      (listARes.json().documents as Array<{ id: string }>).map((d) => d.id),
    ).toEqual([docAId]);

    // RBAC: MEMBER can read detail/status, cannot reprocess or delete
    const memberDetail = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${docAId}`,
      headers: {
        authorization: `Bearer ${memberA.accessToken}`,
        'x-organization-id': tenantA.orgId,
      },
    });
    expect(memberDetail.statusCode).toBe(200);

    const memberReprocess = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${docAId}/reprocess`,
      headers: {
        authorization: `Bearer ${memberA.accessToken}`,
        'x-organization-id': tenantA.orgId,
      },
    });
    expect(memberReprocess.statusCode).toBe(403);

    const memberDelete = await app.inject({
      method: 'DELETE',
      url: `/api/v1/documents/${docAId}`,
      headers: {
        authorization: `Bearer ${memberA.accessToken}`,
        'x-organization-id': tenantA.orgId,
      },
    });
    expect(memberDelete.statusCode).toBe(403);

    // ADMIN can delete Doc A (Tenant B's Doc B remains untouched)
    const adminDelete = await app.inject({
      method: 'DELETE',
      url: `/api/v1/documents/${docAId}`,
      headers: {
        authorization: `Bearer ${adminA.accessToken}`,
        'x-organization-id': tenantA.orgId,
      },
    });
    expect(adminDelete.statusCode).toBe(200);
    expect(await db.document.findUnique({ where: { id: docBId } })).not.toBeNull();
  });

  it('reprocesses COMPLETED/FAILED documents safely, rejects PENDING/PROCESSING with 409, and deletes DB + MinIO consistently', async () => {
    const owner = await registerAndCreateOrg({
      name: 'Lifecycle Owner',
      email: 'lifecycle@acme.test',
      orgName: 'Lifecycle Org',
      orgSlug: 'lifecycle-org',
    });

    const uploadRes = await uploadPdf({
      token: owner.accessToken,
      orgId: owner.orgId,
      filename: 'lifecycle.pdf',
    });
    expect(uploadRes.statusCode).toBe(201);
    const docId = uploadRes.json().document.id as string;

    // Cannot reprocess while PENDING -> 409
    const pendingReprocess = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${docId}/reprocess`,
      headers: {
        authorization: `Bearer ${owner.accessToken}`,
        'x-organization-id': owner.orgId,
      },
    });
    expect(pendingReprocess.statusCode).toBe(409);

    // Simulate COMPLETED document with existing chunks
    await db.document.update({
      where: { id: docId },
      data: {
        status: DocumentStatus.COMPLETED,
        pageCount: 2,
        processedAt: new Date(),
      },
    });
    await db.documentChunk.createMany({
      data: [
        {
          documentId: docId,
          organizationId: owner.orgId,
          content: 'Old chunk 0',
          pageNumber: 1,
          chunkIndex: 0,
          tokenCount: 3,
          metadata: { pageNumber: 1, chunkIndex: 0 },
        },
        {
          documentId: docId,
          organizationId: owner.orgId,
          content: 'Old chunk 1',
          pageNumber: 2,
          chunkIndex: 1,
          tokenCount: 3,
          metadata: { pageNumber: 2, chunkIndex: 1 },
        },
      ],
    });

    // Reprocess -> 202, increments processingVersion, clears old chunks immediately, creates new job
    const reprocessRes = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${docId}/reprocess`,
      headers: {
        authorization: `Bearer ${owner.accessToken}`,
        'x-organization-id': owner.orgId,
      },
    });
    expect(reprocessRes.statusCode).toBe(202);
    const reprocessBody = reprocessRes.json();
    expect(reprocessBody.document.status).toBe('PENDING');
    expect(reprocessBody.document.processingVersion).toBe(2);
    expect(reprocessBody.document.pageCount).toBeNull();
    expect(reprocessBody.document.processedAt).toBeNull();
    expect(reprocessBody.job.status).toBe('PENDING');
    trackedJobIds.add(reprocessBody.job.id as string);

    const remainingChunks = await db.documentChunk.count({
      where: { documentId: docId },
    });
    expect(remainingChunks).toBe(0);

    const bullJobV2 = await inspectionQueue.getJob(reprocessBody.job.id as string);
    expect(bullJobV2?.data.processingVersion).toBe(2);

    // Simulate PROCESSING -> 409, then FAILED -> 202 allowed
    await db.document.update({
      where: { id: docId },
      data: { status: DocumentStatus.PROCESSING },
    });
    const processingReprocess = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${docId}/reprocess`,
      headers: {
        authorization: `Bearer ${owner.accessToken}`,
        'x-organization-id': owner.orgId,
      },
    });
    expect(processingReprocess.statusCode).toBe(409);

    await db.document.update({
      where: { id: docId },
      data: { status: DocumentStatus.FAILED, errorMessage: 'Simulated error' },
    });
    const failedReprocess = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${docId}/reprocess`,
      headers: {
        authorization: `Bearer ${owner.accessToken}`,
        'x-organization-id': owner.orgId,
      },
    });
    expect(failedReprocess.statusCode).toBe(202);
    expect(failedReprocess.json().document.processingVersion).toBe(3);
    trackedJobIds.add(failedReprocess.json().job.id as string);

    // Delete removes PostgreSQL document/chunks/jobs AND MinIO object
    const docBeforeDelete = await db.document.findUnique({ where: { id: docId } });
    const storageKey = docBeforeDelete!.storageKey;

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/documents/${docId}`,
      headers: {
        authorization: `Bearer ${owner.accessToken}`,
        'x-organization-id': owner.orgId,
      },
    });
    expect(deleteRes.statusCode).toBe(200);
    expect(deleteRes.json()).toEqual({ deleted: true, documentId: docId });

    expect(await db.document.findUnique({ where: { id: docId } })).toBeNull();
    expect(await db.processingJob.count({ where: { documentId: docId } })).toBe(0);
    expect(await db.documentChunk.count({ where: { documentId: docId } })).toBe(0);

    await expect(
      s3Client.send(
        new HeadObjectCommand({ Bucket: MINIO_BUCKET, Key: storageKey }),
      ),
    ).rejects.toThrow();

    const getAfterDelete = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${docId}`,
      headers: {
        authorization: `Bearer ${owner.accessToken}`,
        'x-organization-id': owner.orgId,
      },
    });
    expect(getAfterDelete.statusCode).toBe(404);

    // Upload another doc, manually delete its MinIO key first, and confirm DELETE still succeeds cleanly
    const orphanUpload = await uploadPdf({
      token: owner.accessToken,
      orgId: owner.orgId,
      filename: 'missing-in-s3.pdf',
    });
    expect(orphanUpload.statusCode).toBe(201);
    const orphanDocId = orphanUpload.json().document.id as string;
    const orphanDoc = await db.document.findUnique({ where: { id: orphanDocId } });

    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: MINIO_BUCKET,
        Key: orphanDoc!.storageKey,
      }),
    );

    const deleteMissingS3Res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/documents/${orphanDocId}`,
      headers: {
        authorization: `Bearer ${owner.accessToken}`,
        'x-organization-id': owner.orgId,
      },
    });
    expect(deleteMissingS3Res.statusCode).toBe(200);
  });

  it('compensates MinIO on DB failure and marks FAILED (503) on BullMQ enqueue failure', async () => {
    const owner = await registerAndCreateOrg({
      name: 'Failure Owner',
      email: 'failure@acme.test',
      orgName: 'Failure Org',
      orgSlug: 'failure-org',
    });

    // 1) BullMQ failure with real PostgreSQL + real MinIO
    const failingQueue: DocumentQueueService = {
      enqueueDocumentProcessing: vi.fn(async () => {
        throw new Error('Redis unavailable');
      }),
      close: vi.fn(async () => {}),
    };

    const queueFailApp = buildApp({
      nodeEnv: 'test',
      database: db,
      authConfig: {
        jwtSecret: TEST_JWT_SECRET,
        accessTokenExpiresIn: '15m',
        refreshTokenExpiresDays: 7,
      },
      documentStorage,
      documentQueue: failingQueue,
      maxDocumentFileSizeBytes: MAX_TEST_UPLOAD_BYTES,
      checkDatabase: () => checkDatabaseHealth(db),
      checkRedis: async () => ({ status: 'down', latencyMs: 1 }),
    });

    try {
      const multipart = buildMultipartPayload({
        filename: 'queue-fail.pdf',
        contentType: 'application/pdf',
        content: buildMinimalPdfBuffer(),
      });

      const res = await queueFailApp.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: {
          authorization: `Bearer ${owner.accessToken}`,
          'x-organization-id': owner.orgId,
          'content-type': multipart.contentTypeHeader,
        },
        payload: multipart.body,
      });

      expect(res.statusCode).toBe(503);
      expect(res.json().error).toBe('DOCUMENT_QUEUE_UNAVAILABLE');

      const docs = await db.document.findMany({
        where: { organizationId: owner.orgId },
      });
      expect(docs).toHaveLength(1);
      const failedDoc = docs[0]!;
      trackedMinioKeys.add(failedDoc.storageKey);
      expect(failedDoc.status).toBe(DocumentStatus.FAILED);
      expect(failedDoc.errorMessage).toContain('enqueue');

      const failedJobs = await db.processingJob.findMany({
        where: { documentId: failedDoc.id },
      });
      expect(failedJobs).toHaveLength(1);
      expect(failedJobs[0]?.status).toBe(ProcessingJobStatus.FAILED);
    } finally {
      await queueFailApp.close();
    }

    // 2) DB insert failure after real MinIO upload -> compensates by deleting the real MinIO object
    const uploadedKeys: string[] = [];
    const spyStorage: DocumentStorageService = {
      uploadPdf: async (params) => {
        uploadedKeys.push(params.key);
        trackedMinioKeys.add(params.key);
        await documentStorage.uploadPdf(params);
      },
      deleteObject: async (key) => {
        await documentStorage.deleteObject(key);
      },
    };

    const failingDb = {
      membership: db.membership,
      $transaction: async () => {
        throw new Error('Simulated PostgreSQL transaction failure');
      },
    } as unknown as DatabaseClient;

    const dbFailApp = buildApp({
      nodeEnv: 'test',
      database: failingDb,
      authConfig: {
        jwtSecret: TEST_JWT_SECRET,
        accessTokenExpiresIn: '15m',
        refreshTokenExpiresDays: 7,
      },
      documentStorage: spyStorage,
      documentQueue,
      maxDocumentFileSizeBytes: MAX_TEST_UPLOAD_BYTES,
      checkDatabase: () => checkDatabaseHealth(db),
      checkRedis: async () => ({ status: 'up', latencyMs: 1 }),
    });

    try {
      const multipart = buildMultipartPayload({
        filename: 'db-fail.pdf',
        contentType: 'application/pdf',
        content: buildMinimalPdfBuffer(),
      });

      const res = await dbFailApp.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: {
          authorization: `Bearer ${owner.accessToken}`,
          'x-organization-id': owner.orgId,
          'content-type': multipart.contentTypeHeader,
        },
        payload: multipart.body,
      });

      expect(res.statusCode).toBe(500);
      expect(uploadedKeys).toHaveLength(1);
      await expect(
        s3Client.send(
          new HeadObjectCommand({ Bucket: MINIO_BUCKET, Key: uploadedKeys[0]! }),
        ),
      ).rejects.toThrow();
    } finally {
      await dbFailApp.close();
    }
  });
});
