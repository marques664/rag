import type {
  DatabaseCheckResult,
  DependencyCheckResult,
  HealthResponse,
  ReadinessResponse,
} from '@enterprise-ai/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

export interface HealthRouteDependencies {
  serviceName: string;
  checkDatabase: () => Promise<DatabaseCheckResult>;
  checkRedis: () => Promise<DependencyCheckResult>;
}

const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string(),
  timestamp: z.string(),
  uptimeSeconds: z.number(),
});

const dependencyCheckSchema = z.object({
  status: z.enum(['up', 'down']),
  latencyMs: z.number(),
  error: z.string().optional(),
});

const readinessResponseSchema = z.object({
  status: z.enum(['ready', 'degraded']),
  service: z.string(),
  timestamp: z.string(),
  checks: z.object({
    database: dependencyCheckSchema.extend({
      pgvectorEnabled: z.boolean(),
    }),
    redis: dependencyCheckSchema,
  }),
});

/**
 * Registers liveness (/health) and readiness (/ready) endpoints.
 */
export async function registerHealthRoutes(
  app: FastifyInstance,
  deps: HealthRouteDependencies,
): Promise<void> {
  app.get(
    '/health',
    {
      schema: {
        response: {
          200: healthResponseSchema,
        },
      },
    },
    async (): Promise<HealthResponse> => ({
      status: 'ok',
      service: deps.serviceName,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    }),
  );

  app.get(
    '/ready',
    {
      schema: {
        response: {
          200: readinessResponseSchema,
          503: readinessResponseSchema,
        },
      },
    },
    async (_request, reply): Promise<ReadinessResponse> => {
      const [database, redis] = await Promise.all([
        deps.checkDatabase(),
        deps.checkRedis(),
      ]);

      const isReady =
        database.status === 'up' &&
        database.pgvectorEnabled &&
        redis.status === 'up';

      const payload: ReadinessResponse = {
        status: isReady ? 'ready' : 'degraded',
        service: deps.serviceName,
        timestamp: new Date().toISOString(),
        checks: {
          database,
          redis,
        },
      };

      reply.code(isReady ? 200 : 503);
      return payload;
    },
  );
}
