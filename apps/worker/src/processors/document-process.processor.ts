import { createHash } from 'node:crypto';
import {
  DocumentStatus,
  Prisma,
  ProcessingJobStatus,
  type DatabaseClient,
} from '@enterprise-ai/database';
import type { DocumentProcessJobPayload } from '@enterprise-ai/shared';
import { UnrecoverableError } from 'bullmq';
import { z } from 'zod';
import type { WorkerLogger } from '../infrastructure/logger.js';
import {
  StorageObjectNotFoundError,
  type DocumentStorageClient,
} from '../infrastructure/storage.js';
import type { DocumentChunker } from '../services/chunker.service.js';
import {
  hasPdfMagicBytes,
  PdfExtractionError,
  type PdfTextExtractor,
} from '../services/pdf-extractor.service.js';

const jobPayloadSchema = z.object({
  documentId: z.string().uuid(),
  organizationId: z.string().uuid(),
  processingJobId: z.string().uuid(),
  storageKey: z.string().min(1),
  processingVersion: z.number().int().positive(),
});

const CHUNK_INSERT_BATCH_SIZE = 500;
const MAX_ERROR_LENGTH = 1000;

export interface DocumentProcessorDeps {
  database: DatabaseClient;
  storage: DocumentStorageClient;
  extractor: PdfTextExtractor;
  chunker: DocumentChunker;
  logger: WorkerLogger;
  maxAttempts: number;
}

export interface JobAttemptContext {
  bullmqJobId?: string;
  attemptsMade: number;
}

export type ProcessJobOutcome =
  | { status: 'completed'; chunkCount: number; pageCount: number }
  | { status: 'skipped'; reason: 'missing_document' | 'stale_version' | 'already_completed' | 'missing_job' };

function formatSafeErrorMessage(error: unknown): string {
  const raw =
    error instanceof Error ? error.message : 'Unexpected document processing error';
  const singleLine = raw.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= MAX_ERROR_LENGTH) {
    return singleLine || 'Unexpected document processing error';
  }
  return `${singleLine.slice(0, MAX_ERROR_LENGTH - 3)}...`;
}

function computeSha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Processes a single BullMQ document ingestion job:
 * - Validates tenant & processingVersion fences
 * - Fetches PDF bytes from MinIO and verifies magic bytes + SHA-256 checksum
 * - Extracts per-page text and generates ~500-token overlapping chunks
 * - Atomically replaces chunks and marks Document + ProcessingJob COMPLETED
 * - Tracks attempts, exponential-backoff retries, and terminal FAILED states
 */
export async function processDocumentJob(
  rawPayload: DocumentProcessJobPayload,
  attemptContext: JobAttemptContext,
  deps: DocumentProcessorDeps,
): Promise<ProcessJobOutcome> {
  const parsedPayload = jobPayloadSchema.safeParse(rawPayload);
  if (!parsedPayload.success) {
    throw new UnrecoverableError(
      `Invalid document processing job payload: ${parsedPayload.error.message}`,
    );
  }

  const payload = parsedPayload.data;
  const currentAttempt = attemptContext.attemptsMade + 1;
  const log = deps.logger.child({
    documentId: payload.documentId,
    organizationId: payload.organizationId,
    processingJobId: payload.processingJobId,
    processingVersion: payload.processingVersion,
    attempt: currentAttempt,
    bullmqJobId: attemptContext.bullmqJobId,
  });

  const [document, processingJob] = await Promise.all([
    deps.database.document.findUnique({
      where: { id: payload.documentId },
    }),
    deps.database.processingJob.findUnique({
      where: { id: payload.processingJobId },
    }),
  ]);

  if (!document) {
    log.info('Document no longer exists; skipping job cleanly');
    return { status: 'skipped', reason: 'missing_document' };
  }

  if (document.organizationId !== payload.organizationId) {
    throw new UnrecoverableError(
      'Organization mismatch between job payload and document record',
    );
  }

  if (document.processingVersion !== payload.processingVersion) {
    log.info(
      { currentVersion: document.processingVersion },
      'Document processingVersion superseded; skipping stale job',
    );
    return { status: 'skipped', reason: 'stale_version' };
  }

  if (!processingJob || processingJob.documentId !== payload.documentId) {
    log.warn('ProcessingJob record missing or mismatched; skipping job');
    return { status: 'skipped', reason: 'missing_job' };
  }

  if (
    processingJob.status === ProcessingJobStatus.COMPLETED &&
    document.status === DocumentStatus.COMPLETED
  ) {
    log.info('ProcessingJob already completed; skipping idempotently');
    return { status: 'skipped', reason: 'already_completed' };
  }

  // Transition document and job to PROCESSING guarded by processingVersion.
  const docStartUpdate = await deps.database.document.updateMany({
    where: {
      id: payload.documentId,
      processingVersion: payload.processingVersion,
    },
    data: {
      status: DocumentStatus.PROCESSING,
      errorMessage: null,
    },
  });

  if (docStartUpdate.count === 0) {
    log.info('Document deleted or superseded before PROCESSING transition; skipping');
    return { status: 'skipped', reason: 'stale_version' };
  }

  await deps.database.processingJob.updateMany({
    where: {
      id: payload.processingJobId,
      status: { not: ProcessingJobStatus.COMPLETED },
    },
    data: {
      status: ProcessingJobStatus.PROCESSING,
      attempts: currentAttempt,
      startedAt: processingJob.startedAt ?? new Date(),
      error: null,
      ...(attemptContext.bullmqJobId
        ? { bullmqJobId: attemptContext.bullmqJobId }
        : {}),
    },
  });

  try {
    log.info({ storageKey: payload.storageKey }, 'Downloading PDF from storage');
    let pdfBytes: Uint8Array;
    try {
      pdfBytes = await deps.storage.getObjectBytes(payload.storageKey);
    } catch (error) {
      if (error instanceof StorageObjectNotFoundError) {
        throw new UnrecoverableError(error.message);
      }
      throw error;
    }

    if (!hasPdfMagicBytes(pdfBytes)) {
      throw new UnrecoverableError(
        'Downloaded object is not a valid PDF (missing %PDF- header)',
      );
    }

    const actualChecksum = computeSha256Hex(pdfBytes);
    if (actualChecksum !== document.checksum) {
      throw new UnrecoverableError(
        'Downloaded PDF SHA-256 checksum does not match registered document checksum',
      );
    }

    let extracted;
    try {
      extracted = await deps.extractor.extract(pdfBytes);
    } catch (error) {
      if (error instanceof PdfExtractionError && !error.retryable) {
        throw new UnrecoverableError(error.message);
      }
      throw error;
    }

    const chunks = deps.chunker.chunkDocument({
      pages: extracted.pages,
      totalPages: extracted.totalPages,
      filename: document.filename,
      processingJobId: payload.processingJobId,
    });

    if (chunks.length === 0) {
      throw new UnrecoverableError('PDF text extraction produced zero chunks');
    }

    const commitResult = await deps.database.$transaction(async (tx) => {
      const lockedDocs = await tx.$queryRaw<
        Array<{ id: string; processing_version: number }>
      >`
        SELECT id, processing_version
        FROM documents
        WHERE id = ${payload.documentId}::uuid
        FOR UPDATE
      `;

      const lockedDoc = lockedDocs[0];
      if (!lockedDoc) {
        return { outcome: 'missing_document' as const };
      }

      if (lockedDoc.processing_version !== payload.processingVersion) {
        return { outcome: 'stale_version' as const };
      }

      await tx.documentChunk.deleteMany({
        where: { documentId: payload.documentId },
      });

      for (let i = 0; i < chunks.length; i += CHUNK_INSERT_BATCH_SIZE) {
        const batch = chunks.slice(i, i + CHUNK_INSERT_BATCH_SIZE);
        await tx.documentChunk.createMany({
          data: batch.map((chunk) => ({
            documentId: payload.documentId,
            organizationId: document.organizationId,
            content: chunk.content,
            pageNumber: chunk.pageNumber,
            chunkIndex: chunk.chunkIndex,
            tokenCount: chunk.tokenCount,
            metadata: chunk.metadata as Prisma.InputJsonValue,
          })),
        });
      }

      const completedAt = new Date();
      await tx.document.update({
        where: { id: payload.documentId },
        data: {
          status: DocumentStatus.COMPLETED,
          pageCount: extracted.totalPages,
          errorMessage: null,
          processedAt: completedAt,
        },
      });

      await tx.processingJob.update({
        where: { id: payload.processingJobId },
        data: {
          status: ProcessingJobStatus.COMPLETED,
          attempts: currentAttempt,
          error: null,
          completedAt,
        },
      });

      return { outcome: 'completed' as const };
    });

    if (commitResult.outcome !== 'completed') {
      log.info(
        { reason: commitResult.outcome },
        'Document deleted or superseded during processing; discarding chunks cleanly',
      );
      return { status: 'skipped', reason: commitResult.outcome };
    }

    log.info(
      { chunkCount: chunks.length, pageCount: extracted.totalPages },
      'Document processing completed',
    );

    return {
      status: 'completed',
      chunkCount: chunks.length,
      pageCount: extracted.totalPages,
    };
  } catch (error) {
    const errorMessage = formatSafeErrorMessage(error);
    const isFinalAttempt =
      error instanceof UnrecoverableError || currentAttempt >= deps.maxAttempts;

    log.error(
      { err: error, isFinalAttempt, errorMessage },
      'Document processing attempt failed',
    );

    // Best-effort status recording: never mask the original exception so BullMQ retry/failure runs.
    try {
      const failedAt = isFinalAttempt ? new Date() : undefined;

      await deps.database.processingJob.updateMany({
        where: {
          id: payload.processingJobId,
          status: { not: ProcessingJobStatus.COMPLETED },
        },
        data: {
          attempts: currentAttempt,
          error: errorMessage,
          ...(isFinalAttempt
            ? {
                status: ProcessingJobStatus.FAILED,
                completedAt: failedAt,
              }
            : {}),
        },
      });

      if (isFinalAttempt) {
        await deps.database.document.updateMany({
          where: {
            id: payload.documentId,
            processingVersion: payload.processingVersion,
          },
          data: {
            status: DocumentStatus.FAILED,
            errorMessage,
          },
        });
      }
    } catch (statusUpdateError) {
      log.error(
        { err: statusUpdateError },
        'Failed to persist document processing failure state',
      );
    }

    throw error;
  }
}
