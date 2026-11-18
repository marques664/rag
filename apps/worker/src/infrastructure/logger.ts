import pino, { type Logger } from 'pino';

export type WorkerLogger = Logger;

/**
 * Creates a structured Pino logger for the background worker process.
 */
export function createWorkerLogger(options: {
  nodeEnv: 'development' | 'test' | 'production';
  logLevel: string;
}): WorkerLogger {
  return pino({
    name: 'document-worker',
    level: options.logLevel,
    ...(options.nodeEnv === 'development'
      ? {
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:standard',
            },
          },
        }
      : {}),
  });
}
