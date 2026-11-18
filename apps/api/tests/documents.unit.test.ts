import { createHash } from 'node:crypto';
import {
  DocumentStatus,
  MembershipRole,
  ProcessingJobStatus,
  type DatabaseClient,
  type Document,
  type ProcessingJob,
} from '@enterprise-ai/database';
import {
  DOCUMENT_PROCESS_JOB_NAME,
  DOCUMENT_PROCESSING_QUEUE_NAME,
  type DocumentProcessJobPayload,
} from '@enterprise-ai/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import type { DocumentQueueService } from '../src/infrastructure/queue.js';
import type { DocumentStorageService } from '../src/infrastructure/storage.js';
import {
  DocumentTooLargeError,
  InvalidDocumentUploadError,
  InvalidPdfContentError,
  UnsupportedDocumentTypeError,
} from '../src/modules/documents/documents.errors.js';
import {
  buildDocumentStorageKey,
  sanitizePdfFilename,
  validatePdfUpload,
} from '../src/modules/documents/documents.validation.js';
import { signAccessToken } from '../src/shared/security/tokens.js';

const TEST_JWT_SECRET = 'unit-test-jwt-secret-key-minimum-32-chars';
const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const USER_MEMBER = '33333333-3333-4333-8333-333333333333';
const USER_ADMIN = '44444444-4444-4444-8444-444444444444';
const DOC_1 = '55555555-5555-4555-8555-555555555555';
const JOB_1 = '66666666-6666-4666-8666-666666666666';
const JOB_2 = '77777777-7777-4777-8777-777777777777';

const SAMPLE_PDF_BYTES = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n',
  'utf8',
);

function buildMultipartPayload(params: {
  fieldName?: string;
  filename: string;
  contentType: string;
  content: Buffer;
}): { body: Buffer; contentTypeHeader: string } {
  const boundary = '----EnterpriseKnowledgeAiTestBoundary12345';
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

interface InMemoryDocState {
  memberships: Array<{ organizationId: string; userId: string; role: MembershipRole }>;
  documents: Document[];
  jobs: ProcessingJob[];
  chunks: Array<{ id: string; documentId: string; organizationId: string }>;
  failDocumentCreate?: boolean;
}

function createFakeDatabase(state: InMemoryDocState): DatabaseClient {
  const txClient = {
    membership: {
      findUnique: async ({
        where,
      }: {
        where: { organizationId_userId: { organizationId: string; userId: string } };
      }) => {
        return (
          state.memberships.find(
            (m) =>
              m.organizationId === where.organizationId_userId.organizationId &&
              m.userId === where.organizationId_userId.userId,
          ) ?? null
        );
      },
    },
    document: {
      create: async ({
        data,
      }: {
        data: {
          id: string;
          organizationId: string;
          uploadedByUserId: string | null;
          filename: string;
          storageKey: string;
          mimeType: string;
          fileSize: number;
          checksum: string;
          status: DocumentStatus;
          processingVersion: number;
        };
      }) => {
        if (state.failDocumentCreate) {
          throw new Error('Simulated DB insert failure');
        }
        const now = new Date();
        const doc: Document = {
          id: data.id,
          organizationId: data.organizationId,
          uploadedByUserId: data.uploadedByUserId,
          filename: data.filename,
          storageKey: data.storageKey,
          mimeType: data.mimeType,
          fileSize: data.fileSize,
          checksum: data.checksum,
          status: data.status,
          pageCount: null,
          processingVersion: data.processingVersion,
          errorMessage: null,
          processedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        state.documents.push(doc);
        return doc;
      },
      findMany: async ({
        where,
        skip = 0,
        take = 20,
      }: {
        where: { organizationId: string; status?: DocumentStatus };
        skip?: number;
        take?: number;
      }) => {
        return state.documents
          .filter(
            (d) =>
              d.organizationId === where.organizationId &&
              (where.status === undefined || d.status === where.status),
          )
          .slice(skip, skip + take);
      },
      count: async ({
        where,
      }: {
        where: { organizationId: string; status?: DocumentStatus };
      }) => {
        return state.documents.filter(
          (d) =>
            d.organizationId === where.organizationId &&
            (where.status === undefined || d.status === where.status),
        ).length;
      },
      findFirst: async ({
        where,
        include,
      }: {
        where: { id: string; organizationId: string };
        include?: unknown;
      }) => {
        const doc = state.documents.find(
          (d) => d.id === where.id && d.organizationId === where.organizationId,
        );
        if (!doc) {
          return null;
        }
        if (!include) {
          return doc;
        }
        const docChunks = state.chunks.filter((c) => c.documentId === doc.id);
        const docJobs = state.jobs
          .filter((j) => j.documentId === doc.id)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return {
          ...doc,
          _count: { chunks: docChunks.length },
          processingJobs: docJobs.slice(0, 1),
        };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: {
          id: string;
          organizationId: string;
          status?: { in: DocumentStatus[] };
        };
        data: {
          status?: DocumentStatus;
          processingVersion?: { increment: number };
          errorMessage?: string | null;
          pageCount?: number | null;
          processedAt?: Date | null;
        };
      }) => {
        let count = 0;
        for (const doc of state.documents) {
          const matchesId = doc.id === where.id && doc.organizationId === where.organizationId;
          const matchesStatus =
            !where.status?.in || where.status.in.includes(doc.status);
          if (matchesId && matchesStatus) {
            if (data.status !== undefined) doc.status = data.status;
            if (data.processingVersion?.increment) {
              doc.processingVersion += data.processingVersion.increment;
            }
            if (data.errorMessage !== undefined) doc.errorMessage = data.errorMessage;
            if (data.pageCount !== undefined) doc.pageCount = data.pageCount;
            if (data.processedAt !== undefined) doc.processedAt = data.processedAt;
            doc.updatedAt = new Date();
            count += 1;
          }
        }
        return { count };
      },
      deleteMany: async ({
        where,
      }: {
        where: { id: string; organizationId: string };
      }) => {
        const before = state.documents.length;
        state.documents = state.documents.filter(
          (d) => !(d.id === where.id && d.organizationId === where.organizationId),
        );
        const count = before - state.documents.length;
        if (count > 0) {
          state.chunks = state.chunks.filter((c) => c.documentId !== where.id);
          state.jobs = state.jobs.filter((j) => j.documentId !== where.id);
        }
        return { count };
      },
    },
    documentChunk: {
      deleteMany: async ({
        where,
      }: {
        where: { documentId: string; organizationId: string };
      }) => {
        const before = state.chunks.length;
        state.chunks = state.chunks.filter(
          (c) =>
            !(
              c.documentId === where.documentId &&
              c.organizationId === where.organizationId
            ),
        );
        return { count: before - state.chunks.length };
      },
    },
    processingJob: {
      create: async ({
        data,
      }: {
        data: { documentId: string; status: ProcessingJobStatus; attempts: number };
      }) => {
        const now = new Date();
        const job: ProcessingJob = {
          id: state.jobs.length === 0 ? JOB_1 : JOB_2,
          documentId: data.documentId,
          bullmqJobId: null,
          status: data.status,
          attempts: data.attempts,
          error: null,
          startedAt: null,
          completedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        state.jobs.push(job);
        return job;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { bullmqJobId?: string };
      }) => {
        const job = state.jobs.find((j) => j.id === where.id);
        if (!job) throw new Error('Job not found');
        if (data.bullmqJobId !== undefined) job.bullmqJobId = data.bullmqJobId;
        return job;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; documentId: string };
        data: { status?: ProcessingJobStatus; error?: string | null; completedAt?: Date };
      }) => {
        let count = 0;
        for (const job of state.jobs) {
          if (job.id === where.id && job.documentId === where.documentId) {
            if (data.status !== undefined) job.status = data.status;
            if (data.error !== undefined) job.error = data.error;
            if (data.completedAt !== undefined) job.completedAt = data.completedAt;
            count += 1;
          }
        }
        return { count };
      },
    },
  };

  return {
    ...txClient,
    $transaction: async <T>(fn: (tx: typeof txClient) => Promise<T>): Promise<T> =>
      fn(txClient),
  } as unknown as DatabaseClient;
}

describe('document upload validation and config', () => {
  it('sanitizes filenames against path traversal, control chars, and length limits', () => {
    expect(sanitizePdfFilename('../../secret/manual.PDF')).toBe('manual.PDF');
    expect(sanitizePdfFilename('C:\\Users\\Alice\\guide.pdf')).toBe('guide.pdf');
    expect(sanitizePdfFilename('my\u0000report\u0007.pdf')).toBe('myreport.pdf');

    const longName = `${'a'.repeat(260)}.pdf`;
    const truncated = sanitizePdfFilename(longName);
    expect(truncated.length).toBe(255);
    expect(truncated.endsWith('.pdf')).toBe(true);

    expect(() => sanitizePdfFilename('')).toThrow(InvalidDocumentUploadError);
    expect(() => sanitizePdfFilename('..')).toThrow(InvalidDocumentUploadError);
    expect(() => sanitizePdfFilename('notes.txt')).toThrow(
      UnsupportedDocumentTypeError,
    );
  });

  it('validates PDF MIME, extension, size, magic bytes, and computes SHA-256', () => {
    const validated = validatePdfUpload({
      rawFilename: 'architecture.pdf',
      rawMimeType: 'application/pdf',
      buffer: SAMPLE_PDF_BYTES,
      maxFileSizeBytes: 1024 * 1024,
    });

    expect(validated).toEqual({
      filename: 'architecture.pdf',
      mimeType: 'application/pdf',
      fileSize: SAMPLE_PDF_BYTES.length,
      checksum: createHash('sha256').update(SAMPLE_PDF_BYTES).digest('hex'),
    });

    expect(() =>
      validatePdfUpload({
        rawFilename: 'fake.pdf',
        rawMimeType: 'text/plain',
        buffer: SAMPLE_PDF_BYTES,
        maxFileSizeBytes: 1024,
      }),
    ).toThrow(UnsupportedDocumentTypeError);

    expect(() =>
      validatePdfUpload({
        rawFilename: 'empty.pdf',
        rawMimeType: 'application/pdf',
        buffer: Buffer.alloc(0),
        maxFileSizeBytes: 1024,
      }),
    ).toThrow(InvalidDocumentUploadError);

    expect(() =>
      validatePdfUpload({
        rawFilename: 'big.pdf',
        rawMimeType: 'application/pdf',
        buffer: Buffer.concat([SAMPLE_PDF_BYTES, Buffer.alloc(100)]),
        maxFileSizeBytes: 50,
      }),
    ).toThrow(DocumentTooLargeError);

    expect(() =>
      validatePdfUpload({
        rawFilename: 'spoofed.pdf',
        rawMimeType: 'application/pdf',
        buffer: Buffer.from('MZ executable disguised as pdf'),
        maxFileSizeBytes: 1024,
      }),
    ).toThrow(InvalidPdfContentError);
  });

  it('generates opaque UUID-based storage keys independent of user filenames', () => {
    const key = buildDocumentStorageKey(ORG_A, DOC_1);
    expect(key).toMatch(
      new RegExp(
        `^organizations/${ORG_A}/documents/${DOC_1}/[0-9a-f-]{36}\\.pdf$`,
      ),
    );
  });

  it('parses MINIO_USE_SSL boolean strings accurately in loadEnv', () => {
    const envFalse = loadEnv({
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/db',
      REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: TEST_JWT_SECRET,
      MINIO_USE_SSL: 'false',
    });
    expect(envFalse.MINIO_USE_SSL).toBe(false);
    expect(envFalse.MINIO_BUCKET).toBe('enterprise-knowledge-documents');

    const envTrue = loadEnv({
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/db',
      REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: TEST_JWT_SECRET,
      MINIO_USE_SSL: 'true',
    });
    expect(envTrue.MINIO_USE_SSL).toBe(true);
  });
});

describe('documents HTTP endpoints (unit with injected storage/queue/db)', () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    while (apps.length > 0) {
      const instance = apps.pop();
      if (instance) {
        await instance.close();
      }
    }
  });

  function createTestHarness(overrides?: {
    state?: Partial<InMemoryDocState>;
    maxBytes?: number;
    storage?: Partial<DocumentStorageService>;
    queue?: Partial<DocumentQueueService>;
  }) {
    const state: InMemoryDocState = {
      memberships: [
        { organizationId: ORG_A, userId: USER_MEMBER, role: MembershipRole.MEMBER },
        { organizationId: ORG_A, userId: USER_ADMIN, role: MembershipRole.ADMIN },
      ],
      documents: [],
      jobs: [],
      chunks: [],
      ...overrides?.state,
    };

    const uploadedObjects = new Map<string, Buffer>();
    const enqueuedPayloads: DocumentProcessJobPayload[] = [];

    const storage: DocumentStorageService = {
      uploadPdf: vi.fn(async ({ key, body }) => {
        uploadedObjects.set(key, body);
      }),
      deleteObject: vi.fn(async (key) => {
        uploadedObjects.delete(key);
      }),
      ...overrides?.storage,
    };

    const queue: DocumentQueueService = {
      enqueueDocumentProcessing: vi.fn(async (payload) => {
        enqueuedPayloads.push(payload);
        return payload.processingJobId;
      }),
      close: vi.fn(async () => {}),
      ...overrides?.queue,
    };

    const db = createFakeDatabase(state);

    const app = buildApp({
      nodeEnv: 'test',
      database: db,
      authConfig: {
        jwtSecret: TEST_JWT_SECRET,
        accessTokenExpiresIn: '15m',
        refreshTokenExpiresDays: 7,
      },
      documentStorage: storage,
      documentQueue: queue,
      maxDocumentFileSizeBytes: overrides?.maxBytes ?? 1024 * 1024,
      checkDatabase: async () => ({
        status: 'up',
        latencyMs: 1,
        pgvectorEnabled: true,
      }),
      checkRedis: async () => ({ status: 'up', latencyMs: 1 }),
    });

    apps.push(app);
    return { app, state, storage, queue, uploadedObjects, enqueuedPayloads };
  }

  async function issueToken(userId: string, email: string): Promise<string> {
    return signAccessToken(
      { sub: userId, email },
      { secret: TEST_JWT_SECRET, expiresIn: '15m' },
    );
  }

  it('enforces auth, header validation, membership, and RBAC before upload stream consumption', async () => {
    const { app, storage } = createTestHarness();
    const memberToken = await issueToken(USER_MEMBER, 'member@org.test');
    const multipart = buildMultipartPayload({
      filename: 'test.pdf',
      contentType: 'application/pdf',
      content: SAMPLE_PDF_BYTES,
    });

    const noAuth = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: {
        'x-organization-id': ORG_A,
        'content-type': multipart.contentTypeHeader,
      },
      payload: multipart.body,
    });
    expect(noAuth.statusCode).toBe(401);

    const missingHeader = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: {
        authorization: `Bearer ${memberToken}`,
        'content-type': multipart.contentTypeHeader,
      },
      payload: multipart.body,
    });
    expect(missingHeader.statusCode).toBe(400);

    const nonMember = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: {
        authorization: `Bearer ${memberToken}`,
        'x-organization-id': ORG_B,
        'content-type': multipart.contentTypeHeader,
      },
      payload: multipart.body,
    });
    expect(nonMember.statusCode).toBe(403);
    expect(storage.uploadPdf).not.toHaveBeenCalled();
  });

  it('uploads PDF, stores in MinIO, persists DB + job, and hides storageKey', async () => {
    const { app, state, uploadedObjects, enqueuedPayloads } = createTestHarness();
    const memberToken = await issueToken(USER_MEMBER, 'member@org.test');
    const multipart = buildMultipartPayload({
      filename: '../../handbook.pdf',
      contentType: 'application/pdf',
      content: SAMPLE_PDF_BYTES,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: {
        authorization: `Bearer ${memberToken}`,
        'x-organization-id': ORG_A,
        'content-type': multipart.contentTypeHeader,
      },
      payload: multipart.body,
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.document.filename).toBe('handbook.pdf');
    expect(body.document.status).toBe('PENDING');
    expect(body.document.processingVersion).toBe(1);
    expect(body.document.storageKey).toBeUndefined();

    expect(uploadedObjects.size).toBe(1);
    expect(state.documents).toHaveLength(1);
    expect(state.jobs).toHaveLength(1);
    expect(enqueuedPayloads).toHaveLength(1);
    expect(enqueuedPayloads[0]).toEqual({
      documentId: body.document.id,
      organizationId: ORG_A,
      processingJobId: state.jobs[0]?.id,
      storageKey: state.documents[0]?.storageKey,
      processingVersion: 1,
    });
    expect(DOCUMENT_PROCESSING_QUEUE_NAME).toBe('document-processing');
    expect(DOCUMENT_PROCESS_JOB_NAME).toBe('process-document');
  });

  it('rejects oversized and spoofed PDFs with 413 and 400 without touching storage', async () => {
    const { app, storage } = createTestHarness({ maxBytes: 20 });
    const memberToken = await issueToken(USER_MEMBER, 'member@org.test');

    const oversized = buildMultipartPayload({
      filename: 'large.pdf',
      contentType: 'application/pdf',
      content: SAMPLE_PDF_BYTES,
    });
    const oversizedRes = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: {
        authorization: `Bearer ${memberToken}`,
        'x-organization-id': ORG_A,
        'content-type': oversized.contentTypeHeader,
      },
      payload: oversized.body,
    });
    expect(oversizedRes.statusCode).toBe(413);

    const spoofed = buildMultipartPayload({
      filename: 'spoof.pdf',
      contentType: 'application/pdf',
      content: Buffer.from('plain text'),
    });
    const spoofedRes = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: {
        authorization: `Bearer ${memberToken}`,
        'x-organization-id': ORG_A,
        'content-type': spoofed.contentTypeHeader,
      },
      payload: spoofed.body,
    });
    expect(spoofedRes.statusCode).toBe(400);
    expect(spoofedRes.json().error).toBe('INVALID_PDF_CONTENT');
    expect(storage.uploadPdf).not.toHaveBeenCalled();
  });

  it('compensates MinIO object when DB fails and marks FAILED (503) when BullMQ fails', async () => {
    const dbFailHarness = createTestHarness({
      state: { failDocumentCreate: true },
    });
    const memberToken = await issueToken(USER_MEMBER, 'member@org.test');
    const multipart = buildMultipartPayload({
      filename: 'doc.pdf',
      contentType: 'application/pdf',
      content: SAMPLE_PDF_BYTES,
    });

    const dbFailRes = await dbFailHarness.app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: {
        authorization: `Bearer ${memberToken}`,
        'x-organization-id': ORG_A,
        'content-type': multipart.contentTypeHeader,
      },
      payload: multipart.body,
    });
    expect(dbFailRes.statusCode).toBe(500);
    expect(dbFailHarness.storage.deleteObject).toHaveBeenCalledTimes(1);
    expect(dbFailHarness.uploadedObjects.size).toBe(0);

    const queueFailHarness = createTestHarness({
      queue: {
        enqueueDocumentProcessing: vi.fn(async () => {
          throw new Error('Redis connection refused');
        }),
      },
    });
    const queueFailRes = await queueFailHarness.app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: {
        authorization: `Bearer ${memberToken}`,
        'x-organization-id': ORG_A,
        'content-type': multipart.contentTypeHeader,
      },
      payload: multipart.body,
    });
    expect(queueFailRes.statusCode).toBe(503);
    expect(queueFailHarness.state.documents[0]?.status).toBe(DocumentStatus.FAILED);
    expect(queueFailHarness.state.jobs[0]?.status).toBe(ProcessingJobStatus.FAILED);
  });

  it('supports list/details/status, RBAC for reprocess/delete, and DB-first deletion', async () => {
    const now = new Date();
    const docStorageKey = `organizations/${ORG_A}/documents/${DOC_1}/file.pdf`;
    const { app, state, storage, uploadedObjects, enqueuedPayloads } =
      createTestHarness({
        state: {
          documents: [
            {
              id: DOC_1,
              organizationId: ORG_A,
              uploadedByUserId: USER_MEMBER,
              filename: 'policy.pdf',
              storageKey: docStorageKey,
              mimeType: 'application/pdf',
              fileSize: SAMPLE_PDF_BYTES.length,
              checksum: 'abc',
              status: DocumentStatus.COMPLETED,
              pageCount: 3,
              processingVersion: 1,
              errorMessage: null,
              processedAt: now,
              createdAt: now,
              updatedAt: now,
            },
          ],
          chunks: [{ id: 'c1', documentId: DOC_1, organizationId: ORG_A }],
          jobs: [
            {
              id: JOB_1,
              documentId: DOC_1,
              bullmqJobId: JOB_1,
              status: ProcessingJobStatus.COMPLETED,
              attempts: 1,
              error: null,
              startedAt: now,
              completedAt: now,
              createdAt: now,
              updatedAt: now,
            },
          ],
        },
      });
    uploadedObjects.set(docStorageKey, SAMPLE_PDF_BYTES);

    const memberToken = await issueToken(USER_MEMBER, 'member@org.test');
    const adminToken = await issueToken(USER_ADMIN, 'admin@org.test');

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/documents?status=COMPLETED',
      headers: {
        authorization: `Bearer ${memberToken}`,
        'x-organization-id': ORG_A,
      },
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().documents).toHaveLength(1);
    expect(listRes.json().documents[0].storageKey).toBeUndefined();

    const detailRes = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${DOC_1}`,
      headers: {
        authorization: `Bearer ${memberToken}`,
        'x-organization-id': ORG_A,
      },
    });
    expect(detailRes.statusCode).toBe(200);
    expect(detailRes.json().document.chunkCount).toBe(1);
    expect(detailRes.json().document.latestJob.id).toBe(JOB_1);

    const statusRes = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${DOC_1}/status`,
      headers: {
        authorization: `Bearer ${memberToken}`,
        'x-organization-id': ORG_A,
      },
    });
    expect(statusRes.statusCode).toBe(200);
    expect(statusRes.json().status.status).toBe('COMPLETED');

    // MEMBER cannot reprocess or delete
    const memberReprocess = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${DOC_1}/reprocess`,
      headers: {
        authorization: `Bearer ${memberToken}`,
        'x-organization-id': ORG_A,
      },
    });
    expect(memberReprocess.statusCode).toBe(403);

    const memberDelete = await app.inject({
      method: 'DELETE',
      url: `/api/v1/documents/${DOC_1}`,
      headers: {
        authorization: `Bearer ${memberToken}`,
        'x-organization-id': ORG_A,
      },
    });
    expect(memberDelete.statusCode).toBe(403);

    // ADMIN can reprocess -> increments version, clears old chunks, enqueues job
    const adminReprocess = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${DOC_1}/reprocess`,
      headers: {
        authorization: `Bearer ${adminToken}`,
        'x-organization-id': ORG_A,
      },
    });
    expect(adminReprocess.statusCode).toBe(202);
    expect(adminReprocess.json().document.processingVersion).toBe(2);
    expect(adminReprocess.json().document.status).toBe('PENDING');
    expect(state.chunks).toHaveLength(0);
    expect(enqueuedPayloads[0]?.processingVersion).toBe(2);

    // Reprocessing while PENDING returns 409
    const conflictReprocess = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${DOC_1}/reprocess`,
      headers: {
        authorization: `Bearer ${adminToken}`,
        'x-organization-id': ORG_A,
      },
    });
    expect(conflictReprocess.statusCode).toBe(409);

    // ADMIN can delete -> deletes DB record & MinIO object
    const adminDelete = await app.inject({
      method: 'DELETE',
      url: `/api/v1/documents/${DOC_1}`,
      headers: {
        authorization: `Bearer ${adminToken}`,
        'x-organization-id': ORG_A,
      },
    });
    expect(adminDelete.statusCode).toBe(200);
    expect(state.documents).toHaveLength(0);
    expect(storage.deleteObject).toHaveBeenCalledWith(docStorageKey);
    expect(uploadedObjects.size).toBe(0);
  });

  it('returns 404 on cross-tenant document lookup and logs without failing delete if MinIO cleanup errors', async () => {
    const now = new Date();
    const docStorageKey = `organizations/${ORG_A}/documents/${DOC_1}/file.pdf`;
    const { app, state } = createTestHarness({
      state: {
        memberships: [
          { organizationId: ORG_A, userId: USER_ADMIN, role: MembershipRole.ADMIN },
          { organizationId: ORG_B, userId: USER_ADMIN, role: MembershipRole.ADMIN },
        ],
        documents: [
          {
            id: DOC_1,
            organizationId: ORG_A,
            uploadedByUserId: USER_ADMIN,
            filename: 'secret.pdf',
            storageKey: docStorageKey,
            mimeType: 'application/pdf',
            fileSize: SAMPLE_PDF_BYTES.length,
            checksum: 'abc',
            status: DocumentStatus.COMPLETED,
            pageCount: 1,
            processingVersion: 1,
            errorMessage: null,
            processedAt: now,
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
      storage: {
        deleteObject: vi.fn(async () => {
          throw new Error('MinIO temporarily unreachable');
        }),
      },
    });

    const adminToken = await issueToken(USER_ADMIN, 'admin@org.test');

    const crossTenantGet = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${DOC_1}`,
      headers: {
        authorization: `Bearer ${adminToken}`,
        'x-organization-id': ORG_B,
      },
    });
    expect(crossTenantGet.statusCode).toBe(404);

    const crossTenantStatus = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${DOC_1}/status`,
      headers: {
        authorization: `Bearer ${adminToken}`,
        'x-organization-id': ORG_B,
      },
    });
    expect(crossTenantStatus.statusCode).toBe(404);

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/documents/${DOC_1}`,
      headers: {
        authorization: `Bearer ${adminToken}`,
        'x-organization-id': ORG_A,
      },
    });
    expect(deleteRes.statusCode).toBe(200);
    expect(state.documents).toHaveLength(0);
  });
});
