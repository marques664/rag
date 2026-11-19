import { randomUUID } from 'node:crypto';
import {
  HybridLexicalReranker,
  type EmbeddingProvider,
  type LLMProvider,
  type RerankerService,
} from '@enterprise-ai/ai';
import {
  HybridRetrievalService,
  MembershipRole,
  type DatabaseClient,
} from '@enterprise-ai/database';
import {
  API_PREFIX,
  APP_NAME,
  formatTraceparent,
  MAX_DOCUMENT_FILE_SIZE_BYTES,
  parseTraceparent,
  TelemetryTracer,
  type DatabaseCheckResult,
  type DependencyCheckResult,
  type RetrievalService,
  type RetrievalStrategy,
} from '@enterprise-ai/shared';
import fastifyCors from '@fastify/cors';
import fastifyMultipart from '@fastify/multipart';
import fastifyRateLimit from '@fastify/rate-limit';
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
import { AnalyticsController } from './modules/analytics/analytics.controller.js';
import { AnalyticsRepository } from './modules/analytics/analytics.repository.js';
import { registerAnalyticsRoutes } from './modules/analytics/analytics.routes.js';
import { AnalyticsService } from './modules/analytics/analytics.service.js';
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
import { FeedbackController } from './modules/feedback/feedback.controller.js';
import { FeedbackRepository } from './modules/feedback/feedback.repository.js';
import { registerFeedbackRoutes } from './modules/feedback/feedback.routes.js';
import { FeedbackService } from './modules/feedback/feedback.service.js';
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
  reranker?: RerankerService;
  ragRetrievalStrategy?: RetrievalStrategy;
  ragDefaultTopK?: number;
  ragMaxContextChars?: number;
  corsOrigin?: string;
  enableRateLimit?: boolean;
  rateLimitMax?: number;
  rateLimitWindowMs?: number;
  tracer?: TelemetryTracer;
  checkDatabase: () => Promise<DatabaseCheckResult>;
  checkRedis: () => Promise<DependencyCheckResult>;
}

export interface DiscoveryRagCapabilities {
  defaultStrategy: RetrievalStrategy;
  embeddingsEnabled: boolean;
  llmConfigured: boolean;
  llmProvider: string | null;
  llmModel: string | null;
  embeddingProvider: string | null;
}

function buildDiscoveryPayload(rag: DiscoveryRagCapabilities) {
  return {
    name: APP_NAME,
    status: 'ok' as const,
    apiPrefix: API_PREFIX,
    endpoints: {
      health: '/health',
      ready: '/ready',
      auth: `${API_PREFIX}/auth`,
      organizations: `${API_PREFIX}/organizations`,
      documents: `${API_PREFIX}/documents`,
      conversations: `${API_PREFIX}/conversations`,
      feedback: `${API_PREFIX}/messages/:id/feedback`,
      dashboard: `${API_PREFIX}/dashboard/overview`,
      analytics: `${API_PREFIX}/analytics`,
    },
    rag,
  };
}

/**
 * Builds and configures the Fastify application instance without binding a network port.
 */
export function buildApp(options: BuildAppOptions): FastifyInstance {
  const nodeEnv = options.nodeEnv ?? 'development';
  const logLevel = options.logLevel ?? (nodeEnv === 'test' ? 'silent' : 'info');

  const app = Fastify({
    routerOptions: {
      ignoreTrailingSlash: true,
    },
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
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
  const tracer =
    options.tracer ??
    new TelemetryTracer('enterprise-knowledge-ai-api', {
      otlpEndpoint: process.env['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT'],
    });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest('auth', null);
  app.decorateRequest('organizationContext', null);
  app.decorateRequest('traceContext', null);
  app.decorateRequest('requestSpan', null);

  app.addHook('onRequest', async (request) => {
    const incomingTraceparent = request.headers['traceparent'];
    const parentHeader = Array.isArray(incomingTraceparent)
      ? incomingTraceparent[0]
      : incomingTraceparent;
    const incomingContext = parseTraceparent(parentHeader);
    const requestSpan = tracer.startSpan('http.request', incomingContext, {
      'http.method': request.method,
      'http.url': request.url,
      'request.id': request.id,
    });
    request.requestSpan = requestSpan;
    request.traceContext = requestSpan.context;
  });

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-request-id', request.id);
    if (request.traceContext) {
      reply.header('x-trace-id', request.traceContext.traceId);
      reply.header('traceparent', formatTraceparent(request.traceContext));
    }
    const span = request.requestSpan;
    if (span) {
      span.setAttributes({
        'http.status_code': reply.statusCode,
        'http.route': request.routeOptions.url ?? request.url,
        'tenant.id': request.organizationContext?.organizationId,
      });
      if (reply.statusCode >= 500) {
        span.setStatus('ERROR', `HTTP ${reply.statusCode}`);
      } else {
        span.setStatus('OK');
      }
      span.end();
      request.requestSpan = null;
    }
    return payload;
  });

  const corsOrigins = (options.corsOrigin ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  app.register(fastifyCors, {
    origin: corsOrigins.includes('*') ? true : corsOrigins,
    credentials: true,
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'x-organization-id',
      'x-request-id',
      'x-trace-id',
      'traceparent',
    ],
    exposedHeaders: ['x-request-id', 'x-trace-id', 'traceparent'],
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  const enableRateLimit = options.enableRateLimit ?? nodeEnv !== 'test';
  if (enableRateLimit) {
    app.register(fastifyRateLimit, {
      max: options.rateLimitMax ?? 120,
      timeWindow: options.rateLimitWindowMs ?? 60_000,
      errorResponseBuilder: (_request, context) => ({
        statusCode: 429,
        error: 'RATE_LIMIT_EXCEEDED',
        message: `Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
      }),
    });
  }

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

    if (statusCode === 429) {
      return reply.code(429).send({
        error: 'RATE_LIMIT_EXCEEDED',
        message:
          error instanceof Error ? error.message : 'Rate limit exceeded',
      });
    }

    return reply.code(statusCode).send({
      error: 'VALIDATION_ERROR',
      message: error instanceof Error ? error.message : 'Request failed',
    });
  });

  app.setNotFoundHandler((request, reply) => {
    return reply.code(404).send({
      error: 'NOT_FOUND',
      message: `Route ${request.method}:${request.url} not found`,
      method: request.method,
      path: request.url,
      hint: `API endpoints are mounted under ${API_PREFIX} (see GET / or GET ${API_PREFIX})`,
    });
  });

  const defaultRagStrategy: RetrievalStrategy = options.embeddingProvider
    ? (options.ragRetrievalStrategy ?? 'hybrid')
    : 'lexical';

  const discoveryPayload = buildDiscoveryPayload({
    defaultStrategy: defaultRagStrategy,
    embeddingsEnabled: Boolean(options.embeddingProvider),
    llmConfigured: Boolean(options.llmProvider),
    llmProvider: options.llmProvider?.providerName ?? null,
    llmModel: options.llmProvider?.model ?? null,
    embeddingProvider: options.embeddingProvider?.providerName ?? null,
  });

  app.get('/', async () => discoveryPayload);
  app.get(API_PREFIX, async () => discoveryPayload);

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

    const ragService = options.llmProvider
      ? new RagService({
          embeddingProvider: options.embeddingProvider,
          retrievalService:
            options.retrievalService ??
            new HybridRetrievalService(database, {
              defaultStrategy: defaultRagStrategy,
              defaultTopK: options.ragDefaultTopK,
            }),
          llmProvider: options.llmProvider,
          reranker: options.reranker ?? new HybridLexicalReranker(),
          defaultStrategy: defaultRagStrategy,
          defaultTopK: options.ragDefaultTopK,
          maxContextChars: options.ragMaxContextChars,
          logger: app.log,
          tracer,
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

    const feedbackRepository = new FeedbackRepository(database);
    const feedbackService = new FeedbackService(feedbackRepository);
    const feedbackController = new FeedbackController(feedbackService);

    const analyticsRepository = new AnalyticsRepository(database);
    const analyticsService = new AnalyticsService(analyticsRepository);
    const analyticsController = new AnalyticsController(analyticsService);

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
        await registerFeedbackRoutes(instance, {
          controller: feedbackController,
          authenticate,
          requireMember,
        });
        await registerAnalyticsRoutes(instance, {
          controller: analyticsController,
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
