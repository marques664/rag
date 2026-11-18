import { DEFAULT_JOB_ATTEMPTS } from '@enterprise-ai/shared';
import { z } from 'zod';

function parseBooleanEnv(value: unknown): unknown {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') {
      return true;
    }
    if (normalized === 'false' || normalized === '0' || normalized === '') {
      return false;
    }
  }
  return value;
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  MINIO_ENDPOINT: z.string().min(1).default('localhost'),
  MINIO_PORT: z.coerce.number().int().min(1).max(65535).default(9000),
  MINIO_USE_SSL: z.preprocess(parseBooleanEnv, z.boolean()).default(false),
  MINIO_ROOT_USER: z.string().min(1, 'MINIO_ROOT_USER is required'),
  MINIO_ROOT_PASSWORD: z.string().min(1, 'MINIO_ROOT_PASSWORD is required'),
  MINIO_BUCKET: z.string().min(1).default('enterprise-knowledge-documents'),
  MINIO_REGION: z.string().min(1).default('us-east-1'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(3),
  WORKER_MAX_ATTEMPTS: z.coerce
    .number()
    .int()
    .min(1)
    .max(10)
    .default(DEFAULT_JOB_ATTEMPTS),
});

export type WorkerEnv = z.infer<typeof envSchema>;

/**
 * Parses and validates runtime environment variables for the document processing worker.
 */
export function loadWorkerEnv(
  source: NodeJS.ProcessEnv = process.env,
): WorkerEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid worker environment configuration: ${issues}`);
  }

  return parsed.data;
}
