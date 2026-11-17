import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

export type DatabaseClient = PrismaClient;

/**
 * Creates a PrismaClient backed by the PostgreSQL `pg` driver adapter.
 */
export function createDatabaseClient(connectionString: string): DatabaseClient {
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to create a database client.');
  }

  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}
