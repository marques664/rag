import type { EmbeddingProvider, LLMProvider } from '@enterprise-ai/ai';
import {
  MembershipRole,
  PgVectorRetrievalService,
  type DatabaseClient,
} from '@enterprise-ai/database';
import { API_PREFIX, MAX_DOCUMENT_FILE_SIZE_BYTES } from '@enterprise-ai/shared';
import type {
  DatabaseCheckResult,
  DependencyCheckResult,
  RetrievalService,
} from '@enterprise-ai/shared';
import fastifyMultipart from '@fastify/multipart';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from '@fastify/type-provider-zod';
import Fastify, { type FastifyInstance } from 'fastify';
import type { LevelWithSilent } from 'pino';
import type { DocumentQueueService } from './infrastructure/queue.js';
import type { DocumentStorageService } from './infrastructure/storage.js';
import { createAuthenticateHook } from './middleware/authenticate.js';
import { createRequireOrganizationRoleHook } from './middleware/organization-context.js';
import { AuthController } from './modules/auth/auth.controller.js';
import { AuthRepository } from './modules/auth/auth.repository.js';
import { registerAuthRoutes } from './modules/auth/auth.routes.js';
import {
  AuthService,
  type AuthServiceConfig,
} from './modules/auth/auth.service.js';
import { ConversationsController } from './modules/conversations/conversations.controller.js';
import { ConversationsRepository } from './modules/conversations/conversations.repository.js';
import { registerConversationRoutes } from './modules/conversations/conversations.routes.js';
import { ConversationsService } from './modules/conversations/conversations.service.js';
import { DocumentsController } from './modules/documents/documents.controller.js';
import { DocumentsRepository } from './modules/documents/documents.repository.js';
import { registerDocumentRoutes } from './modules/documents/documents.routes.js';
import { DocumentsService } from './modules/documents/documents.service.js';
import { registerHealthRoutes } from './modules/health/health.routes.js';
import { OrganizationsController } from './modules/organizations/organizations.controller.js';
import { OrganizationsRepository } from './modules/organizations/organizations.repository.js';
import { registerOrganizationRoutes } from './modules/organizations/organizations.routes.js';
import { OrganizationsService } from './modules/organizations/organizations.service.js';
import { RagService } from './modules/rag/rag.service.js';
import { AppError } from './shared/errors/app-error.js';

export interface BuildAppOptions {
  nodeEnv?: 'development' | 'test' | 'production';
  logLevel?: LevelWithSilent;
  database?: DatabaseClient;
  authConfig?: AuthServiceConfig;
  documentStorage?: DocumentStorageService;
  documentQueue?: DocumentQueueService;
  maxDocumentFileSizeBytes?: number;
  retrievalService?: RetrievalService;
  embeddingProvider?: EmbeddingProvider;
  llmProvider?: LLMProvider;
  ragDefaultTopK?: number;
  ragMaxContextChars?: number;
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

  const maxDocumentFileSizeBytes =
    options.maxDocumentFileSizeBytes ?? MAX_DOCUMENT_FILE_SIZE_BYTES;

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest('auth', null);
  app.decorateRequest('organizationContext', null);

  app.register(fastifyMultipart, {
    throwFileSizeLimit: true,
    limits: {
      files: 1,
      fields: 10,
      fileSize: maxDocumentFileSizeBytes,
    },
  });

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

    const requireMember = createRequireOrganizationRoleHook(
      organizationsRepository,
      MembershipRole.MEMBER,
    );
    const requireAdmin = createRequireOrganizationRoleHook(
      organizationsRepository,
      MembershipRole.ADMIN,
    );

    const ragService =
      options.embeddingProvider && options.llmProvider
        ? new RagService({
            embeddingProvider: options.embeddingProvider,
            retrievalService:
              options.retrievalService ??
              new PgVectorRetrievalService(database, {
                defaultTopK: options.ragDefaultTopK,
              }),
            llmProvider: options.llmProvider,
            defaultTopK: options.ragDefaultTopK,
            maxContextChars: options.ragMaxContextChars,
          })
        : undefined;

    const conversationsRepository = new ConversationsRepository(database);
    const conversationsService = new ConversationsService(
      conversationsRepository,
      ragService,
      app.log,
    );
    const conversationsController = new ConversationsController(
      conversationsService,
    );

    const documentDeps =
      options.documentStorage && options.documentQueue
        ? (() => {
            const documentsRepository = new DocumentsRepository(database);
            const documentsService = new DocumentsService(
              documentsRepository,
              options.documentStorage,
              options.documentQueue,
              { maxFileSizeBytes: maxDocumentFileSizeBytes },
              app.log,
            );
            const documentsController = new DocumentsController(
              documentsService,
              maxDocumentFileSizeBytes,
            );

            return {
              controller: documentsController,
              authenticate,
              requireMember,
              requireAdmin,
            };
          })()
        : null;

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
        await registerConversationRoutes(instance, {
          controller: conversationsController,
          authenticate,
          requireMember,
        });
        if (documentDeps) {
          await registerDocumentRoutes(instance, documentDeps);
        }
      },
      { prefix: API_PREFIX },
    );
  }

  return app;
}
