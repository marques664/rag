import {
  DEFAULT_JOB_ATTEMPTS,
  DEFAULT_JOB_BACKOFF_MS,
  DOCUMENT_PROCESS_JOB_NAME,
  DOCUMENT_PROCESSING_QUEUE_NAME,
  type DocumentProcessJobPayload,
} from '@enterprise-ai/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

export interface DocumentQueueService {
  enqueueDocumentProcessing(
    payload: DocumentProcessJobPayload,
  ): Promise<string | undefined>;
  close(): Promise<void>;
}

export interface DocumentQueueOptions {
  queueName?: string;
}

/**
 * BullMQ queue producer for asynchronous document processing jobs.
 */
export class BullMqDocumentQueue implements DocumentQueueService {
  private readonly connection: Redis;
  private readonly queue: Queue<
    DocumentProcessJobPayload,
    void,
    typeof DOCUMENT_PROCESS_JOB_NAME
  >;

  constructor(redisUrl: string, options?: string | DocumentQueueOptions) {
    const queueName =
      typeof options === 'string'
        ? options
        : (options?.queueName ?? DOCUMENT_PROCESSING_QUEUE_NAME);

    this.connection = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      connectTimeout: 3000,
    });

    this.queue = new Queue<
      DocumentProcessJobPayload,
      void,
      typeof DOCUMENT_PROCESS_JOB_NAME
    >(queueName, {
      connection: this.connection,
      defaultJobOptions: {
        attempts: DEFAULT_JOB_ATTEMPTS,
        backoff: {
          type: 'exponential',
          delay: DEFAULT_JOB_BACKOFF_MS,
        },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    });
  }

  async enqueueDocumentProcessing(
    payload: DocumentProcessJobPayload,
  ): Promise<string | undefined> {
    const job = await this.queue.add(DOCUMENT_PROCESS_JOB_NAME, payload, {
      jobId: payload.processingJobId,
      attempts: DEFAULT_JOB_ATTEMPTS,
      backoff: {
        type: 'exponential',
        delay: DEFAULT_JOB_BACKOFF_MS,
      },
    });

    return job.id;
  }

  async close(): Promise<void> {
    await this.queue.close();
    await this.connection.quit();
  }
}
