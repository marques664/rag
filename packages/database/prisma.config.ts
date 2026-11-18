import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'prisma/config';

loadDotenv({ path: path.resolve(import.meta.dirname, '../../.env') });
loadDotenv();

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url:
      process.env['DATABASE_URL'] ??
      'postgresql://postgres:postgres@localhost:5432/enterprise_knowledge_ai?schema=public',
  },
});
