import { randomUUID } from 'node:crypto';
import type { Document, ProcessingJob } from '@enterprise-ai/database';
import type { DocumentQueueService } from '../../infrastructure/queue.js';
import type { DocumentStorageService } from '../../infrastructure/storage.js';
import {
  DocumentAlreadyProcessingError,
  DocumentNotFoundError,
  DocumentQueueUnavailableError,
} from './documents.errors.js';
import type { DocumentsRepository } from './documents.repository.js';
import type {
  DocumentDetailDto,
  DocumentStatusDto,
  DocumentSummaryDto,
  ListDocumentsQuery,
  ListDocumentsResult,
  ProcessingJobSummaryDto,
  ReprocessDocumentResult,
  UploadDocumentInput,
} from './documents.types.js';
import {
  buildDocumentStorageKey,
  validatePdfUpload,
} from './documents.validation.js';

export interface DocumentsServiceLogger {
  error(context: Record<string, unknown>, message: string): void;
}

export interface DocumentsServiceConfig {
  maxFileSizeBytes: number;
}

function toProcessingJobSummaryDto(job: ProcessingJob): ProcessingJobSummaryDto {
  return {
    id: job.id,
    status: job.status,
    attempts: job.attempts,
    error: job.error,
    startedAt: job.startedAt ? job.startedAt.toISOString() : null,
    completedAt: job.completedAt ? job.completedAt.toISOString() : null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

function toDocumentSummaryDto(document: Document): DocumentSummaryDto {
  return {
    id: document.id,
    organizationId: document.organizationId,
    uploadedByUserId: document.uploadedByUserId,
    filename: document.filename,
    mimeType: document.mimeType,
    fileSize: document.fileSize,
    checksum: document.checksum,
    status: document.status,
    pageCount: document.pageCount,
    processingVersion: document.processingVersion,
    errorMessage: document.errorMessage,
    processedAt: document.processedAt
      ? document.processedAt.toISOString()
      : null,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

export class DocumentsService {
  constructor(
    private readonly repository: DocumentsRepository,
    private readonly storage: DocumentStorageService,
    private readonly queue: DocumentQueueService,
    private readonly config: DocumentsServiceConfig,
    private readonly logger: DocumentsServiceLogger,
  ) {}

  private async enqueueAndTrackJob(params: {
    document: Document;
    job: ProcessingJob;
    storageKey: string;
  }): Promise<void> {
    try {
      const bullmqJobId = await this.queue.enqueueDocumentProcessing({
        documentId: params.document.id,
        organizationId: params.document.organizationId,
        processingJobId: params.job.id,
        storageKey: params.storageKey,
        processingVersion: params.document.processingVersion,
      });

      if (bullmqJobId) {
        try {
          await this.repository.updateJobBullmqId(params.job.id, bullmqJobId);
        } catch (error) {
          this.logger.error(
            {
              err: error,
              documentId: params.document.id,
              processingJobId: params.job.id,
              bullmqJobId,
            },
            'Failed to persist BullMQ job id on processing job',
          );
        }
      }
    } catch (error) {
      this.logger.error(
        {
          err: error,
          documentId: params.document.id,
          organizationId: params.document.organizationId,
          processingJobId: params.job.id,
        },
        'Failed to enqueue document processing job',
      );

      try {
        await this.repository.markEnqueueFailed({
          documentId: params.document.id,
          organizationId: params.document.organizationId,
          processingJobId: params.job.id,
          errorMessage: 'Failed to enqueue document processing job',
        });
      } catch (markError) {
        this.logger.error(
          {
            err: markError,
            documentId: params.document.id,
            processingJobId: params.job.id,
          },
          'Failed to mark document and processing job as FAILED after enqueue failure',
        );
      }

      throw new DocumentQueueUnavailableError();
    }
  }

  async uploadDocument(input: UploadDocumentInput): Promise<DocumentSummaryDto> {
    const validated = validatePdfUpload({
      rawFilename: input.filename,
      rawMimeType: input.mimeType,
      buffer: input.buffer,
      maxFileSizeBytes: this.config.maxFileSizeBytes,
    });

    const documentId = randomUUID();
    const storageKey = buildDocumentStorageKey(input.organizationId, documentId);

    await this.storage.uploadPdf({
      key: storageKey,
      body: input.buffer,
      contentType: validated.mimeType,
      metadata: {
        organizationId: input.organizationId,
        documentId,
      },
    });

    let created: { document: Document; job: ProcessingJob };
    try {
      created = await this.repository.createWithInitialJob({
        id: documentId,
        organizationId: input.organizationId,
        uploadedByUserId: input.uploadedByUserId,
        filename: validated.filename,
        storageKey,
        mimeType: validated.mimeType,
        fileSize: validated.fileSize,
        checksum: validated.checksum,
      });
    } catch (error) {
      // Compensate by removing the uploaded MinIO object if PostgreSQL persistence fails.
      try {
        await this.storage.deleteObject(storageKey);
      } catch (cleanupError) {
        this.logger.error(
          {
            err: cleanupError,
            documentId,
            organizationId: input.organizationId,
            storageKey,
          },
          'Failed to clean up MinIO object after database insert failure',
        );
      }
      throw error;
    }

    await this.enqueueAndTrackJob({
      document: created.document,
      job: created.job,
      storageKey,
    });

    return toDocumentSummaryDto(created.document);
  }

  async listDocuments(
    organizationId: string,
    query: ListDocumentsQuery,
  ): Promise<ListDocumentsResult> {
    const { documents, total } = await this.repository.listByOrganization({
      organizationId,
      status: query.status,
      page: query.page,
      limit: query.limit,
    });

    const totalPages = total === 0 ? 0 : Math.ceil(total / query.limit);

    return {
      documents: documents.map(toDocumentSummaryDto),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages,
      },
    };
  }

  async getDocument(
    documentId: string,
    organizationId: string,
  ): Promise<DocumentDetailDto> {
    const detail = await this.repository.findDetailById(
      documentId,
      organizationId,
    );

    if (!detail) {
      throw new DocumentNotFoundError();
    }

    return {
      ...toDocumentSummaryDto(detail.document),
      chunkCount: detail.chunkCount,
      latestJob: detail.latestJob
        ? toProcessingJobSummaryDto(detail.latestJob)
        : null,
    };
  }

  async getDocumentStatus(
    documentId: string,
    organizationId: string,
  ): Promise<DocumentStatusDto> {
    const detail = await this.repository.findDetailById(
      documentId,
      organizationId,
    );

    if (!detail) {
      throw new DocumentNotFoundError();
    }

    return {
      documentId: detail.document.id,
      status: detail.document.status,
      processingVersion: detail.document.processingVersion,
      chunkCount: detail.chunkCount,
      pageCount: detail.document.pageCount,
      errorMessage: detail.document.errorMessage,
      processedAt: detail.document.processedAt
        ? detail.document.processedAt.toISOString()
        : null,
      updatedAt: detail.document.updatedAt.toISOString(),
      latestJob: detail.latestJob
        ? toProcessingJobSummaryDto(detail.latestJob)
        : null,
    };
  }

  async reprocessDocument(
    documentId: string,
    organizationId: string,
  ): Promise<ReprocessDocumentResult> {
    const result = await this.repository.reprocessTransaction({
      documentId,
      organizationId,
    });

    if (result.status === 'not_found') {
      throw new DocumentNotFoundError();
    }

    if (result.status === 'conflict') {
      throw new DocumentAlreadyProcessingError();
    }

    await this.enqueueAndTrackJob({
      document: result.document,
      job: result.job,
      storageKey: result.document.storageKey,
    });

    return {
      document: toDocumentSummaryDto(result.document),
      job: toProcessingJobSummaryDto(result.job),
    };
  }

  async deleteDocument(
    documentId: string,
    organizationId: string,
  ): Promise<void> {
    const deleted = await this.repository.deleteByIdTransaction(
      documentId,
      organizationId,
    );

    if (!deleted) {
      throw new DocumentNotFoundError();
    }

    try {
      await this.storage.deleteObject(deleted.storageKey);
    } catch (error) {
      // DB record is already deleted; log storage key for out-of-band cleanup.
      this.logger.error(
        {
          err: error,
          documentId: deleted.id,
          organizationId,
          storageKey: deleted.storageKey,
        },
        'Failed to delete document object from MinIO after database deletion',
      );
    }
  }
}
