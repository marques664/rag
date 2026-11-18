import path from 'node:path';
import { checkDatabaseHealth, createDatabaseClient } from '@enterprise-ai/database';
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
    checkDatabase: () => checkDatabaseHealth(database),
    checkRedis: () => checkRedisHealth(redis),
  });

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
