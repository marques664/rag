import type { DatabaseCheckResult } from '@enterprise-ai/shared';

export interface QueryableDatabase {
  $queryRaw<T = unknown>(
    query: TemplateStringsArray,
    ...values: readonly unknown[]
  ): Promise<T>;
}

/**
 * Verifies PostgreSQL connectivity and checks whether the pgvector extension is installed.
 */
export async function checkDatabaseHealth(
  client: QueryableDatabase,
): Promise<DatabaseCheckResult> {
  const startedAt = performance.now();

  try {
    await client.$queryRaw`SELECT 1`;
    const rows = await client.$queryRaw<Array<{ enabled: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'vector'
      ) AS enabled
    `;

    const pgvectorEnabled = Boolean(rows[0]?.enabled);
    const latencyMs = Math.round(performance.now() - startedAt);

    return {
      status: 'up',
      pgvectorEnabled,
      latencyMs,
    };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - startedAt);
    return {
      status: 'down',
      pgvectorEnabled: false,
      latencyMs,
      error: error instanceof Error ? error.message : 'Database connection failed',
    };
  }
}
