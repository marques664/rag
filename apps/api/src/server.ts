import path from 'node:path';
import {
  createEmbeddingProvider,
  createLLMProvider,
  loadAIConfig,
} from '@enterprise-ai/ai';
import {
  checkDatabaseHealth,
  createDatabaseClient,
  PgVectorRetrievalService,
} from '@enterprise-ai/database';
import { config as loadDotenv } from 'dotenv';
import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { BullMqDocumentQueue } from './infrastructure/queue.js';
import { checkRedisHealth, createRedisClient } from './infrastructure/redis.js';
import { MinioDocumentStorage } from './infrastructure/storage.js';

loadDotenv({ path: path.resolve(import.meta.dirname, '../../../.env') });
loadDotenv();

async function startServer(): Promise<void> {
  const env = loadEnv();
  const database = createDatabaseClient(env.DATABASE_URL);
  const redis = createRedisClient(env.REDIS_URL);
  const documentStorage = new MinioDocumentStorage({
    endpoint: env.MINIO_ENDPOINT,
    port: env.MINIO_PORT,
    useSsl: env.MINIO_USE_SSL,
    accessKeyId: env.MINIO_ROOT_USER,
    secretAccessKey: env.MINIO_ROOT_PASSWORD,
    bucket: env.MINIO_BUCKET,
  });
  const documentQueue = new BullMqDocumentQueue(env.REDIS_URL);
  const aiConfig = loadAIConfig();
  const retrievalService = new PgVectorRetrievalService(database, {
    defaultTopK: env.RAG_DEFAULT_TOP_K,
  });
  const hasAiCredentials = Boolean(aiConfig.openai.apiKey);
  const embeddingProvider = hasAiCredentials
    ? createEmbeddingProvider(aiConfig)
    : undefined;
  const llmProvider = hasAiCredentials
    ? createLLMProvider(aiConfig)
    : undefined;

  const app = buildApp({
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    database,
    authConfig: {
      jwtSecret: env.JWT_SECRET,
      accessTokenExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
      refreshTokenExpiresDays: env.JWT_REFRESH_EXPIRES_DAYS,
    },
    documentStorage,
    documentQueue,
    maxDocumentFileSizeBytes: env.MAX_DOCUMENT_FILE_SIZE_BYTES,
    retrievalService,
    embeddingProvider,
    llmProvider,
    ragDefaultTopK: env.RAG_DEFAULT_TOP_K,
    ragMaxContextChars: env.RAG_MAX_CONTEXT_CHARS,
    checkDatabase: () => checkDatabaseHealth(database),
    checkRedis: () => checkRedisHealth(redis),
  });

  if (!hasAiCredentials) {
    app.log.warn(
      'OPENAI_API_KEY is not configured; RAG message generation will return 503 AI_PROVIDER_NOT_CONFIGURED',
    );
  }

  let isShuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;

    app.log.info({ signal }, 'Shutting down API server');

    try {
      await app.close();
      await Promise.allSettled([
        documentQueue.close(),
        database.$disconnect(),
        redis.quit(),
      ]);
      documentStorage.destroy();
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, 'Error during graceful shutdown');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  try {
    await app.listen({
      host: env.API_HOST,
      port: env.API_PORT,
    });
  } catch (error) {
    app.log.error({ err: error }, 'Failed to start API server');
    await Promise.allSettled([
      documentQueue.close(),
      database.$disconnect(),
      redis.quit(),
    ]);
    documentStorage.destroy();
    process.exit(1);
  }
}

void startServer();
