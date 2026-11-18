import type { DatabaseClient } from '@enterprise-ai/database';
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
import { createAuthenticateHook } from './middleware/authenticate.js';
import { AuthController } from './modules/auth/auth.controller.js';
import { AuthRepository } from './modules/auth/auth.repository.js';
import { registerAuthRoutes } from './modules/auth/auth.routes.js';
import {
  AuthService,
  type AuthServiceConfig,
} from './modules/auth/auth.service.js';
import { registerHealthRoutes } from './modules/health/health.routes.js';
import { OrganizationsController } from './modules/organizations/organizations.controller.js';
import { OrganizationsRepository } from './modules/organizations/organizations.repository.js';
import { registerOrganizationRoutes } from './modules/organizations/organizations.routes.js';
import { OrganizationsService } from './modules/organizations/organizations.service.js';
import { AppError } from './shared/errors/app-error.js';

export interface BuildAppOptions {
  nodeEnv?: 'development' | 'test' | 'production';
  logLevel?: LevelWithSilent;
  database?: DatabaseClient;
  authConfig?: AuthServiceConfig;
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
  app.decorateRequest('auth', null);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: error.code,
        message: error.message,
      });
    }

    const statusCode =
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof error.statusCode === 'number'
        ? error.statusCode
        : 500;

    if (statusCode >= 500) {
      request.log.error({ err: error }, 'Unhandled request error');
      return reply.code(statusCode).send({
        error: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred.',
      });
    }

    return reply.code(statusCode).send({
      error: 'VALIDATION_ERROR',
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

  if (options.database && options.authConfig) {
    const database = options.database;
    const authConfig = options.authConfig;
    const authenticate = createAuthenticateHook(authConfig.jwtSecret);

    const authRepository = new AuthRepository(database);
    const authService = new AuthService(authRepository, authConfig);
    const authController = new AuthController(
      authService,
      authConfig.jwtSecret,
    );

    const organizationsRepository = new OrganizationsRepository(database);
    const organizationsService = new OrganizationsService(
      organizationsRepository,
    );
    const organizationsController = new OrganizationsController(
      organizationsService,
    );

    app.register(
      async (instance) => {
        await registerAuthRoutes(instance, {
          controller: authController,
          authenticate,
        });
        await registerOrganizationRoutes(instance, {
          controller: organizationsController,
          authenticate,
        });
      },
      { prefix: API_PREFIX },
    );
  }

  return app;
}
