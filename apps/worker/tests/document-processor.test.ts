import { createHash } from 'node:crypto';
import {
  DocumentStatus,
  ProcessingJobStatus,
  type DatabaseClient,
} from '@enterprise-ai/database';
import type { DocumentProcessJobPayload } from '@enterprise-ai/shared';
import { UnrecoverableError } from 'bullmq';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { StorageObjectNotFoundError } from '../src/infrastructure/storage.js';
import { processDocumentJob } from '../src/processors/document-process.processor.js';
import { PageAwareTokenChunker } from '../src/services/chunker.service.js';
import { PdfExtractionError } from '../src/services/pdf-extractor.service.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG_ID = '22222222-2222-4222-8222-222222222222';
const DOC_ID = '33333333-3333-4333-8333-333333333333';
const JOB_ID = '44444444-4444-4444-8444-444444444444';

const VALID_PDF_BYTES = new Uint8Array(Buffer.from('%PDF-1.4\nfake-pdf-content'));
const VALID_CHECKSUM = createHash('sha256').update(VALID_PDF_BYTES).digest('hex');

function createPayload(
  overrides: Partial<DocumentProcessJobPayload> = {},
): DocumentProcessJobPayload {
  return {
    documentId: DOC_ID,
    organizationId: ORG_ID,
    processingJobId: JOB_ID,
    storageKey: `organizations/${ORG_ID}/documents/${DOC_ID}/file.pdf`,
    processingVersion: 1,
    ...overrides,
  };
}

function createSilentLogger() {
  return pino({ level: 'silent' });
}

function createDatabaseMock(options: {
  document?: Record<string, unknown> | null;
  processingJob?: Record<string, unknown> | null;
  lockedRow?: { id: string; processing_version: number } | null;
}) {
  const tx = {
    $queryRaw: vi.fn(async () =>
      options.lockedRow === null
        ? []
        : [options.lockedRow ?? { id: DOC_ID, processing_version: 1 }],
    ),
    documentChunk: {
      deleteMany: vi.fn(async () => ({ count: 2 })),
      createMany: vi.fn(async () => ({ count: 2 })),
    },
    document: {
      update: vi.fn(async () => ({})),
    },
    processingJob: {
      update: vi.fn(async () => ({})),
    },
  };

  const database = {
    document: {
      findUnique: vi.fn(async () =>
        options.document === undefined
          ? {
              id: DOC_ID,
              organizationId: ORG_ID,
              filename: 'policy.pdf',
              storageKey: `organizations/${ORG_ID}/documents/${DOC_ID}/file.pdf`,
              checksum: VALID_CHECKSUM,
              status: DocumentStatus.PENDING,
              processingVersion: 1,
            }
          : options.document,
      ),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    processingJob: {
      findUnique: vi.fn(async () =>
        options.processingJob === undefined
          ? {
              id: JOB_ID,
              documentId: DOC_ID,
              status: ProcessingJobStatus.PENDING,
              attempts: 0,
              startedAt: null,
            }
          : options.processingJob,
      ),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    $transaction: vi.fn(async (cb: (client: typeof tx) => Promise<unknown>) =>
      cb(tx),
    ),
  };

  return {
    database: database as unknown as DatabaseClient,
    spies: { database, tx },
  };
}

describe('document-process.processor', () => {
  it('completes happy path: deletes old chunks, inserts new chunks with orgId, and marks COMPLETED', async () => {
    const { database, spies } = createDatabaseMock({});
    const storage = {
      getObjectBytes: vi.fn(async () => VALID_PDF_BYTES),
    };
    const extractor = {
      extract: vi.fn(async () => ({
        totalPages: 2,
        pages: [
          { pageNumber: 1, text: 'Page one text content.' },
          { pageNumber: 2, text: 'Page two text content.' },
        ],
      })),
    };

    const result = await processDocumentJob(
      createPayload(),
      { bullmqJobId: JOB_ID, attemptsMade: 0 },
      {
        database,
        storage,
        extractor,
        chunker: new PageAwareTokenChunker(),
        logger: createSilentLogger(),
        maxAttempts: 3,
      },
    );

    expect(result).toEqual({
      status: 'completed',
      chunkCount: 2,
      pageCount: 2,
    });
    expect(spies.tx.documentChunk.deleteMany).toHaveBeenCalledWith({
      where: { documentId: DOC_ID },
    });
    expect(spies.tx.documentChunk.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          documentId: DOC_ID,
          organizationId: ORG_ID,
          pageNumber: 1,
          chunkIndex: 0,
        }),
        expect.objectContaining({
          documentId: DOC_ID,
          organizationId: ORG_ID,
          pageNumber: 2,
          chunkIndex: 1,
        }),
      ]),
    });
    expect(spies.tx.document.update).toHaveBeenCalledWith({
      where: { id: DOC_ID },
      data: expect.objectContaining({
        status: DocumentStatus.COMPLETED,
        pageCount: 2,
        errorMessage: null,
      }),
    });
    expect(spies.tx.processingJob.update).toHaveBeenCalledWith({
      where: { id: JOB_ID },
      data: expect.objectContaining({
        status: ProcessingJobStatus.COMPLETED,
        attempts: 1,
        error: null,
      }),
    });
  });

  it('skips idempotently if ProcessingJob and Document are already COMPLETED', async () => {
    const { database } = createDatabaseMock({
      document: {
        id: DOC_ID,
        organizationId: ORG_ID,
        filename: 'policy.pdf',
        checksum: VALID_CHECKSUM,
        status: DocumentStatus.COMPLETED,
        processingVersion: 1,
      },
      processingJob: {
        id: JOB_ID,
        documentId: DOC_ID,
        status: ProcessingJobStatus.COMPLETED,
        attempts: 1,
        startedAt: new Date(),
      },
    });
    const storage = { getObjectBytes: vi.fn() };
    const extractor = { extract: vi.fn() };

    const result = await processDocumentJob(
      createPayload(),
      { bullmqJobId: JOB_ID, attemptsMade: 0 },
      {
        database,
        storage,
        extractor,
        chunker: new PageAwareTokenChunker(),
        logger: createSilentLogger(),
        maxAttempts: 3,
      },
    );

    expect(result).toEqual({ status: 'skipped', reason: 'already_completed' });
    expect(storage.getObjectBytes).not.toHaveBeenCalled();
  });

  it('skips stale processingVersion without modifying document or chunks', async () => {
    const { database, spies } = createDatabaseMock({
      document: {
        id: DOC_ID,
        organizationId: ORG_ID,
        filename: 'policy.pdf',
        checksum: VALID_CHECKSUM,
        status: DocumentStatus.PENDING,
        processingVersion: 2,
      },
    });
    const storage = { getObjectBytes: vi.fn() };
    const extractor = { extract: vi.fn() };

    const result = await processDocumentJob(
      createPayload({ processingVersion: 1 }),
      { bullmqJobId: JOB_ID, attemptsMade: 0 },
      {
        database,
        storage,
        extractor,
        chunker: new PageAwareTokenChunker(),
        logger: createSilentLogger(),
        maxAttempts: 3,
      },
    );

    expect(result).toEqual({ status: 'skipped', reason: 'stale_version' });
    expect(spies.database.document.updateMany).not.toHaveBeenCalled();
    expect(storage.getObjectBytes).not.toHaveBeenCalled();
  });

  it('aborts cleanly if document is deleted mid-flight before transaction commit', async () => {
    const { database, spies } = createDatabaseMock({
      lockedRow: null,
    });
    const storage = { getObjectBytes: vi.fn(async () => VALID_PDF_BYTES) };
    const extractor = {
      extract: vi.fn(async () => ({
        totalPages: 1,
        pages: [{ pageNumber: 1, text: 'Content before delete' }],
      })),
    };

    const result = await processDocumentJob(
      createPayload(),
      { bullmqJobId: JOB_ID, attemptsMade: 0 },
      {
        database,
        storage,
        extractor,
        chunker: new PageAwareTokenChunker(),
        logger: createSilentLogger(),
        maxAttempts: 3,
      },
    );

    expect(result).toEqual({ status: 'skipped', reason: 'missing_document' });
    expect(spies.tx.documentChunk.deleteMany).not.toHaveBeenCalled();
    expect(spies.tx.documentChunk.createMany).not.toHaveBeenCalled();
  });

  it('throws UnrecoverableError on organization mismatch', async () => {
    const { database } = createDatabaseMock({
      document: {
        id: DOC_ID,
        organizationId: OTHER_ORG_ID,
        filename: 'policy.pdf',
        checksum: VALID_CHECKSUM,
        status: DocumentStatus.PENDING,
        processingVersion: 1,
      },
    });

    await expect(
      processDocumentJob(
        createPayload({ organizationId: ORG_ID }),
        { bullmqJobId: JOB_ID, attemptsMade: 0 },
        {
          database,
          storage: { getObjectBytes: vi.fn() },
          extractor: { extract: vi.fn() },
          chunker: new PageAwareTokenChunker(),
          logger: createSilentLogger(),
          maxAttempts: 3,
        },
      ),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('marks FAILED immediately on UnrecoverableError (missing MinIO object or checksum mismatch)', async () => {
    const { database, spies } = createDatabaseMock({});
    const storage = {
      getObjectBytes: vi.fn(async () => {
        throw new StorageObjectNotFoundError('missing.pdf');
      }),
    };

    await expect(
      processDocumentJob(
        createPayload(),
        { bullmqJobId: JOB_ID, attemptsMade: 0 },
        {
          database,
          storage,
          extractor: { extract: vi.fn() },
          chunker: new PageAwareTokenChunker(),
          logger: createSilentLogger(),
          maxAttempts: 3,
        },
      ),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    expect(spies.database.processingJob.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ProcessingJobStatus.FAILED,
          attempts: 1,
        }),
      }),
    );
    expect(spies.database.document.updateMany).toHaveBeenLastCalledWith({
      where: { id: DOC_ID, processingVersion: 1 },
      data: expect.objectContaining({
        status: DocumentStatus.FAILED,
      }),
    });
  });

  it('marks FAILED immediately on non-retryable PdfExtractionError', async () => {
    const { database, spies } = createDatabaseMock({});

    await expect(
      processDocumentJob(
        createPayload(),
        { bullmqJobId: JOB_ID, attemptsMade: 0 },
        {
          database,
          storage: { getObjectBytes: vi.fn(async () => VALID_PDF_BYTES) },
          extractor: {
            extract: vi.fn(async () => {
              throw new PdfExtractionError('No text', false);
            }),
          },
          chunker: new PageAwareTokenChunker(),
          logger: createSilentLogger(),
          maxAttempts: 3,
        },
      ),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    expect(spies.database.document.updateMany).toHaveBeenLastCalledWith({
      where: { id: DOC_ID, processingVersion: 1 },
      data: expect.objectContaining({
        status: DocumentStatus.FAILED,
      }),
    });
  });

  it('keeps Document PROCESSING on transient intermediate attempt, and marks FAILED on final attempt', async () => {
    const transientError = new Error('MinIO connection timeout');

    // Attempt 1 of 3 (attemptsMade = 0): keep PROCESSING
    const first = createDatabaseMock({});
    await expect(
      processDocumentJob(
        createPayload(),
        { bullmqJobId: JOB_ID, attemptsMade: 0 },
        {
          database: first.database,
          storage: {
            getObjectBytes: vi.fn(async () => {
              throw transientError;
            }),
          },
          extractor: { extract: vi.fn() },
          chunker: new PageAwareTokenChunker(),
          logger: createSilentLogger(),
          maxAttempts: 3,
        },
      ),
    ).rejects.toThrow('MinIO connection timeout');

    expect(first.spies.database.processingJob.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: {
          attempts: 1,
          error: 'MinIO connection timeout',
        },
      }),
    );
    // Only the initial PROCESSING update happened; never marked FAILED.
    expect(first.spies.database.document.updateMany).toHaveBeenCalledTimes(1);

    // Attempt 3 of 3 (attemptsMade = 2): mark FAILED
    const final = createDatabaseMock({});
    await expect(
      processDocumentJob(
        createPayload(),
        { bullmqJobId: JOB_ID, attemptsMade: 2 },
        {
          database: final.database,
          storage: {
            getObjectBytes: vi.fn(async () => {
              throw transientError;
            }),
          },
          extractor: { extract: vi.fn() },
          chunker: new PageAwareTokenChunker(),
          logger: createSilentLogger(),
          maxAttempts: 3,
        },
      ),
    ).rejects.toThrow('MinIO connection timeout');

    expect(final.spies.database.processingJob.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ProcessingJobStatus.FAILED,
          attempts: 3,
          error: 'MinIO connection timeout',
        }),
      }),
    );
    expect(final.spies.database.document.updateMany).toHaveBeenLastCalledWith({
      where: { id: DOC_ID, processingVersion: 1 },
      data: {
        status: DocumentStatus.FAILED,
        errorMessage: 'MinIO connection timeout',
      },
    });
  });

  it('does not swallow original error if persisting failure status throws', async () => {
    const { database, spies } = createDatabaseMock({});
    spies.database.processingJob.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockRejectedValueOnce(new Error('DB connection lost'));

    await expect(
      processDocumentJob(
        createPayload(),
        { bullmqJobId: JOB_ID, attemptsMade: 0 },
        {
          database,
          storage: {
            getObjectBytes: vi.fn(async () => {
              throw new Error('Transient MinIO error');
            }),
          },
          extractor: { extract: vi.fn() },
          chunker: new PageAwareTokenChunker(),
          logger: createSilentLogger(),
          maxAttempts: 3,
        },
      ),
    ).rejects.toThrow('Transient MinIO error');
  });
});
