import {
  DOCUMENT_PROCESS_JOB_NAME,
  DOCUMENT_PROCESSING_QUEUE_NAME,
  type DocumentProcessJobPayload,
} from '@enterprise-ai/shared';
import { Worker, type ConnectionOptions, type Job } from 'bullmq';
import {
  processDocumentJob,
  type DocumentProcessorDeps,
} from '../processors/document-process.processor.js';

export interface DocumentProcessingWorkerOptions extends DocumentProcessorDeps {
  connection: ConnectionOptions;
  concurrency: number;
  queueName?: string;
}

/**
 * Creates the BullMQ Worker instance consuming document processing jobs from Redis.
 */
export function createDocumentProcessingWorker(
  options: DocumentProcessingWorkerOptions,
): Worker<DocumentProcessJobPayload> {
  const {
    connection,
    concurrency,
    queueName = DOCUMENT_PROCESSING_QUEUE_NAME,
    ...processorDeps
  } = options;

  const worker = new Worker<DocumentProcessJobPayload>(
    queueName,
    async (job: Job<DocumentProcessJobPayload>) => {
      if (job.name !== DOCUMENT_PROCESS_JOB_NAME) {
        processorDeps.logger.warn(
          { jobName: job.name, jobId: job.id },
          'Ignoring unknown job name on document processing queue',
        );
        return;
      }

      const jobAttempts =
        typeof job.opts.attempts === 'number' && job.opts.attempts > 0
          ? job.opts.attempts
          : processorDeps.maxAttempts;

      await processDocumentJob(
        job.data,
        {
          bullmqJobId: job.id ? String(job.id) : undefined,
          attemptsMade: job.attemptsMade,
        },
        {
          ...processorDeps,
          maxAttempts: jobAttempts,
        },
      );
    },
    {
      connection,
      concurrency,
    },
  );

  worker.on('completed', (job) => {
    processorDeps.logger.debug(
      { jobId: job.id, documentId: job.data?.documentId },
      'BullMQ job completed',
    );
  });

  worker.on('failed', (job, error) => {
    processorDeps.logger.warn(
      {
        jobId: job?.id,
        documentId: job?.data?.documentId,
        attemptsMade: job?.attemptsMade,
        err: error,
      },
      'BullMQ job failed',
    );
  });

  worker.on('error', (error) => {
    processorDeps.logger.error({ err: error }, 'BullMQ worker error');
  });

  return worker;
}
