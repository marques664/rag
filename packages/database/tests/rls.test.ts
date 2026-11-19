import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../src/generated/prisma/client.js';
import {
  RLS_TENANT_SETTING,
  type RlsDatabaseClient,
  withTenantRlsContext,
} from '../src/rls.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';

describe('withTenantRlsContext', () => {
  it('rejects non-UUID organizationId values before starting a transaction', async () => {
    const db: RlsDatabaseClient = {
      $transaction: vi.fn(),
    };

    await expect(
      withTenantRlsContext(db, 'not-a-uuid', async () => 'ok'),
    ).rejects.toThrow('organizationId must be a valid UUID');
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('switches to enterprise_ai_app local role and binds app.current_organization_id inside transaction', async () => {
    const executedSql: Prisma.Sql[] = [];
    const tx = {
      $executeRaw: vi.fn(async (query: Prisma.Sql) => {
        executedSql.push(query);
        return 0;
      }),
    };
    const db: RlsDatabaseClient = {
      $transaction: vi.fn(async (fn) => fn(tx)),
    };

    const result = await withTenantRlsContext(db, ORG_ID, async () => 42);

    expect(result).toBe(42);
    expect(executedSql).toHaveLength(2);
    expect(executedSql[0]!.sql).toContain('SET LOCAL ROLE "enterprise_ai_app"');
    expect(executedSql[1]!.sql).toContain('set_config(');
    expect(executedSql[1]!.values).toEqual([RLS_TENANT_SETTING, ORG_ID]);
  });
});
