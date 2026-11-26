import type {
  EmbeddingProvider,
  LLMProvider,
  RerankerService,
} from '@enterprise-ai/ai';
import {
  DocumentStatus,
  FeedbackRating,
  MembershipRole,
  MessageRole,
  type DatabaseClient,
} from '@enterprise-ai/database';
import {
  createRootTraceContext,
  TelemetryTracer,
  type RetrievalService,
  type RetrievedChunk,
} from '@enterprise-ai/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { RagService } from '../src/modules/rag/rag.service.js';
import { signAccessToken } from '../src/shared/security/tokens.js';

const TEST_JWT_SECRET = 'sprint5-7-unit-test-jwt-secret-min-32-chars';
const ORG_A = '11111111-1111-4111-8111-111111111111';
const USER_A = '33333333-3333-4333-8333-333333333333';
const DOC_1 = '55555555-5555-4555-8555-555555555555';
const CHUNK_1 = '66666666-6666-4666-8666-666666666666';
const CHUNK_2 = '77777777-7777-4777-8777-777777777777';
const MSG_ASSISTANT = '88888888-8888-4888-8888-888888888881';
const MSG_USER = '88888888-8888-4888-8888-888888888882';
const FEEDBACK_1 = '99999999-9999-4999-8999-999999999991';

function makeChunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  const pageNumber = overrides.pageNumber ?? 1;
  const chunkIndex = overrides.chunkIndex ?? 0;
  const tokenCount = overrides.tokenCount ?? 30;
  return {
    chunkId: overrides.chunkId ?? CHUNK_1,
    documentId: overrides.documentId ?? DOC_1,
    filename: overrides.filename ?? 'runbook.pdf',
    pageNumber,
    chunkIndex,
    content: overrides.content ?? 'pgvector HNSW index uses cosine distance.',
    tokenCount,
    metadata: overrides.metadata ?? {
      pageNumber,
      chunkIndex,
      tokenCount,
    },
    distance: overrides.distance ?? 0.1,
    similarity: overrides.similarity ?? 0.9,
    matchedBy: overrides.matchedBy ?? ['semantic', 'lexical'],
    rrfScore: overrides.rrfScore ?? 0.032,
  };
}

function makeFakeEmbeddingProvider(): EmbeddingProvider {
  return {
    providerName: 'openai',
    model: 'text-embedding-3-small',
    dimensions: 1536,
    embedQuery: vi.fn().mockResolvedValue({
      embedding: new Array<number>(1536).fill(0.01),
      model: 'text-embedding-3-small',
      dimensions: 1536,
      usage: { inputTokens: 10, totalTokens: 10 },
      latencyMs: 12,
    }),
    embedDocuments: vi.fn(),
  };
}

function makeFakeLLMProvider(): LLMProvider {
  return {
    providerName: 'openai',
    model: 'gpt-4o-mini',
    generate: vi.fn().mockResolvedValue({
      content: JSON.stringify({
        answer: 'pgvector HNSW index uses cosine distance.',
        insufficientContext: false,
        citedChunkIds: [CHUNK_2],
      }),
      model: 'gpt-4o-mini',
      finishReason: 'stop',
      usage: { inputTokens: 150, outputTokens: 20, totalTokens: 170 },
      latencyMs: 75,
    }),
  };
}

async function signTestToken(userId = USER_A, email = 'a@example.com') {
  return signAccessToken(
    { sub: userId, email },
    { secret: TEST_JWT_SECRET, expiresIn: '15m' },
  );
}

describe('Sprint 5-7 API routing, observability, hybrid RAG, feedback & analytics', () => {
  const openApps: FastifyInstance[] = [];

  afterEach(async () => {
    while (openApps.length > 0) {
      const instance = openApps.pop();
      if (instance) {
        await instance.close();
      }
    }
  });

  function makeMockDatabase() {
    const now = new Date('2026-11-19T12:00:00.000Z');
    const day1 = new Date('2026-11-18T10:00:00.000Z');
    const day2 = new Date('2026-11-19T10:00:00.000Z');

    const usageSamples = [
      {
        model: 'gpt-4o-mini',
        operation: 'rag_query',
        inputTokens: 100,
        outputTokens: 20,
        latencyMs: 100,
        estimatedCost: '0.00002700',
        createdAt: day1,
      },
      {
        model: 'gpt-4o-mini',
        operation: 'rag_query',
        inputTokens: 200,
        outputTokens: 40,
        latencyMs: 200,
        estimatedCost: '0.00005400',
        createdAt: day2,
      },
      {
        model: 'text-embedding-3-small',
        operation: 'rag_retrieval_empty',
        inputTokens: 10,
        outputTokens: 0,
        latencyMs: 50,
        estimatedCost: '0.00000020',
        createdAt: day2,
      },
    ];

    const db = {
      membership: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'mem-1',
          organizationId: ORG_A,
          userId: USER_A,
          role: MembershipRole.MEMBER,
          createdAt: now,
          updatedAt: now,
        }),
      },
      conversation: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(4),
      },
      document: {
        groupBy: vi.fn().mockResolvedValue([
          { status: DocumentStatus.COMPLETED, _count: { _all: 3 } },
          { status: DocumentStatus.FAILED, _count: { _all: 1 } },
        ]),
      },
      documentChunk: {
        count: vi.fn().mockResolvedValue(42),
      },
      message: {
        findFirst: vi.fn().mockImplementation(({ where }) => {
          if (where.id === MSG_ASSISTANT) {
            return Promise.resolve({
              id: MSG_ASSISTANT,
              role: MessageRole.ASSISTANT,
            });
          }
          if (where.id === MSG_USER) {
            return Promise.resolve({
              id: MSG_USER,
              role: MessageRole.USER,
            });
          }
          return Promise.resolve(null);
        }),
        count: vi.fn().mockImplementation(({ where }) => {
          if (where?.insufficientContext === true) {
            return Promise.resolve(1);
          }
          if (where?.role === MessageRole.ASSISTANT) {
            return Promise.resolve(5);
          }
          return Promise.resolve(10);
        }),
      },
      messageCitation: {
        count: vi.fn().mockResolvedValue(8),
      },
      messageFeedback: {
        upsert: vi.fn().mockImplementation(({ create }) =>
          Promise.resolve({
            id: FEEDBACK_1,
            messageId: create.messageId,
            userId: create.userId,
            rating: create.rating,
            comment: create.comment,
            createdAt: now,
            updatedAt: now,
          }),
        ),
        groupBy: vi.fn().mockResolvedValue([
          { rating: FeedbackRating.UP, _count: { _all: 3 } },
          { rating: FeedbackRating.DOWN, _count: { _all: 1 } },
        ]),
        count: vi.fn().mockImplementation(({ where }) => {
          if (where?.rating === FeedbackRating.UP) {
            return Promise.resolve(3);
          }
          if (where?.rating === FeedbackRating.DOWN) {
            return Promise.resolve(1);
          }
          return Promise.resolve(0);
        }),
      },
      usageEvent: {
        findMany: vi.fn().mockResolvedValue(usageSamples),
      },
    } as unknown as DatabaseClient;

    return { db };
  }

  async function buildTestApp(overrides: {
    db?: DatabaseClient;
    enableRateLimit?: boolean;
    rateLimitMax?: number;
    corsOrigin?: string;
    embeddingProvider?: EmbeddingProvider;
    llmProvider?: LLMProvider;
    tracer?: TelemetryTracer;
  } = {}) {
    const app = buildApp({
      nodeEnv: 'test',
      database: overrides.db ?? makeMockDatabase().db,
      authConfig: {
        jwtSecret: TEST_JWT_SECRET,
        accessTokenExpiresIn: '15m',
        refreshTokenExpiresDays: 7,
      },
      embeddingProvider: overrides.embeddingProvider,
      llmProvider: overrides.llmProvider,
      tracer: overrides.tracer,
      enableRateLimit: overrides.enableRateLimit,
      rateLimitMax: overrides.rateLimitMax,
      corsOrigin: overrides.corsOrigin,
      checkDatabase: async () => ({
        status: 'up',
        pgvectorEnabled: true,
        latencyMs: 1,
      }),
      checkRedis: async () => ({ status: 'up', latencyMs: 1 }),
    });
    openApps.push(app);
    await app.ready();
    return app;
  }

  describe('404 fixes, discovery, request IDs, CORS & rate limiting', () => {
    it('serves GET / and GET /api/v1 discovery routes and supports trailing slashes', async () => {
      const app = await buildTestApp();
      const token = await signTestToken();

      const rootRes = await app.inject({ method: 'GET', url: '/' });
      expect(rootRes.statusCode).toBe(200);
      expect(rootRes.json()).toMatchObject({
        status: 'ok',
        apiPrefix: '/api/v1',
        endpoints: {
          auth: '/api/v1/auth',
          conversations: '/api/v1/conversations',
          feedback: '/api/v1/messages/:id/feedback',
          dashboard: '/api/v1/dashboard/overview',
          analytics: '/api/v1/analytics',
        },
      });

      const v1Res = await app.inject({ method: 'GET', url: '/api/v1' });
      expect(v1Res.statusCode).toBe(200);
      expect(v1Res.json().apiPrefix).toBe('/api/v1');
      expect(v1Res.json().rag).toEqual({
        defaultStrategy: 'lexical',
        embeddingsEnabled: false,
        llmConfigured: false,
        llmProvider: null,
        llmModel: null,
        embeddingProvider: null,
      });

      const llmOnlyApp = await buildTestApp({
        llmProvider: {
          ...makeFakeLLMProvider(),
          providerName: 'groq',
          model: 'qwen/qwen3.8-27b',
        },
      });
      const llmOnlyDiscovery = await llmOnlyApp.inject({
        method: 'GET',
        url: '/api/v1',
      });
      expect(llmOnlyDiscovery.statusCode).toBe(200);
      expect(llmOnlyDiscovery.json().rag).toEqual({
        defaultStrategy: 'lexical',
        embeddingsEnabled: false,
        llmConfigured: true,
        llmProvider: 'groq',
        llmModel: 'qwen/qwen3.8-27b',
        embeddingProvider: null,
      });

      const hybridApp = await buildTestApp({
        embeddingProvider: makeFakeEmbeddingProvider(),
        llmProvider: makeFakeLLMProvider(),
      });
      const hybridDiscovery = await hybridApp.inject({
        method: 'GET',
        url: '/api/v1',
      });
      expect(hybridDiscovery.statusCode).toBe(200);
      expect(hybridDiscovery.json().rag).toEqual({
        defaultStrategy: 'hybrid',
        embeddingsEnabled: true,
        llmConfigured: true,
        llmProvider: 'openai',
        llmModel: 'gpt-4o-mini',
        embeddingProvider: 'openai',
      });

      const healthSlashRes = await app.inject({
        method: 'GET',
        url: '/api/v1/health/',
      });
      expect(healthSlashRes.statusCode).toBe(200);

      // Trailing slash on /api/v1/conversations/ must hit list route (200), not /:id UUID validation.
      const convSlashRes = await app.inject({
        method: 'GET',
        url: '/api/v1/conversations/',
        headers: {
          authorization: `Bearer ${token}`,
          'x-organization-id': ORG_A,
        },
      });
      expect(convSlashRes.statusCode).toBe(200);
      expect(convSlashRes.json().conversations).toEqual([]);
    });

    it('returns helpful structured 404 JSON and echoes/generates x-request-id', async () => {
      const app = await buildTestApp();

      const notFoundRes = await app.inject({
        method: 'POST',
        url: '/auth/register',
        headers: { 'x-request-id': 'req-trace-123' },
      });
      expect(notFoundRes.statusCode).toBe(404);
      expect(notFoundRes.headers['x-request-id']).toBe('req-trace-123');
      expect(notFoundRes.json()).toMatchObject({
        error: 'NOT_FOUND',
        method: 'POST',
        path: '/auth/register',
      });
      expect(notFoundRes.json().hint).toContain('/api/v1');

      const autoReqIdRes = await app.inject({ method: 'GET', url: '/' });
      expect(autoReqIdRes.headers['x-request-id']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(autoReqIdRes.headers['x-trace-id']).toMatch(/^[0-9a-f]{32}$/);
      expect(autoReqIdRes.headers['traceparent']).toMatch(
        /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/,
      );
    });

    it('propagates incoming W3C traceparent and records OpenTelemetry-compatible RAG spans', async () => {
      const tracer = new TelemetryTracer('api-test');
      const app = await buildTestApp({ tracer });
      const incomingTraceId = '4bf92f3577b34da6a3ce929d0e0e4736';
      const incomingParentSpan = '00f067aa0ba902b7';

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1',
        headers: {
          traceparent: `00-${incomingTraceId}-${incomingParentSpan}-01`,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['x-trace-id']).toBe(incomingTraceId);
      const httpSpan = tracer
        .getRecordedSpans()
        .find((s) => s.name === 'http.request');
      expect(httpSpan).toBeDefined();
      expect(httpSpan?.traceId).toBe(incomingTraceId);
      expect(httpSpan?.parentSpanId).toBe(incomingParentSpan);
      expect(httpSpan?.attributes['http.status_code']).toBe(200);

      const ragTracer = new TelemetryTracer('rag-test');
      const ragService = new RagService({
        retrievalService: {
          retrieve: vi.fn().mockResolvedValue([makeChunk({ chunkId: CHUNK_2 })]),
        },
        llmProvider: makeFakeLLMProvider(),
        reranker: { rerank: vi.fn().mockResolvedValue([makeChunk({ chunkId: CHUNK_2 })]) },
        defaultStrategy: 'lexical',
        tracer: ragTracer,
      });

      await ragService.answerQuestion({
        organizationId: ORG_A,
        question: 'Explain HNSW index',
        traceContext: createRootTraceContext(
          `00-${incomingTraceId}-${incomingParentSpan}-01`,
        ),
      });

      const spanNames = ragTracer.getRecordedSpans().map((s) => s.name);
      expect(spanNames).toEqual(
        expect.arrayContaining([
          'rag.retrieval',
          'rag.rerank',
          'rag.generation',
          'rag.answer_question',
        ]),
      );
      expect(
        ragTracer
          .getRecordedSpans()
          .every((s) => s.traceId === incomingTraceId),
      ).toBe(true);
    });

    it('sets CORS headers and enforces rate limits when enabled', async () => {
      const app = await buildTestApp({
        corsOrigin: 'http://localhost:3000',
        enableRateLimit: true,
        rateLimitMax: 2,
      });

      const preflight = await app.inject({
        method: 'OPTIONS',
        url: '/api/v1/health',
        headers: {
          origin: 'http://localhost:3000',
          'access-control-request-method': 'GET',
          'access-control-request-headers': 'authorization,x-organization-id',
        },
      });
      expect(preflight.statusCode).toBe(204);
      expect(preflight.headers['access-control-allow-origin']).toBe(
        'http://localhost:3000',
      );
      expect(preflight.headers['access-control-allow-credentials']).toBe('true');

      const r1 = await app.inject({ method: 'GET', url: '/health' });
      const r2 = await app.inject({ method: 'GET', url: '/health' });
      const r3 = await app.inject({ method: 'GET', url: '/health' });
      expect(r1.statusCode).toBe(200);
      expect(r2.statusCode).toBe(200);
      expect(r3.statusCode).toBe(429);
      expect(r3.json()).toMatchObject({ error: 'RATE_LIMIT_EXCEEDED' });
    });
  });

  describe('RagService hybrid retrieval, reranking & stage latencies', () => {
    it('passes queryText + hybrid strategy, invokes reranker, and records stageLatencies', async () => {
      const embeddingProvider = makeFakeEmbeddingProvider();
      const chunk1 = makeChunk({ chunkId: CHUNK_1, similarity: 0.9 });
      const chunk2 = makeChunk({ chunkId: CHUNK_2, similarity: 0.85 });
      const retrievalService: RetrievalService = {
        retrieve: vi.fn().mockResolvedValue([chunk1, chunk2]),
      };
      const reranker: RerankerService = {
        rerank: vi.fn().mockResolvedValue([chunk2]),
      };
      const llmProvider = makeFakeLLMProvider();
      const logger = { info: vi.fn() };

      const ragService = new RagService({
        embeddingProvider,
        retrievalService,
        llmProvider,
        reranker,
        logger,
      });

      const result = await ragService.answerQuestion({
        organizationId: ORG_A,
        question: 'How does pgvector HNSW work?',
        strategy: 'hybrid',
        topK: 4,
      });

      expect(embeddingProvider.embedQuery).toHaveBeenCalledTimes(1);
      expect(retrievalService.retrieve).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORG_A,
          queryText: 'How does pgvector HNSW work?',
          strategy: 'hybrid',
          topK: 12,
        }),
      );
      expect(reranker.rerank).toHaveBeenCalledWith(
        'How does pgvector HNSW work?',
        [chunk1, chunk2],
        4,
      );
      expect(result.citations.map((c) => c.chunkId)).toEqual([CHUNK_2]);
      expect(result.usage?.stageLatencies).toEqual({
        embeddingMs: expect.any(Number),
        retrievalMs: expect.any(Number),
        rerankMs: expect.any(Number),
        generationMs: expect.any(Number),
      });
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORG_A,
          strategy: 'hybrid',
          retrievedCount: 2,
          finalChunkCount: 1,
        }),
        'Completed RAG pipeline stages',
      );
    });

    it('skips embeddingProvider.embedQuery when strategy is lexical', async () => {
      const embeddingProvider = makeFakeEmbeddingProvider();
      const chunk2 = makeChunk({ chunkId: CHUNK_2, matchedBy: ['lexical'] });
      const retrievalService: RetrievalService = {
        retrieve: vi.fn().mockResolvedValue([chunk2]),
      };
      const llmProvider = makeFakeLLMProvider();

      const ragService = new RagService({
        embeddingProvider,
        retrievalService,
        llmProvider,
      });

      const result = await ragService.answerQuestion({
        organizationId: ORG_A,
        question: 'Exact error code ERR_HNSW',
        strategy: 'lexical',
      });

      expect(embeddingProvider.embedQuery).not.toHaveBeenCalled();
      expect(retrievalService.retrieve).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORG_A,
          queryEmbedding: undefined,
          queryText: 'Exact error code ERR_HNSW',
          strategy: 'lexical',
        }),
      );
      expect(result.usage?.embeddingModel).toBe('none');
      expect(result.usage?.stageLatencies?.embeddingMs).toBe(0);
    });
  });

  describe('Feedback & Analytics endpoints', () => {
    it('submits feedback for owned assistant messages and rejects user messages or missing targets', async () => {
      const app = await buildTestApp();
      const token = await signTestToken();

      const okRes = await app.inject({
        method: 'POST',
        url: `/api/v1/messages/${MSG_ASSISTANT}/feedback`,
        headers: {
          authorization: `Bearer ${token}`,
          'x-organization-id': ORG_A,
        },
        payload: { rating: 'UP', comment: 'Accurate citation!' },
      });
      expect(okRes.statusCode).toBe(200);
      expect(okRes.json().feedback).toMatchObject({
        id: FEEDBACK_1,
        messageId: MSG_ASSISTANT,
        userId: USER_A,
        rating: 'UP',
        comment: 'Accurate citation!',
      });

      const userMsgRes = await app.inject({
        method: 'POST',
        url: `/api/v1/messages/${MSG_USER}/feedback`,
        headers: {
          authorization: `Bearer ${token}`,
          'x-organization-id': ORG_A,
        },
        payload: { rating: 'DOWN' },
      });
      expect(userMsgRes.statusCode).toBe(400);
      expect(userMsgRes.json()).toMatchObject({
        error: 'INVALID_FEEDBACK_TARGET',
      });

      const missingRes = await app.inject({
        method: 'POST',
        url: '/api/v1/messages/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/feedback',
        headers: {
          authorization: `Bearer ${token}`,
          'x-organization-id': ORG_A,
        },
        payload: { rating: 'DOWN' },
      });
      expect(missingRes.statusCode).toBe(404);
    });

    it('returns organization-scoped dashboard overview and usage/performance/quality analytics', async () => {
      const app = await buildTestApp();
      const token = await signTestToken();
      const headers = {
        authorization: `Bearer ${token}`,
        'x-organization-id': ORG_A,
      };

      const overviewRes = await app.inject({
        method: 'GET',
        url: '/api/v1/dashboard/overview',
        headers,
      });
      expect(overviewRes.statusCode).toBe(200);
      expect(overviewRes.json().overview).toEqual({
        organizationId: ORG_A,
        documents: {
          total: 4,
          completed: 3,
          pending: 0,
          processing: 0,
          failed: 1,
          totalChunks: 42,
        },
        conversations: {
          total: 4,
          totalMessages: 10,
        },
        usage: {
          totalEvents: 3,
          totalInputTokens: 310,
          totalOutputTokens: 60,
          totalTokens: 370,
          estimatedCostUsd: 0.0000812,
        },
        performance: {
          avgLatencyMs: 116.67,
          p95LatencyMs: 190,
        },
        quality: {
          totalAssistantMessages: 5,
          insufficientContextCount: 1,
          insufficientContextRate: 0.2,
          totalFeedback: 4,
          positiveFeedback: 3,
          negativeFeedback: 1,
          positiveFeedbackRate: 0.75,
        },
      });

      const usageRes = await app.inject({
        method: 'GET',
        url: '/api/v1/analytics/usage?days=14',
        headers,
      });
      expect(usageRes.statusCode).toBe(200);
      expect(usageRes.json().usage).toMatchObject({
        organizationId: ORG_A,
        periodDays: 14,
        totals: {
          events: 3,
          inputTokens: 310,
          outputTokens: 60,
          totalTokens: 370,
          estimatedCostUsd: 0.0000812,
        },
      });
      expect(usageRes.json().usage.byModel).toHaveLength(2);
      expect(usageRes.json().usage.daily.map((d: { date: string }) => d.date)).toEqual([
        '2026-11-18',
        '2026-11-19',
      ]);

      const perfRes = await app.inject({
        method: 'GET',
        url: '/api/v1/analytics/performance?days=30',
        headers,
      });
      expect(perfRes.statusCode).toBe(200);
      expect(perfRes.json().performance).toMatchObject({
        organizationId: ORG_A,
        periodDays: 30,
        totalEvents: 3,
        avgLatencyMs: 116.67,
        p50LatencyMs: 100,
        p95LatencyMs: 190,
        maxLatencyMs: 200,
      });
      expect(perfRes.json().performance.byOperation).toHaveLength(2);

      const qualityRes = await app.inject({
        method: 'GET',
        url: '/api/v1/analytics/quality?days=30',
        headers,
      });
      expect(qualityRes.statusCode).toBe(200);
      expect(qualityRes.json().quality).toEqual({
        organizationId: ORG_A,
        periodDays: 30,
        totalAssistantMessages: 5,
        groundedAnswerCount: 4,
        insufficientContextCount: 1,
        insufficientContextRate: 0.2,
        totalCitations: 8,
        avgCitationsPerGroundedAnswer: 2,
        feedback: {
          total: 4,
          up: 3,
          down: 1,
          positiveRate: 0.75,
        },
      });

      const invalidDaysRes = await app.inject({
        method: 'GET',
        url: '/api/v1/analytics/usage?days=365',
        headers,
      });
      expect(invalidDaysRes.statusCode).toBe(400);
    });
  });

  describe('Split LLM-only (Groq) mode without embeddingProvider', () => {
    it('succeeds in default lexical mode with llmProvider alone and returns 503 if hybrid is requested without embeddingProvider', async () => {
      const now = new Date('2026-11-19T12:00:00.000Z');
      const convId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const persistedMessages: unknown[] = [];

      const tx = {
        conversation: {
          findFirst: vi.fn().mockResolvedValue({ id: convId, title: null }),
          update: vi.fn().mockResolvedValue({ id: convId }),
        },
        message: {
          create: vi.fn().mockImplementation(({ data }) => {
            const msg = {
              id:
                data.role === MessageRole.USER
                  ? MSG_USER
                  : MSG_ASSISTANT,
              conversationId: convId,
              role: data.role,
              content: data.content,
              insufficientContext: data.insufficientContext ?? false,
              tokenUsage: data.tokenUsage ?? null,
              createdAt: now,
            };
            persistedMessages.push(msg);
            return Promise.resolve(msg);
          }),
        },
        messageCitation: {
          createMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        usageEvent: {
          create: vi.fn().mockResolvedValue({}),
        },
      };

      const db = {
        membership: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'mem-1',
            organizationId: ORG_A,
            userId: USER_A,
            role: MembershipRole.MEMBER,
            createdAt: now,
            updatedAt: now,
          }),
        },
        conversation: {
          findFirst: vi.fn().mockResolvedValue({ id: convId }),
        },
        message: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        $transaction: vi.fn().mockImplementation((fn) => fn(tx)),
      } as unknown as DatabaseClient;

      const chunk = makeChunk({ chunkId: CHUNK_2, matchedBy: ['lexical'] });
      const retrievalService: RetrievalService = {
        retrieve: vi.fn().mockResolvedValue([chunk]),
      };
      const llmProvider = makeFakeLLMProvider();

      const app = buildApp({
        nodeEnv: 'test',
        database: db,
        authConfig: {
          jwtSecret: TEST_JWT_SECRET,
          accessTokenExpiresIn: '15m',
          refreshTokenExpiresDays: 7,
        },
        retrievalService,
        llmProvider,
        checkDatabase: async () => ({
          status: 'up',
          pgvectorEnabled: true,
          latencyMs: 1,
        }),
        checkRedis: async () => ({ status: 'up', latencyMs: 1 }),
      });
      openApps.push(app);
      await app.ready();

      const token = await signTestToken();
      const headers = {
        authorization: `Bearer ${token}`,
        'x-organization-id': ORG_A,
      };

      // Default strategy falls back to 'lexical' when no embeddingProvider is configured.
      const lexicalRes = await app.inject({
        method: 'POST',
        url: `/api/v1/conversations/${convId}/messages`,
        headers,
        payload: { content: 'pgvector HNSW cosine' },
      });
      expect(lexicalRes.statusCode).toBe(201);
      expect(retrievalService.retrieve).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORG_A,
          queryEmbedding: undefined,
          queryText: 'pgvector HNSW cosine',
          strategy: 'lexical',
        }),
      );
      expect(lexicalRes.json().citations).toHaveLength(1);
      expect(persistedMessages).toHaveLength(2);

      // Explicit hybrid request without an embeddingProvider fails cleanly with 503.
      const hybridRes = await app.inject({
        method: 'POST',
        url: `/api/v1/conversations/${convId}/messages`,
        headers,
        payload: { content: 'pgvector HNSW cosine', strategy: 'hybrid' },
      });
      expect(hybridRes.statusCode).toBe(503);
      expect(hybridRes.json()).toMatchObject({
        error: 'AI_PROVIDER_NOT_CONFIGURED',
      });
      expect(persistedMessages).toHaveLength(2);
    });
  });
});
