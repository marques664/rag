import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  HybridLexicalReranker,
  type EmbeddingProvider,
  type LLMGenerateRequest,
  type LLMProvider,
} from '@enterprise-ai/ai';
import {
  checkDatabaseHealth,
  createDatabaseClient,
  DocumentStatus,
  FeedbackRating,
  HybridRetrievalService,
  insertDocumentChunksWithEmbeddings,
  MessageRole,
  type DatabaseClient,
} from '@enterprise-ai/database';
import { EMBEDDING_DIMENSIONS } from '@enterprise-ai/shared';
import { config as loadDotenv } from 'dotenv';
import type { FastifyInstance } from 'fastify';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { buildApp } from '../src/app.js';

loadDotenv({ path: path.resolve(import.meta.dirname, '../../../.env') });

const TEST_DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  'postgresql://postgres:postgres@localhost:5432/enterprise_knowledge_ai_test?schema=public';

const TEST_JWT_SECRET =
  'integration-test-jwt-secret-key-minimum-32-characters';

function makeBasisVector(hotIndex = 0): number[] {
  const vec = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  vec[hotIndex] = 1;
  return vec;
}

function makeStubEmbeddingProvider(
  vector: number[] = makeBasisVector(0),
): EmbeddingProvider {
  return {
    providerName: 'openai',
    model: 'text-embedding-3-small',
    dimensions: EMBEDDING_DIMENSIONS,
    embedQuery: vi.fn(async () => ({
      embedding: [...vector],
      model: 'text-embedding-3-small',
      dimensions: EMBEDDING_DIMENSIONS,
      usage: { inputTokens: 12, totalTokens: 12 },
      latencyMs: 8,
    })),
    embedDocuments: vi.fn(),
  };
}

function makeEchoCitingLLMProvider(): LLMProvider {
  return {
    providerName: 'openai',
    model: 'gpt-4o-mini',
    generate: vi.fn(async (request: LLMGenerateRequest) => {
      const userPrompt = request.messages[0]?.content ?? '';
      const idMatches = Array.from(
        userPrompt.matchAll(/chunk_id="([0-9a-f-]{36})"/gi),
      ).map((m) => m[1]!);

      return {
        content: JSON.stringify({
          answer: 'Grounded response based on retrieved chunks.',
          insufficientContext: false,
          citedChunkIds: idMatches.slice(0, 1),
        }),
        model: 'gpt-4o-mini',
        finishReason: 'stop',
        usage: { inputTokens: 320, outputTokens: 35, totalTokens: 355 },
        latencyMs: 65,
      };
    }),
  };
}

describe('Sprints 5-7 API integration (Routing, CORS, Feedback, Analytics, Hybrid & Lexical RAG)', () => {
  let db: DatabaseClient;
  const openApps: FastifyInstance[] = [];

  beforeAll(async () => {
    db = createDatabaseClient(TEST_DATABASE_URL);
    await db.$connect();
  });

  beforeEach(async () => {
    await db.$executeRawUnsafe(
      'TRUNCATE TABLE "message_feedback", "usage_events", "message_citations", "messages", "conversations", "document_chunks", "processing_jobs", "documents", "organization_invitations", "refresh_tokens", "memberships", "organizations", "users" RESTART IDENTITY CASCADE;',
    );
  });

  afterEach(async () => {
    while (openApps.length > 0) {
      const instance = openApps.pop();
      if (instance) {
        await instance.close();
      }
    }
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  function createTestApp(params: {
    embeddingProvider?: EmbeddingProvider;
    llmProvider?: LLMProvider;
  } = {}): FastifyInstance {
    const app = buildApp({
      nodeEnv: 'test',
      database: db,
      authConfig: {
        jwtSecret: TEST_JWT_SECRET,
        accessTokenExpiresIn: '15m',
        refreshTokenExpiresDays: 7,
      },
      retrievalService: new HybridRetrievalService(db, {
        defaultStrategy: 'hybrid',
        defaultTopK: 5,
      }),
      reranker: new HybridLexicalReranker(),
      ragRetrievalStrategy: 'hybrid',
      embeddingProvider: params.embeddingProvider ?? makeStubEmbeddingProvider(),
      llmProvider: params.llmProvider ?? makeEchoCitingLLMProvider(),
      corsOrigin: 'http://localhost:3000',
      checkDatabase: () => checkDatabaseHealth(db),
      checkRedis: async () => ({ status: 'up', latencyMs: 1 }),
    });
    openApps.push(app);
    return app;
  }

  async function registerAndCreateOrg(
    app: FastifyInstance,
    params: {
      name: string;
      email: string;
      orgName: string;
      orgSlug: string;
    },
  ) {
    const regRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        name: params.name,
        email: params.email,
        password: 'StrongPassword123!',
      },
    });
    expect(regRes.statusCode).toBe(201);
    const regBody = regRes.json();
    const accessToken = regBody.tokens.accessToken as string;
    const userId = regBody.user.id as string;

    const orgRes = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { name: params.orgName, slug: params.orgSlug },
    });
    expect(orgRes.statusCode).toBe(201);
    const orgId = orgRes.json().organization.id as string;

    return { userId, accessToken, orgId };
  }

  async function registerUser(
    app: FastifyInstance,
    params: { name: string; email: string },
  ) {
    const regRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        name: params.name,
        email: params.email,
        password: 'StrongPassword123!',
      },
    });
    expect(regRes.statusCode).toBe(201);
    return {
      userId: regRes.json().user.id as string,
      accessToken: regRes.json().tokens.accessToken as string,
    };
  }

  async function inviteAndAccept(
    app: FastifyInstance,
    params: {
      ownerToken: string;
      orgId: string;
      inviteeEmail: string;
      inviteeToken: string;
      role: 'ADMIN' | 'MEMBER';
    },
  ) {
    const inviteRes = await app.inject({
      method: 'POST',
      url: `/api/v1/organizations/${params.orgId}/invitations`,
      headers: { authorization: `Bearer ${params.ownerToken}` },
      payload: { email: params.inviteeEmail, role: params.role },
    });
    expect(inviteRes.statusCode).toBe(201);
    const invitationId = inviteRes.json().invitation.id as string;

    const acceptRes = await app.inject({
      method: 'POST',
      url: `/api/v1/organizations/invitations/${invitationId}/accept`,
      headers: { authorization: `Bearer ${params.inviteeToken}` },
    });
    expect(acceptRes.statusCode).toBe(200);
  }

  it('serves discovery routes, trailing slashes, structured 404 hints, request IDs, and CORS headers', async () => {
    const app = createTestApp();
    const tenant = await registerAndCreateOrg(app, {
      name: 'Routing Owner',
      email: 'routing@acme.test',
      orgName: 'Routing Org',
      orgSlug: 'routing-org',
    });

    const rootRes = await app.inject({ method: 'GET', url: '/' });
    expect(rootRes.statusCode).toBe(200);
    expect(rootRes.json().apiPrefix).toBe('/api/v1');
    expect(rootRes.headers['x-request-id']).toBeTruthy();

    const v1DiscoveryRes = await app.inject({
      method: 'GET',
      url: '/api/v1',
      headers: { 'x-request-id': 'trace-sprint7-001' },
    });
    expect(v1DiscoveryRes.statusCode).toBe(200);
    expect(v1DiscoveryRes.headers['x-request-id']).toBe('trace-sprint7-001');
    expect(v1DiscoveryRes.json().endpoints.analytics).toBe('/api/v1/analytics');

    // Trailing slash handling (previously 404/400)
    const healthSlash = await app.inject({
      method: 'GET',
      url: '/api/v1/health/',
    });
    expect(healthSlash.statusCode).toBe(200);

    const convSlash = await app.inject({
      method: 'GET',
      url: '/api/v1/conversations/',
      headers: {
        authorization: `Bearer ${tenant.accessToken}`,
        'x-organization-id': tenant.orgId,
      },
    });
    expect(convSlash.statusCode).toBe(200);
    expect(convSlash.json().conversations).toEqual([]);

    // Structured 404 hint
    const notFoundRes = await app.inject({
      method: 'GET',
      url: '/api/v1/nonexistent',
    });
    expect(notFoundRes.statusCode).toBe(404);
    expect(notFoundRes.json()).toMatchObject({
      error: 'NOT_FOUND',
      method: 'GET',
      path: '/api/v1/nonexistent',
    });
    expect(notFoundRes.json().hint).toContain('/api/v1');

    // CORS preflight & origin header
    const preflightRes = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/health',
      headers: {
        origin: 'http://localhost:3000',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,x-organization-id',
      },
    });
    expect(preflightRes.statusCode).toBe(204);
    expect(preflightRes.headers['access-control-allow-origin']).toBe(
      'http://localhost:3000',
    );
    expect(preflightRes.headers['access-control-allow-credentials']).toBe('true');
  });

  it('enforces message feedback validation, upsert behavior, and cross-tenant / non-owner isolation', async () => {
    const app = createTestApp();
    const tenantA = await registerAndCreateOrg(app, {
      name: 'User A1',
      email: 'fb-a1@tenanta.test',
      orgName: 'Feedback Org A',
      orgSlug: 'fb-org-a',
    });
    const tenantB = await registerAndCreateOrg(app, {
      name: 'User B1',
      email: 'fb-b1@tenantb.test',
      orgName: 'Feedback Org B',
      orgSlug: 'fb-org-b',
    });
    const userA2 = await registerUser(app, {
      name: 'User A2',
      email: 'fb-a2@tenanta.test',
    });
    await inviteAndAccept(app, {
      ownerToken: tenantA.accessToken,
      orgId: tenantA.orgId,
      inviteeEmail: 'fb-a2@tenanta.test',
      inviteeToken: userA2.accessToken,
      role: 'ADMIN',
    });

    const conv = await db.conversation.create({
      data: {
        organizationId: tenantA.orgId,
        userId: tenantA.userId,
        title: 'Feedback Conv',
      },
    });
    const userMsg = await db.message.create({
      data: {
        conversationId: conv.id,
        role: MessageRole.USER,
        content: 'What is the inspection cadence?',
      },
    });
    const assistantMsg = await db.message.create({
      data: {
        conversationId: conv.id,
        role: MessageRole.ASSISTANT,
        content: 'Inspect every 90 days.',
      },
    });

    // UP feedback succeeds
    const upRes = await app.inject({
      method: 'POST',
      url: `/api/v1/messages/${assistantMsg.id}/feedback`,
      headers: {
        authorization: `Bearer ${tenantA.accessToken}`,
        'x-organization-id': tenantA.orgId,
      },
      payload: { rating: 'UP', comment: 'Clear and accurate' },
    });
    expect(upRes.statusCode).toBe(200);
    expect(upRes.json().feedback).toMatchObject({
      messageId: assistantMsg.id,
      userId: tenantA.userId,
      rating: 'UP',
      comment: 'Clear and accurate',
    });

    // Upserting to DOWN updates existing row rather than creating duplicate
    const downRes = await app.inject({
      method: 'POST',
      url: `/api/v1/messages/${assistantMsg.id}/feedback`,
      headers: {
        authorization: `Bearer ${tenantA.accessToken}`,
        'x-organization-id': tenantA.orgId,
      },
      payload: { rating: 'DOWN', comment: 'Missing page reference' },
    });
    expect(downRes.statusCode).toBe(200);
    expect(downRes.json().feedback.rating).toBe('DOWN');
    expect(downRes.json().feedback.comment).toBe('Missing page reference');
    expect(
      await db.messageFeedback.count({ where: { messageId: assistantMsg.id } }),
    ).toBe(1);

    // Feedback on USER message rejected with 400
    const userMsgRes = await app.inject({
      method: 'POST',
      url: `/api/v1/messages/${userMsg.id}/feedback`,
      headers: {
        authorization: `Bearer ${tenantA.accessToken}`,
        'x-organization-id': tenantA.orgId,
      },
      payload: { rating: 'UP' },
    });
    expect(userMsgRes.statusCode).toBe(400);
    expect(userMsgRes.json().error).toBe('INVALID_FEEDBACK_TARGET');

    // Non-member of Org A -> 403
    const nonMemberRes = await app.inject({
      method: 'POST',
      url: `/api/v1/messages/${assistantMsg.id}/feedback`,
      headers: {
        authorization: `Bearer ${tenantB.accessToken}`,
        'x-organization-id': tenantA.orgId,
      },
      payload: { rating: 'UP' },
    });
    expect(nonMemberRes.statusCode).toBe(403);

    // Cross-org messageId under Org B header -> 404
    const crossOrgRes = await app.inject({
      method: 'POST',
      url: `/api/v1/messages/${assistantMsg.id}/feedback`,
      headers: {
        authorization: `Bearer ${tenantB.accessToken}`,
        'x-organization-id': tenantB.orgId,
      },
      payload: { rating: 'UP' },
    });
    expect(crossOrgRes.statusCode).toBe(404);

    // Same-org non-owner (User A2) -> 404
    const nonOwnerRes = await app.inject({
      method: 'POST',
      url: `/api/v1/messages/${assistantMsg.id}/feedback`,
      headers: {
        authorization: `Bearer ${userA2.accessToken}`,
        'x-organization-id': tenantA.orgId,
      },
      payload: { rating: 'UP' },
    });
    expect(nonOwnerRes.statusCode).toBe(404);
  });

  it('computes dashboard overview and usage/performance/quality analytics strictly scoped to organizationId', async () => {
    const app = createTestApp();
    const tenantA = await registerAndCreateOrg(app, {
      name: 'Analytics A',
      email: 'analytics-a@tenanta.test',
      orgName: 'Analytics Org A',
      orgSlug: 'analytics-org-a',
    });
    const tenantB = await registerAndCreateOrg(app, {
      name: 'Analytics B',
      email: 'analytics-b@tenantb.test',
      orgName: 'Analytics Org B',
      orgSlug: 'analytics-org-b',
    });

    // Seed Org A data
    const docA1 = await db.document.create({
      data: {
        organizationId: tenantA.orgId,
        filename: 'a1.pdf',
        storageKey: `organizations/${tenantA.orgId}/a1.pdf`,
        mimeType: 'application/pdf',
        fileSize: 1000,
        checksum: 'chk-a1',
        status: DocumentStatus.COMPLETED,
        pageCount: 1,
      },
    });
    await db.document.create({
      data: {
        organizationId: tenantA.orgId,
        filename: 'a2-failed.pdf',
        storageKey: `organizations/${tenantA.orgId}/a2.pdf`,
        mimeType: 'application/pdf',
        fileSize: 1000,
        checksum: 'chk-a2',
        status: DocumentStatus.FAILED,
      },
    });
    const chunkAId = randomUUID();
    await insertDocumentChunksWithEmbeddings(db, [
      {
        id: chunkAId,
        documentId: docA1.id,
        organizationId: tenantA.orgId,
        content: 'Org A analytics source text.',
        embedding: makeBasisVector(0),
        pageNumber: 1,
        chunkIndex: 0,
        tokenCount: 5,
        metadata: { pageNumber: 1, chunkIndex: 0, tokenCount: 5 },
      },
    ]);

    const convA = await db.conversation.create({
      data: {
        organizationId: tenantA.orgId,
        userId: tenantA.userId,
        title: 'Org A Conv',
      },
    });
    const msgAUser = await db.message.create({
      data: {
        conversationId: convA.id,
        role: MessageRole.USER,
        content: 'Question 1',
      },
    });
    const msgAAssistant1 = await db.message.create({
      data: {
        conversationId: convA.id,
        role: MessageRole.ASSISTANT,
        content: 'Grounded Answer 1',
        insufficientContext: false,
      },
    });
    const msgAAssistant2 = await db.message.create({
      data: {
        conversationId: convA.id,
        role: MessageRole.ASSISTANT,
        content: 'Insufficient context refusal',
        insufficientContext: true,
      },
    });
    await db.messageCitation.create({
      data: {
        messageId: msgAAssistant1.id,
        chunkId: chunkAId,
        relevanceScore: 0.95,
      },
    });
    await db.messageFeedback.createMany({
      data: [
        {
          messageId: msgAAssistant1.id,
          userId: tenantA.userId,
          rating: FeedbackRating.UP,
        },
        {
          messageId: msgAAssistant2.id,
          userId: tenantA.userId,
          rating: FeedbackRating.DOWN,
        },
      ],
    });
    await db.usageEvent.createMany({
      data: [
        {
          organizationId: tenantA.orgId,
          userId: tenantA.userId,
          conversationId: convA.id,
          messageId: msgAAssistant1.id,
          operation: 'rag_query',
          model: 'gpt-4o-mini',
          inputTokens: 100,
          outputTokens: 20,
          latencyMs: 120,
          estimatedCost: '0.00010000',
        },
        {
          organizationId: tenantA.orgId,
          userId: tenantA.userId,
          conversationId: convA.id,
          messageId: msgAAssistant2.id,
          operation: 'rag_retrieval_empty',
          model: 'gpt-4o-mini',
          inputTokens: 0,
          outputTokens: 0,
          latencyMs: 40,
          estimatedCost: '0.00001000',
        },
      ],
    });

    // Seed Org B data (must NEVER leak into Org A analytics)
    await db.document.create({
      data: {
        organizationId: tenantB.orgId,
        filename: 'b1.pdf',
        storageKey: `organizations/${tenantB.orgId}/b1.pdf`,
        mimeType: 'application/pdf',
        fileSize: 1000,
        checksum: 'chk-b1',
        status: DocumentStatus.COMPLETED,
      },
    });
    const convB = await db.conversation.create({
      data: {
        organizationId: tenantB.orgId,
        userId: tenantB.userId,
        title: 'Org B Conv',
      },
    });
    const msgBAssistant = await db.message.create({
      data: {
        conversationId: convB.id,
        role: MessageRole.ASSISTANT,
        content: 'Org B answer',
      },
    });
    await db.messageFeedback.create({
      data: {
        messageId: msgBAssistant.id,
        userId: tenantB.userId,
        rating: FeedbackRating.UP,
      },
    });
    await db.usageEvent.create({
      data: {
        organizationId: tenantB.orgId,
        userId: tenantB.userId,
        conversationId: convB.id,
        messageId: msgBAssistant.id,
        operation: 'rag_query',
        model: 'gpt-4o',
        inputTokens: 9999,
        outputTokens: 9999,
        latencyMs: 9999,
        estimatedCost: '5.00000000',
      },
    });

    // Non-member blocked with 403
    const forbiddenRes = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard/overview',
      headers: {
        authorization: `Bearer ${tenantB.accessToken}`,
        'x-organization-id': tenantA.orgId,
      },
    });
    expect(forbiddenRes.statusCode).toBe(403);

    // Overview for Org A
    const overviewRes = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboard/overview',
      headers: {
        authorization: `Bearer ${tenantA.accessToken}`,
        'x-organization-id': tenantA.orgId,
      },
    });
    expect(overviewRes.statusCode).toBe(200);
    expect(overviewRes.json().overview).toEqual({
      organizationId: tenantA.orgId,
      documents: {
        total: 2,
        completed: 1,
        pending: 0,
        processing: 0,
        failed: 1,
        totalChunks: 1,
      },
      conversations: {
        total: 1,
        totalMessages: msgAUser.id ? 3 : 3,
      },
      usage: {
        totalEvents: 2,
        totalInputTokens: 100,
        totalOutputTokens: 20,
        totalTokens: 120,
        estimatedCostUsd: 0.00011,
      },
      performance: {
        avgLatencyMs: 80,
        p95LatencyMs: 116,
      },
      quality: {
        totalAssistantMessages: 2,
        insufficientContextCount: 1,
        insufficientContextRate: 0.5,
        totalFeedback: 2,
        positiveFeedback: 1,
        negativeFeedback: 1,
        positiveFeedbackRate: 0.5,
      },
    });

    // Usage for Org A
    const usageRes = await app.inject({
      method: 'GET',
      url: '/api/v1/analytics/usage?days=30',
      headers: {
        authorization: `Bearer ${tenantA.accessToken}`,
        'x-organization-id': tenantA.orgId,
      },
    });
    expect(usageRes.statusCode).toBe(200);
    expect(usageRes.json().usage.totals).toEqual({
      events: 2,
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      estimatedCostUsd: 0.00011,
    });
    expect(usageRes.json().usage.byModel.map((m: { model: string }) => m.model)).toEqual([
      'gpt-4o-mini',
    ]);

    // Performance for Org A
    const perfRes = await app.inject({
      method: 'GET',
      url: '/api/v1/analytics/performance?days=30',
      headers: {
        authorization: `Bearer ${tenantA.accessToken}`,
        'x-organization-id': tenantA.orgId,
      },
    });
    expect(perfRes.statusCode).toBe(200);
    expect(perfRes.json().performance).toMatchObject({
      organizationId: tenantA.orgId,
      periodDays: 30,
      totalEvents: 2,
      avgLatencyMs: 80,
      p50LatencyMs: 80,
      p95LatencyMs: 116,
      maxLatencyMs: 120,
    });

    // Quality for Org A
    const qualityRes = await app.inject({
      method: 'GET',
      url: '/api/v1/analytics/quality?days=30',
      headers: {
        authorization: `Bearer ${tenantA.accessToken}`,
        'x-organization-id': tenantA.orgId,
      },
    });
    expect(qualityRes.statusCode).toBe(200);
    expect(qualityRes.json().quality).toEqual({
      organizationId: tenantA.orgId,
      periodDays: 30,
      totalAssistantMessages: 2,
      groundedAnswerCount: 1,
      insufficientContextCount: 1,
      insufficientContextRate: 0.5,
      totalCitations: 1,
      avgCitationsPerGroundedAnswer: 1,
      feedback: {
        total: 2,
        up: 1,
        down: 1,
        positiveRate: 0.5,
      },
    });
  });

  it('executes hybrid and lexical RAG strategies against real pgvector + FTS GIN index with tenant isolation', async () => {
    const embeddingProvider = makeStubEmbeddingProvider(makeBasisVector(0));
    const llmProvider = makeEchoCitingLLMProvider();
    const app = createTestApp({ embeddingProvider, llmProvider });

    const tenantA = await registerAndCreateOrg(app, {
      name: 'Hybrid A',
      email: 'hybrid-a@tenanta.test',
      orgName: 'Hybrid Org A',
      orgSlug: 'hybrid-org-a',
    });
    const tenantB = await registerAndCreateOrg(app, {
      name: 'Hybrid B',
      email: 'hybrid-b@tenantb.test',
      orgName: 'Hybrid Org B',
      orgSlug: 'hybrid-org-b',
    });

    const docA = await db.document.create({
      data: {
        organizationId: tenantA.orgId,
        filename: 'pump-manual-a.pdf',
        storageKey: `organizations/${tenantA.orgId}/pump-a.pdf`,
        mimeType: 'application/pdf',
        fileSize: 1024,
        checksum: 'chk-pump-a',
        status: DocumentStatus.COMPLETED,
        pageCount: 2,
      },
    });
    const docB = await db.document.create({
      data: {
        organizationId: tenantB.orgId,
        filename: 'pump-manual-b.pdf',
        storageKey: `organizations/${tenantB.orgId}/pump-b.pdf`,
        mimeType: 'application/pdf',
        fileSize: 1024,
        checksum: 'chk-pump-b',
        status: DocumentStatus.COMPLETED,
        pageCount: 2,
      },
    });

    const chunkALexicalId = randomUUID();
    const chunkASemanticId = randomUUID();
    const chunkBId = randomUUID();

    await insertDocumentChunksWithEmbeddings(db, [
      {
        id: chunkALexicalId,
        documentId: docA.id,
        organizationId: tenantA.orgId,
        content: 'Valve KV-4200 cavitation inspection requires draining the manifold.',
        embedding: makeBasisVector(0),
        pageNumber: 2,
        chunkIndex: 0,
        tokenCount: 10,
        metadata: { pageNumber: 2, chunkIndex: 0, tokenCount: 10 },
      },
      {
        id: chunkASemanticId,
        documentId: docA.id,
        organizationId: tenantA.orgId,
        content: 'General cooling system operating temperature baseline.',
        embedding: makeBasisVector(0),
        pageNumber: 1,
        chunkIndex: 1,
        tokenCount: 8,
        metadata: { pageNumber: 1, chunkIndex: 1, tokenCount: 8 },
      },
      {
        id: chunkBId,
        documentId: docB.id,
        organizationId: tenantB.orgId,
        content: 'Tenant B secret KV-4200 cavitation protocol.',
        embedding: makeBasisVector(0),
        pageNumber: 9,
        chunkIndex: 0,
        tokenCount: 8,
        metadata: { pageNumber: 9, chunkIndex: 0, tokenCount: 8 },
      },
    ]);

    const convRes = await app.inject({
      method: 'POST',
      url: '/api/v1/conversations',
      headers: {
        authorization: `Bearer ${tenantA.accessToken}`,
        'x-organization-id': tenantA.orgId,
      },
      payload: { title: 'Hybrid & Lexical Test' },
    });
    expect(convRes.statusCode).toBe(201);
    const convId = convRes.json().conversation.id as string;

    // 1) Lexical strategy skips embedding generation and cites Org A's exact FTS match
    const lexicalRes = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${convId}/messages`,
      headers: {
        authorization: `Bearer ${tenantA.accessToken}`,
        'x-organization-id': tenantA.orgId,
      },
      payload: {
        content: 'KV-4200 cavitation',
        strategy: 'lexical',
        topK: 5,
      },
    });
    expect(lexicalRes.statusCode).toBe(201);
    expect(embeddingProvider.embedQuery).not.toHaveBeenCalled();
    expect(lexicalRes.json().citations).toHaveLength(1);
    expect(lexicalRes.json().citations[0].chunkId).toBe(chunkALexicalId);
    expect(lexicalRes.json().citations[0].documentId).toBe(docA.id);
    expect(lexicalRes.json().usage.embeddingModel).toBe('none');
    expect(lexicalRes.json().usage.stageLatencies.embeddingMs).toBe(0);

    // 2) Hybrid strategy calls embedQuery, runs pgvector + FTS RRF + reranker, never leaks Org B
    const hybridRes = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${convId}/messages`,
      headers: {
        authorization: `Bearer ${tenantA.accessToken}`,
        'x-organization-id': tenantA.orgId,
      },
      payload: {
        content: 'KV-4200 cavitation inspection',
        strategy: 'hybrid',
        topK: 5,
      },
    });
    expect(hybridRes.statusCode).toBe(201);
    expect(embeddingProvider.embedQuery).toHaveBeenCalledTimes(1);
    expect(hybridRes.json().citations).toHaveLength(1);
    expect(hybridRes.json().citations[0].chunkId).toBe(chunkALexicalId);
    expect(hybridRes.json().citations[0].chunkId).not.toBe(chunkBId);
    expect(hybridRes.json().usage.embeddingModel).toBe('text-embedding-3-small');
    expect(hybridRes.json().usage.stageLatencies).toMatchObject({
      embeddingMs: expect.any(Number),
      retrievalMs: expect.any(Number),
      rerankMs: expect.any(Number),
      generationMs: expect.any(Number),
    });
  });
});
