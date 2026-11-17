import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';

describe('Health and readiness endpoints', () => {
  it('returns 200 OK on GET /health and GET /api/v1/health', async () => {
    const app = buildApp({
      nodeEnv: 'test',
      checkDatabase: async () => ({
        status: 'up',
        pgvectorEnabled: true,
        latencyMs: 1,
      }),
      checkRedis: async () => ({
        status: 'up',
        latencyMs: 1,
      }),
    });

    const rootRes = await app.inject({ method: 'GET', url: '/health' });
    const v1Res = await app.inject({ method: 'GET', url: '/api/v1/health' });

    expect(rootRes.statusCode).toBe(200);
    expect(v1Res.statusCode).toBe(200);

    const body = rootRes.json();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('enterprise-knowledge-ai-api');
    expect(typeof body.timestamp).toBe('string');
    expect(typeof body.uptimeSeconds).toBe('number');

    await app.close();
  });

  it('returns 200 ready when database, pgvector, and redis are healthy', async () => {
    const app = buildApp({
      nodeEnv: 'test',
      checkDatabase: async () => ({
        status: 'up',
        pgvectorEnabled: true,
        latencyMs: 2,
      }),
      checkRedis: async () => ({
        status: 'up',
        latencyMs: 1,
      }),
    });

    const res = await app.inject({ method: 'GET', url: '/api/v1/ready' });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.status).toBe('ready');
    expect(body.checks.database.pgvectorEnabled).toBe(true);
    expect(body.checks.redis.status).toBe('up');

    await app.close();
  });

  it('returns 503 degraded when pgvector is missing or a dependency is down', async () => {
    const app = buildApp({
      nodeEnv: 'test',
      checkDatabase: async () => ({
        status: 'up',
        pgvectorEnabled: false,
        latencyMs: 2,
      }),
      checkRedis: async () => ({
        status: 'down',
        latencyMs: 3,
        error: 'Redis unavailable',
      }),
    });

    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(503);

    const body = res.json();
    expect(body.status).toBe('degraded');
    expect(body.checks.database.pgvectorEnabled).toBe(false);
    expect(body.checks.redis.status).toBe('down');

    await app.close();
  });
});

describe('loadEnv', () => {
  it('applies defaults when optional variables are omitted', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/test',
      REDIS_URL: 'redis://localhost:6379',
    });

    expect(env.NODE_ENV).toBe('development');
    expect(env.API_PORT).toBe(3001);
    expect(env.API_HOST).toBe('0.0.0.0');
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('throws a clear error when required variables are missing', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
  });
});
