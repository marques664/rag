import { Redis } from 'ioredis';

/**
 * Creates a Redis client configured for BullMQ Workers (`maxRetriesPerRequest: null`
 * is required so blocking queue commands survive transient disconnects).
 */
export function createWorkerRedisClient(redisUrl: string): Redis {
  return new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
}
