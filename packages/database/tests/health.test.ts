import { describe, expect, it, vi } from 'vitest';
import { checkDatabaseHealth, type QueryableDatabase } from '../src/health.js';

describe('checkDatabaseHealth', () => {
  it('returns status up and pgvectorEnabled true when query and extension check succeed', async () => {
    const mockClient: QueryableDatabase = {
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ '?column?': 1 }])
        .mockResolvedValueOnce([{ enabled: true }]) as QueryableDatabase['$queryRaw'],
    };

    const result = await checkDatabaseHealth(mockClient);

    expect(result.status).toBe('up');
    expect(result.pgvectorEnabled).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeUndefined();
  });

  it('returns pgvectorEnabled false when the vector extension is not installed', async () => {
    const mockClient: QueryableDatabase = {
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ '?column?': 1 }])
        .mockResolvedValueOnce([{ enabled: false }]) as QueryableDatabase['$queryRaw'],
    };

    const result = await checkDatabaseHealth(mockClient);

    expect(result.status).toBe('up');
    expect(result.pgvectorEnabled).toBe(false);
  });

  it('returns status down with an error message when the database query fails', async () => {
    const mockClient: QueryableDatabase = {
      $queryRaw: vi
        .fn()
        .mockRejectedValueOnce(new Error('ECONNREFUSED')) as QueryableDatabase['$queryRaw'],
    };

    const result = await checkDatabaseHealth(mockClient);

    expect(result.status).toBe('down');
    expect(result.pgvectorEnabled).toBe(false);
    expect(result.error).toBe('ECONNREFUSED');
  });
});
