import {
  DEFAULT_RETRIEVAL_TOP_K,
  MAX_DOCUMENT_FILE_SIZE_BYTES,
  MAX_RETRIEVAL_TOP_K,
  RETRIEVAL_STRATEGIES,
} from '@enterprise-ai/shared';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().min(1).default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters long'),
  JWT_ACCESS_EXPIRES_IN: z.string().min(1).default('15m'),
  JWT_REFRESH_EXPIRES_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  MINIO_ENDPOINT: z.string().min(1).default('localhost'),
  MINIO_PORT: z.coerce.number().int().min(1).max(65535).default(9000),
  MINIO_USE_SSL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  MINIO_ROOT_USER: z.string().min(1).default('minioadmin'),
  MINIO_ROOT_PASSWORD: z.string().min(1).default('minioadmin'),
  MINIO_BUCKET: z.string().min(1).default('enterprise-knowledge-documents'),
  MAX_DOCUMENT_FILE_SIZE_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(100 * 1024 * 1024)
    .default(MAX_DOCUMENT_FILE_SIZE_BYTES),
  RAG_DEFAULT_TOP_K: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_RETRIEVAL_TOP_K)
    .default(DEFAULT_RETRIEVAL_TOP_K),
  RAG_MAX_CONTEXT_CHARS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(200_000)
    .default(24_000),
  RAG_RETRIEVAL_STRATEGY: z
    .enum(RETRIEVAL_STRATEGIES)
    .default('hybrid'),
  CORS_ORIGIN: z.string().trim().min(1).default('http://localhost:3000'),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100_000).default(120),
  RATE_LIMIT_WINDOW_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(3_600_000)
    .default(60_000),
});

export type AppEnv = z.infer<typeof envSchema>;

/**
 * Parses and validates runtime environment variables for the API server.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }

  return parsed.data;
}
