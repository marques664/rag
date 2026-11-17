import { API_PREFIX } from '@enterprise-ai/shared';
import type {
  DatabaseCheckResult,
  DependencyCheckResult,
} from '@enterprise-ai/shared';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from '@fastify/type-provider-zod';
import Fastify, { type FastifyInstance } from 'fastify';
import type { LevelWithSilent } from 'pino';
import { registerHealthRoutes } from './modules/health/health.routes.js';

export interface BuildAppOptions {
  nodeEnv?: 'development' | 'test' | 'production';
  logLevel?: LevelWithSilent;
  checkDatabase: () => Promise<DatabaseCheckResult>;
  checkRedis: () => Promise<DependencyCheckResult>;
}

/**
 * Builds and configures the Fastify application instance without binding a network port.
 */
export function buildApp(options: BuildAppOptions): FastifyInstance {
  const nodeEnv = options.nodeEnv ?? 'development';
  const logLevel = options.logLevel ?? (nodeEnv === 'test' ? 'silent' : 'info');

  const app = Fastify({
    logger:
      nodeEnv === 'development'
        ? {
            level: logLevel,
            transport: {
              target: 'pino-pretty',
              options: {
                colorize: true,
                translateTime: 'SYS:standard',
                ignore: 'pid,hostname',
              },
            },
          }
        : {
            level: logLevel,
          },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'Unhandled request error');

    const statusCode =
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof error.statusCode === 'number'
        ? error.statusCode
        : 500;

    if (statusCode >= 500) {
      return reply.code(statusCode).send({
        error: 'Internal Server Error',
        message: 'An unexpected error occurred.',
      });
    }

    return reply.code(statusCode).send({
      error: error instanceof Error ? error.name : 'RequestError',
      message: error instanceof Error ? error.message : 'Request failed',
    });
  });

  const healthDeps = {
    serviceName: 'enterprise-knowledge-ai-api',
    checkDatabase: options.checkDatabase,
    checkRedis: options.checkRedis,
  };

  // Expose health endpoints both at root (for infrastructure probes) and under /api/v1.
  app.register(async (instance) => registerHealthRoutes(instance, healthDeps));
  app.register(async (instance) => registerHealthRoutes(instance, healthDeps), {
    prefix: API_PREFIX,
  });

  return app;
}
