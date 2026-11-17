import { describe, expect, it, vi } from 'vitest';
import { checkRedisHealth, type PingableRedis } from '../src/infrastructure/redis.js';

describe('checkRedisHealth', () => {
  it('returns status up when PING returns PONG', async () => {
    const mockRedis: PingableRedis = {
      ping: vi.fn().mockResolvedValueOnce('PONG'),
    };

    const result = await checkRedisHealth(mockRedis);

    expect(result.status).toBe('up');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeUndefined();
  });

  it('returns status down when PING returns an unexpected response', async () => {
    const mockRedis: PingableRedis = {
      ping: vi.fn().mockResolvedValueOnce('LOADING'),
    };

    const result = await checkRedisHealth(mockRedis);

    expect(result.status).toBe('down');
    expect(result.error).toContain('LOADING');
  });

  it('returns status down when PING throws an error', async () => {
    const mockRedis: PingableRedis = {
      ping: vi.fn().mockRejectedValueOnce(new Error('Connection closed')),
    };

    const result = await checkRedisHealth(mockRedis);

    expect(result.status).toBe('down');
    expect(result.error).toBe('Connection closed');
  });
});
