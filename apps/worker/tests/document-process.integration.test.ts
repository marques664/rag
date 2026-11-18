import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  createDatabaseClient,
  DocumentStatus,
  ProcessingJobStatus,
  type DatabaseClient,
} from '@enterprise-ai/database';
import {
  DEFAULT_JOB_ATTEMPTS,
  DEFAULT_JOB_BACKOFF_MS,
  DOCUMENT_PROCESS_JOB_NAME,
  DOCUMENT_PROCESSING_QUEUE_NAME,
  type DocumentProcessJobPayload,
} from '@enterprise-ai/shared';
import { Queue, QueueEvents, type Worker } from 'bullmq';
import { config as loadDotenv } from 'dotenv';
import { Redis } from 'ioredis';
import pino from 'pino';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { createWorkerRedisClient } from '../src/infrastructure/redis.js';
import { MinioDocumentStorage } from '../src/infrastructure/storage.js';
import { processDocumentJob } from '../src/processors/document-process.processor.js';
import { createDocumentProcessingWorker } from '../src/queues/document-processing.worker.js';
import { PageAwareTokenChunker } from '../src/services/chunker.service.js';
import { UnpdfTextExtractor } from '../src/services/pdf-extractor.service.js';

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

function escapePdfLiteral(text: string): string {
  return text
    .replaceAll('\\', '\\\\')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)');
}

function wrapPdfLines(text: string, maxLineLength = 90): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [];
  }

  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= maxLineLength) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) {
    lines.push(current);
  }
  return lines;
}

function buildTestPdf(pageTexts: string[]): Buffer {
  const objects: string[] = [];
  const pageCount = pageTexts.length;
  const firstPageObjNum = 4;
  const pageObjNums: number[] = [];

  for (let i = 0; i < pageCount; i += 1) {
    pageObjNums.push(firstPageObjNum + i * 2);
  }

  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objects.push(
    `2 0 obj\n<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageCount} >>\nendobj\n`,
  );
  objects.push(
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  );

  for (let i = 0; i < pageCount; i += 1) {
    const pageObjNum = firstPageObjNum + i * 2;
    const contentObjNum = pageObjNum + 1;
    const lines = wrapPdfLines(pageTexts[i] ?? '');
    const textCommands = lines
      .map((line) => `(${escapePdfLiteral(line)}) Tj T*`)
      .join('\n');
    const streamBody =
      lines.length > 0
        ? `BT\n/F1 8 Tf\n10 TL\n36 760 Td\n${textCommands}\nET`
        : '';

    objects.push(
      `${pageObjNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjNum} 0 R >>\nendobj\n`,
    );
    objects.push(
      `${contentObjNum} 0 obj\n<< /Length ${Buffer.byteLength(streamBody, 'utf8')} >>\nstream\n${streamBody}\nendstream\nendobj\n`,
    );
  }

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];

  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += obj;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i += 1) {
    const offset = String(offsets[i] ?? 0).padStart(10, '0');
    pdf += `${offset} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'utf8');
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('Sprint 3 Worker document processing integration (PostgreSQL + MinIO + BullMQ)', () => {
  let db: DatabaseClient;
  let workerRedis: Redis;
  let queueRedis: Redis;
  let eventsRedis: Redis;
  let s3Client: S3Client;
  let storage: MinioDocumentStorage;
  let queue: Queue<DocumentProcessJobPayload, void, typeof DOCUMENT_PROCESS_JOB_NAME>;
  let queueEvents: QueueEvents;
  let worker: Worker<DocumentProcessJobPayload>;

  const extractor = new UnpdfTextExtractor();
  const chunker = new PageAwareTokenChunker();
  const silentLogger = pino({ level: 'silent' });

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

    storage = new MinioDocumentStorage({
      endpoint: MINIO_ENDPOINT,
      port: MINIO_PORT,
      useSsl: MINIO_USE_SSL,
      accessKeyId: MINIO_ROOT_USER,
      secretAccessKey: MINIO_ROOT_PASSWORD,
      bucket: MINIO_BUCKET,
    });

    workerRedis = createWorkerRedisClient(TEST_REDIS_URL);
    queueRedis = createWorkerRedisClient(TEST_REDIS_URL);
    eventsRedis = createWorkerRedisClient(TEST_REDIS_URL);

    queue = new Queue<DocumentProcessJobPayload, void, typeof DOCUMENT_PROCESS_JOB_NAME>(
      DOCUMENT_PROCESSING_QUEUE_NAME,
      { connection: queueRedis },
    );
    queueEvents = new QueueEvents(DOCUMENT_PROCESSING_QUEUE_NAME, {
      connection: eventsRedis,
    });
    await queueEvents.waitUntilReady();

    worker = createDocumentProcessingWorker({
      connection: workerRedis,
      concurrency: 1,
      database: db,
      storage,
      extractor,
      chunker,
      logger: silentLogger,
      maxAttempts: DEFAULT_JOB_ATTEMPTS,
    });
    await worker.waitUntilReady();
  });

  beforeEach(async () => {
    await db.$executeRawUnsafe(
      'TRUNCATE TABLE "document_chunks", "processing_jobs", "documents", "organization_invitations", "refresh_tokens", "memberships", "organizations", "users" RESTART IDENTITY CASCADE;',
    );
  });

  afterEach(async () => {
    for (const jobId of trackedJobIds) {
      const job = await queue.getJob(jobId);
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
        // Ignore cleanup errors.
      }
    }
    trackedMinioKeys.clear();
  });

  afterAll(async () => {
    await worker.close();
    await queueEvents.close();
    await queue.close();
    storage.close();
    s3Client.destroy();
    await Promise.allSettled([
      workerRedis.quit(),
      queueRedis.quit(),
      eventsRedis.quit(),
      db.$disconnect(),
    ]);
  });

  async function seedOrgAndUser() {
    const suffix = randomUUID().slice(0, 8);
    const org = await db.organization.create({
      data: {
        name: `Worker Org ${suffix}`,
        slug: `worker-org-${suffix}`,
      },
    });
    const user = await db.user.create({
      data: {
        name: 'Worker Test User',
        email: `worker-${suffix}@test.local`,
        passwordHash: 'scrypt$16384$8$1$00$00',
      },
    });
    return { org, user };
  }

  async function putPdfToMinio(params: {
    organizationId: string;
    documentId: string;
    bytes: Buffer;
  }): Promise<string> {
    const key = `organizations/${params.organizationId}/documents/${params.documentId}/${randomUUID()}.pdf`;
    await s3Client.send(
      new PutObjectCommand({
        Bucket: MINIO_BUCKET,
        Key: key,
        Body: params.bytes,
        ContentType: 'application/pdf',
        ContentLength: params.bytes.length,
      }),
    );
    trackedMinioKeys.add(key);
    return key;
  }

  it('processes a multi-page PDF via BullMQ into PostgreSQL chunks preserving page numbers and replaces stale chunks on reprocess', async () => {
    const { org, user } = await seedOrgAndUser();
    const documentId = randomUUID();

    // Generate enough prose on page 1 to produce >1 overlapping chunk (~500 tokens), plus pages 2 & 3.
    const longPage1 = Array.from(
      { length: 260 },
      (_, idx) => `Safety procedure step ${idx + 1} applies to turbine inspection.`,
    ).join(' ');
    const pdfV1 = buildTestPdf([
      longPage1,
      'Page two maintenance schedule for cooling pumps.',
      'Page three emergency shutdown checklist.',
    ]);
    const storageKeyV1 = await putPdfToMinio({
      organizationId: org.id,
      documentId,
      bytes: pdfV1,
    });

    await db.document.create({
      data: {
        id: documentId,
        organizationId: org.id,
        uploadedByUserId: user.id,
        filename: 'turbine-manual.pdf',
        storageKey: storageKeyV1,
        mimeType: 'application/pdf',
        fileSize: pdfV1.length,
        checksum: sha256Hex(pdfV1),
        status: DocumentStatus.PENDING,
        processingVersion: 1,
      },
    });
    const jobV1 = await db.processingJob.create({
      data: {
        documentId,
        status: ProcessingJobStatus.PENDING,
        attempts: 0,
      },
    });

    const bullJobV1 = await queue.add(
      DOCUMENT_PROCESS_JOB_NAME,
      {
        documentId,
        organizationId: org.id,
        processingJobId: jobV1.id,
        storageKey: storageKeyV1,
        processingVersion: 1,
      },
      {
        jobId: jobV1.id,
        attempts: DEFAULT_JOB_ATTEMPTS,
        backoff: { type: 'exponential', delay: DEFAULT_JOB_BACKOFF_MS },
      },
    );
    trackedJobIds.add(jobV1.id);

    await bullJobV1.waitUntilFinished(queueEvents, 20000);

    const docAfterV1 = await db.document.findUnique({ where: { id: documentId } });
    expect(docAfterV1?.status).toBe(DocumentStatus.COMPLETED);
    expect(docAfterV1?.pageCount).toBe(3);
    expect(docAfterV1?.errorMessage).toBeNull();
    expect(docAfterV1?.processedAt).not.toBeNull();

    const jobRecordV1 = await db.processingJob.findUnique({
      where: { id: jobV1.id },
    });
    expect(jobRecordV1?.status).toBe(ProcessingJobStatus.COMPLETED);
    expect(jobRecordV1?.attempts).toBe(1);
    expect(jobRecordV1?.error).toBeNull();

    const chunksV1 = await db.documentChunk.findMany({
      where: { documentId },
      orderBy: { chunkIndex: 'asc' },
    });
    expect(chunksV1.length).toBeGreaterThanOrEqual(4);
    expect(chunksV1.map((c) => c.chunkIndex)).toEqual(
      chunksV1.map((_, index) => index),
    );
    expect(chunksV1.every((c) => c.organizationId === org.id)).toBe(true);
    expect(new Set(chunksV1.map((c) => c.pageNumber))).toEqual(new Set([1, 2, 3]));
    expect(chunksV1[0]?.metadata).toMatchObject({
      filename: 'turbine-manual.pdf',
      pageNumber: 1,
      totalPages: 3,
      chunkIndex: 0,
      processingJobId: jobV1.id,
    });

    // Reprocess with v2 PDF -> replaces old chunks completely with zero duplicates
    const pdfV2 = buildTestPdf([
      'Updated revision two executive summary.',
      'Updated revision two compliance appendix.',
    ]);
    const storageKeyV2 = await putPdfToMinio({
      organizationId: org.id,
      documentId,
      bytes: pdfV2,
    });

    await db.document.update({
      where: { id: documentId },
      data: {
        storageKey: storageKeyV2,
        fileSize: pdfV2.length,
        checksum: sha256Hex(pdfV2),
        status: DocumentStatus.PENDING,
        processingVersion: 2,
        pageCount: null,
        processedAt: null,
      },
    });
    const jobV2 = await db.processingJob.create({
      data: {
        documentId,
        status: ProcessingJobStatus.PENDING,
        attempts: 0,
      },
    });

    const bullJobV2 = await queue.add(
      DOCUMENT_PROCESS_JOB_NAME,
      {
        documentId,
        organizationId: org.id,
        processingJobId: jobV2.id,
        storageKey: storageKeyV2,
        processingVersion: 2,
      },
      {
        jobId: jobV2.id,
        attempts: DEFAULT_JOB_ATTEMPTS,
        backoff: { type: 'exponential', delay: DEFAULT_JOB_BACKOFF_MS },
      },
    );
    trackedJobIds.add(jobV2.id);

    await bullJobV2.waitUntilFinished(queueEvents, 20000);

    const docAfterV2 = await db.document.findUnique({ where: { id: documentId } });
    expect(docAfterV2?.status).toBe(DocumentStatus.COMPLETED);
    expect(docAfterV2?.processingVersion).toBe(2);
    expect(docAfterV2?.pageCount).toBe(2);

    const chunksV2 = await db.documentChunk.findMany({
      where: { documentId },
      orderBy: { chunkIndex: 'asc' },
    });
    expect(chunksV2).toHaveLength(2);
    expect(chunksV2[0]?.content).toContain('Updated revision two executive summary.');
    expect(chunksV2[0]?.pageNumber).toBe(1);
    expect(chunksV2[1]?.content).toContain('Updated revision two compliance appendix.');
    expect(chunksV2[1]?.pageNumber).toBe(2);
    expect(
      chunksV2.some((c) => c.content.includes('Safety procedure step')),
    ).toBe(false);

    // Stale v1 job re-dispatched after v2 completion is safely ignored without touching v2 chunks
    const staleOutcome = await processDocumentJob(
      {
        documentId,
        organizationId: org.id,
        processingJobId: jobV1.id,
        storageKey: storageKeyV1,
        processingVersion: 1,
      },
      { bullmqJobId: `stale-${jobV1.id}`, attemptsMade: 0 },
      {
        database: db,
        storage,
        extractor,
        chunker,
        logger: silentLogger,
        maxAttempts: DEFAULT_JOB_ATTEMPTS,
      },
    );
    expect(staleOutcome).toEqual({ status: 'skipped', reason: 'stale_version' });
    expect(await db.documentChunk.count({ where: { documentId } })).toBe(2);

    // Idempotent replay of completed v2 job is safely skipped
    const replayOutcome = await processDocumentJob(
      {
        documentId,
        organizationId: org.id,
        processingJobId: jobV2.id,
        storageKey: storageKeyV2,
        processingVersion: 2,
      },
      { bullmqJobId: jobV2.id, attemptsMade: 0 },
      {
        database: db,
        storage,
        extractor,
        chunker,
        logger: silentLogger,
        maxAttempts: DEFAULT_JOB_ATTEMPTS,
      },
    );
    expect(replayOutcome).toEqual({
      status: 'skipped',
      reason: 'already_completed',
    });
  });

  it('aborts cleanly without writing orphan chunks when Document is deleted mid-flight', async () => {
    const { org, user } = await seedOrgAndUser();
    const documentId = randomUUID();
    const pdfBytes = buildTestPdf(['Mid-flight deletion race test content.']);
    const storageKey = await putPdfToMinio({
      organizationId: org.id,
      documentId,
      bytes: pdfBytes,
    });

    await db.document.create({
      data: {
        id: documentId,
        organizationId: org.id,
        uploadedByUserId: user.id,
        filename: 'race.pdf',
        storageKey,
        mimeType: 'application/pdf',
        fileSize: pdfBytes.length,
        checksum: sha256Hex(pdfBytes),
        status: DocumentStatus.PENDING,
        processingVersion: 1,
      },
    });
    const job = await db.processingJob.create({
      data: {
        documentId,
        status: ProcessingJobStatus.PENDING,
        attempts: 0,
      },
    });

    const racingExtractor = {
      extract: async (bytes: Uint8Array) => {
        const extracted = await extractor.extract(bytes);
        // Simulate DELETE /documents/:id completing while worker is extracting PDF text.
        await db.document.delete({ where: { id: documentId } });
        return extracted;
      },
    };

    const outcome = await processDocumentJob(
      {
        documentId,
        organizationId: org.id,
        processingJobId: job.id,
        storageKey,
        processingVersion: 1,
      },
      { bullmqJobId: job.id, attemptsMade: 0 },
      {
        database: db,
        storage,
        extractor: racingExtractor,
        chunker,
        logger: silentLogger,
        maxAttempts: DEFAULT_JOB_ATTEMPTS,
      },
    );

    expect(outcome).toEqual({ status: 'skipped', reason: 'missing_document' });
    expect(await db.document.findUnique({ where: { id: documentId } })).toBeNull();
    expect(await db.documentChunk.count({ where: { documentId } })).toBe(0);
  });

  it('marks Document and ProcessingJob FAILED without retrying when PDF bytes are corrupt', async () => {
    const { org, user } = await seedOrgAndUser();
    const documentId = randomUUID();
    const corruptPdf = Buffer.from('%PDF-1.4\ncorrupt-not-valid-pdf-objects');
    const storageKey = await putPdfToMinio({
      organizationId: org.id,
      documentId,
      bytes: corruptPdf,
    });

    await db.document.create({
      data: {
        id: documentId,
        organizationId: org.id,
        uploadedByUserId: user.id,
        filename: 'corrupt.pdf',
        storageKey,
        mimeType: 'application/pdf',
        fileSize: corruptPdf.length,
        checksum: sha256Hex(corruptPdf),
        status: DocumentStatus.PENDING,
        processingVersion: 1,
      },
    });
    const jobRecord = await db.processingJob.create({
      data: {
        documentId,
        status: ProcessingJobStatus.PENDING,
        attempts: 0,
      },
    });

    const bullJob = await queue.add(
      DOCUMENT_PROCESS_JOB_NAME,
      {
        documentId,
        organizationId: org.id,
        processingJobId: jobRecord.id,
        storageKey,
        processingVersion: 1,
      },
      {
        jobId: jobRecord.id,
        attempts: DEFAULT_JOB_ATTEMPTS,
        backoff: { type: 'exponential', delay: DEFAULT_JOB_BACKOFF_MS },
      },
    );
    trackedJobIds.add(jobRecord.id);

    await expect(bullJob.waitUntilFinished(queueEvents, 20000)).rejects.toThrow();

    const failedDoc = await db.document.findUnique({ where: { id: documentId } });
    expect(failedDoc?.status).toBe(DocumentStatus.FAILED);
    expect(failedDoc?.errorMessage).toBeTruthy();

    const failedJob = await db.processingJob.findUnique({
      where: { id: jobRecord.id },
    });
    expect(failedJob?.status).toBe(ProcessingJobStatus.FAILED);
    expect(failedJob?.attempts).toBe(1);
    expect(failedJob?.error).toBeTruthy();
    expect(failedJob?.completedAt).not.toBeNull();
    expect(await db.documentChunk.count({ where: { documentId } })).toBe(0);
  });
});
