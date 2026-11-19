import { Prisma } from './generated/prisma/client.js';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const RLS_APP_ROLE = 'enterprise_ai_app';
export const RLS_TENANT_SETTING = 'app.current_organization_id';

export interface RlsTransactionClient {
  $executeRaw(query: Prisma.Sql): Promise<number>;
}

export interface RlsDatabaseClient {
  $transaction<T>(
    fn: (tx: RlsTransactionClient & Record<string, unknown>) => Promise<T>,
  ): Promise<T>;
}

/**
 * Executes a callback inside a PostgreSQL transaction scoped to a single
 * organization under the non-superuser `enterprise_ai_app` RLS role.
 * `SET LOCAL` ensures role and tenant scope reset automatically on commit/rollback.
 */
export async function withTenantRlsContext<
  TClient extends RlsDatabaseClient,
  TResult,
>(
  db: TClient,
  organizationId: string,
  fn: (tx: Parameters<TClient['$transaction']>[0] extends (tx: infer TTx) => Promise<unknown> ? TTx : RlsTransactionClient) => Promise<TResult>,
): Promise<TResult> {
  if (!UUID_REGEX.test(organizationId)) {
    throw new Error('organizationId must be a valid UUID for RLS context');
  }

  return db.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SET LOCAL ROLE "enterprise_ai_app"`);
    await tx.$executeRaw(
      Prisma.sql`SELECT set_config(${RLS_TENANT_SETTING}, ${organizationId}, true)`,
    );
    return fn(
      tx as Parameters<TClient['$transaction']>[0] extends (
        tx: infer TTx,
      ) => Promise<unknown>
        ? TTx
        : never,
    );
  });
}
