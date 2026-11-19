import path from 'node:path';
import { createEmbeddingProvider, loadAIConfig } from '@enterprise-ai/ai';
import { createDatabaseClient } from '@enterprise-ai/database';
import { config as loadDotenv } from 'dotenv';
import { loadWorkerEnv } from './config/env.js';
import { createWorkerLogger } from './infrastructure/logger.js';
import { createWorkerRedisClient } from './infrastructure/redis.js';
import { MinioDocumentStorage } from './infrastructure/storage.js';
import { createDocumentProcessingWorker } from './queues/document-processing.worker.js';
import { PageAwareTokenChunker } from './services/chunker.service.js';
import { UnpdfTextExtractor } from './services/pdf-extractor.service.js';

loadDotenv({ path: path.resolve(import.meta.dirname, '../../../.env') });
loadDotenv();

async function startWorker(): Promise<void> {
  const env = loadWorkerEnv();
  const aiConfig = loadAIConfig();
  const embeddingProvider = createEmbeddingProvider(aiConfig);
  const logger = createWorkerLogger({
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
  });

  const database = createDatabaseClient(env.DATABASE_URL);
  const redis = createWorkerRedisClient(env.REDIS_URL);
  const storage = new MinioDocumentStorage({
    endpoint: env.MINIO_ENDPOINT,
    port: env.MINIO_PORT,
    useSsl: env.MINIO_USE_SSL,
    accessKeyId: env.MINIO_ROOT_USER,
    secretAccessKey: env.MINIO_ROOT_PASSWORD,
    bucket: env.MINIO_BUCKET,
    region: env.MINIO_REGION,
  });

  const extractor = new UnpdfTextExtractor();
  const chunker = new PageAwareTokenChunker();

  const worker = createDocumentProcessingWorker({
    connection: redis,
    concurrency: env.WORKER_CONCURRENCY,
    database,
    storage,
    extractor,
    chunker,
    embeddingProvider,
    logger,
    maxAttempts: env.WORKER_MAX_ATTEMPTS,
  });

  logger.info(
    {
      concurrency: env.WORKER_CONCURRENCY,
      maxAttempts: env.WORKER_MAX_ATTEMPTS,
      bucket: env.MINIO_BUCKET,
      embeddingProvider: embeddingProvider.providerName,
      embeddingModel: embeddingProvider.model,
      embeddingDimensions: embeddingProvider.dimensions,
    },
    'Document processing worker started',
  );

  let isShuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;

    logger.info({ signal }, 'Shutting down document processing worker');

    try {
      await worker.close();
      storage.close();
      await Promise.allSettled([database.$disconnect(), redis.quit()]);
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, 'Error during worker shutdown');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

void startWorker().catch((error: unknown) => {
  console.error('Failed to start document processing worker:', error);
  process.exit(1);
});
