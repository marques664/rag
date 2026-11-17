import type { DependencyCheckResult } from '@enterprise-ai/shared';
import { Redis } from 'ioredis';

export interface PingableRedis {
  ping(): Promise<string>;
}

/**
 * Creates a Redis client configured with short timeouts for API readiness checks and queues.
 */
export function createRedisClient(redisUrl: string): Redis {
  return new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
    enableReadyCheck: true,
  });
}

/**
 * Verifies Redis availability with a PING command.
 */
export async function checkRedisHealth(
  client: PingableRedis,
): Promise<DependencyCheckResult> {
  const startedAt = performance.now();

  try {
    const response = await client.ping();
    const latencyMs = Math.round(performance.now() - startedAt);

    if (response !== 'PONG') {
      return {
        status: 'down',
        latencyMs,
        error: `Unexpected Redis PING response: ${response}`,
      };
    }

    return {
      status: 'up',
      latencyMs,
    };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - startedAt);
    return {
      status: 'down',
      latencyMs,
      error: error instanceof Error ? error.message : 'Redis connection failed',
    };
  }
}
