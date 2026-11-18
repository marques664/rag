import path from 'node:path';
import { checkDatabaseHealth, createDatabaseClient } from '@enterprise-ai/database';
import { config as loadDotenv } from 'dotenv';
import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { checkRedisHealth, createRedisClient } from './infrastructure/redis.js';

loadDotenv({ path: path.resolve(import.meta.dirname, '../../../.env') });
loadDotenv();

async function startServer(): Promise<void> {
  const env = loadEnv();
  const database = createDatabaseClient(env.DATABASE_URL);
  const redis = createRedisClient(env.REDIS_URL);

  const app = buildApp({
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    database,
    authConfig: {
      jwtSecret: env.JWT_SECRET,
      accessTokenExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
      refreshTokenExpiresDays: env.JWT_REFRESH_EXPIRES_DAYS,
    },
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
      await Promise.allSettled([database.$disconnect(), redis.quit()]);
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
    await Promise.allSettled([database.$disconnect(), redis.quit()]);
    process.exit(1);
  }
}

void startServer();
