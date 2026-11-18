import {
  DocumentStatus,
  ProcessingJobStatus,
  type DatabaseClient,
  type Document,
  type ProcessingJob,
} from '@enterprise-ai/database';

export interface DocumentDetailRecord {
  document: Document;
  chunkCount: number;
  latestJob: ProcessingJob | null;
}

export type ReprocessTransactionResult =
  | { status: 'not_found' }
  | { status: 'conflict' }
  | { status: 'requeued'; document: Document; job: ProcessingJob };

/**
 * Tenant-aware repository for documents and processing jobs.
 * Every document-scoped query enforces `organizationId` directly in PostgreSQL.
 */
export class DocumentsRepository {
  constructor(private readonly db: DatabaseClient) {}

  async createWithInitialJob(params: {
    id: string;
    organizationId: string;
    uploadedByUserId: string;
    filename: string;
    storageKey: string;
    mimeType: string;
    fileSize: number;
    checksum: string;
  }): Promise<{ document: Document; job: ProcessingJob }> {
    return this.db.$transaction(async (tx) => {
      const document = await tx.document.create({
        data: {
          id: params.id,
          organizationId: params.organizationId,
          uploadedByUserId: params.uploadedByUserId,
          filename: params.filename,
          storageKey: params.storageKey,
          mimeType: params.mimeType,
          fileSize: params.fileSize,
          checksum: params.checksum,
          status: DocumentStatus.PENDING,
          processingVersion: 1,
        },
      });

      const job = await tx.processingJob.create({
        data: {
          documentId: document.id,
          status: ProcessingJobStatus.PENDING,
          attempts: 0,
        },
      });

      return { document, job };
    });
  }

  async updateJobBullmqId(
    processingJobId: string,
    bullmqJobId: string,
  ): Promise<void> {
    await this.db.processingJob.update({
      where: { id: processingJobId },
      data: { bullmqJobId },
    });
  }

  async markEnqueueFailed(params: {
    documentId: string;
    organizationId: string;
    processingJobId: string;
    errorMessage: string;
  }): Promise<void> {
    const completedAt = new Date();

    await this.db.$transaction(async (tx) => {
      await tx.document.updateMany({
        where: {
          id: params.documentId,
          organizationId: params.organizationId,
        },
        data: {
          status: DocumentStatus.FAILED,
          errorMessage: params.errorMessage,
        },
      });

      await tx.processingJob.updateMany({
        where: {
          id: params.processingJobId,
          documentId: params.documentId,
        },
        data: {
          status: ProcessingJobStatus.FAILED,
          error: params.errorMessage,
          completedAt,
        },
      });
    });
  }

  async listByOrganization(params: {
    organizationId: string;
    status?: DocumentStatus;
    page: number;
    limit: number;
  }): Promise<{ documents: Document[]; total: number }> {
    const where = {
      organizationId: params.organizationId,
      ...(params.status !== undefined ? { status: params.status } : {}),
    };

    const skip = (params.page - 1) * params.limit;

    const [documents, total] = await Promise.all([
      this.db.document.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: params.limit,
      }),
      this.db.document.count({ where }),
    ]);

    return { documents, total };
  }

  async findDetailById(
    documentId: string,
    organizationId: string,
  ): Promise<DocumentDetailRecord | null> {
    const record = await this.db.document.findFirst({
      where: {
        id: documentId,
        organizationId,
      },
      include: {
        _count: {
          select: { chunks: true },
        },
        processingJobs: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!record) {
      return null;
    }

    const { _count, processingJobs, ...document } = record;
    return {
      document,
      chunkCount: _count.chunks,
      latestJob: processingJobs[0] ?? null,
    };
  }

  async reprocessTransaction(params: {
    documentId: string;
    organizationId: string;
  }): Promise<ReprocessTransactionResult> {
    return this.db.$transaction(async (tx) => {
      const existing = await tx.document.findFirst({
        where: {
          id: params.documentId,
          organizationId: params.organizationId,
        },
      });

      if (!existing) {
        return { status: 'not_found' };
      }

      const updated = await tx.document.updateMany({
        where: {
          id: params.documentId,
          organizationId: params.organizationId,
          status: {
            in: [DocumentStatus.COMPLETED, DocumentStatus.FAILED],
          },
        },
        data: {
          status: DocumentStatus.PENDING,
          processingVersion: { increment: 1 },
          errorMessage: null,
          pageCount: null,
          processedAt: null,
        },
      });

      if (updated.count !== 1) {
        return { status: 'conflict' };
      }

      // Clear stale chunks immediately so old chunks cannot be served while reprocessing runs.
      await tx.documentChunk.deleteMany({
        where: {
          documentId: params.documentId,
          organizationId: params.organizationId,
        },
      });

      const document = await tx.document.findFirst({
        where: {
          id: params.documentId,
          organizationId: params.organizationId,
        },
      });

      if (!document) {
        return { status: 'not_found' };
      }

      const job = await tx.processingJob.create({
        data: {
          documentId: document.id,
          status: ProcessingJobStatus.PENDING,
          attempts: 0,
        },
      });

      return { status: 'requeued', document, job };
    });
  }

  async deleteByIdTransaction(
    documentId: string,
    organizationId: string,
  ): Promise<{ id: string; storageKey: string } | null> {
    return this.db.$transaction(async (tx) => {
      const existing = await tx.document.findFirst({
        where: {
          id: documentId,
          organizationId,
        },
        select: {
          id: true,
          storageKey: true,
        },
      });

      if (!existing) {
        return null;
      }

      const deleted = await tx.document.deleteMany({
        where: {
          id: documentId,
          organizationId,
        },
      });

      if (deleted.count !== 1) {
        return null;
      }

      return existing;
    });
  }
}
