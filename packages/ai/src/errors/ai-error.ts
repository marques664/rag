export type AIErrorCode =
  | 'PROVIDER_NOT_CONFIGURED'
  | 'AUTH_ERROR'
  | 'RATE_LIMIT'
  | 'TIMEOUT'
  | 'UPSTREAM_ERROR'
  | 'INVALID_REQUEST'
  | 'INVALID_RESPONSE'
  | 'ABORTED';

export interface AIProviderErrorOptions {
  provider: string;
  code: AIErrorCode;
  statusCode?: number;
  retryable: boolean;
  retryAfterMs?: number;
  cause?: unknown;
}

const SENSITIVE_TOKEN_PATTERNS = [
  /sk-[a-zA-Z0-9_-]{8,}/g,
  /gsk_[a-zA-Z0-9_-]{8,}/g,
  /AIza[0-9A-Za-z_-]{20,}/g,
  /Bearer\s+[A-Za-z0-9._-]+/gi,
];

/**
 * Strips common secret token patterns from upstream provider messages so API keys
 * are never surfaced in logs or downstream error payloads.
 */
export function redactProviderSecrets(message: string): string {
  let sanitized = message;
  for (const pattern of SENSITIVE_TOKEN_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }
  return sanitized;
}

/**
 * Base error for all AI provider failures (embeddings and LLM generation).
 */
export class AIProviderError extends Error {
  public readonly provider: string;
  public readonly code: AIErrorCode;
  public readonly statusCode?: number;
  public readonly retryable: boolean;
  public readonly retryAfterMs?: number;

  constructor(message: string, options: AIProviderErrorOptions) {
    super(redactProviderSecrets(message), { cause: options.cause });
    this.name = 'AIProviderError';
    this.provider = options.provider;
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.retryable = options.retryable;
    this.retryAfterMs = options.retryAfterMs;
  }
}

export class AIProviderNotConfiguredError extends AIProviderError {
  constructor(provider: string, message: string) {
    super(message, {
      provider,
      code: 'PROVIDER_NOT_CONFIGURED',
      retryable: false,
    });
    this.name = 'AIProviderNotConfiguredError';
  }
}

export class AIAuthenticationError extends AIProviderError {
  constructor(provider: string, message: string, statusCode?: number) {
    super(message, {
      provider,
      code: 'AUTH_ERROR',
      statusCode,
      retryable: false,
    });
    this.name = 'AIAuthenticationError';
  }
}

export class AIRateLimitError extends AIProviderError {
  constructor(
    provider: string,
    message: string,
    options: { statusCode?: number; retryAfterMs?: number; cause?: unknown } = {},
  ) {
    super(message, {
      provider,
      code: 'RATE_LIMIT',
      statusCode: options.statusCode ?? 429,
      retryable: true,
      retryAfterMs: options.retryAfterMs,
      cause: options.cause,
    });
    this.name = 'AIRateLimitError';
  }
}

export class AITimeoutError extends AIProviderError {
  constructor(provider: string, message: string, cause?: unknown) {
    super(message, {
      provider,
      code: 'TIMEOUT',
      retryable: true,
      cause,
    });
    this.name = 'AITimeoutError';
  }
}

export class AIUpstreamError extends AIProviderError {
  constructor(
    provider: string,
    message: string,
    options: { statusCode?: number; cause?: unknown } = {},
  ) {
    super(message, {
      provider,
      code: 'UPSTREAM_ERROR',
      statusCode: options.statusCode,
      retryable: true,
      cause: options.cause,
    });
    this.name = 'AIUpstreamError';
  }
}

export class AIInvalidRequestError extends AIProviderError {
  constructor(provider: string, message: string, statusCode?: number) {
    super(message, {
      provider,
      code: 'INVALID_REQUEST',
      statusCode,
      retryable: false,
    });
    this.name = 'AIInvalidRequestError';
  }
}

export class AIInvalidResponseError extends AIProviderError {
  constructor(provider: string, message: string, cause?: unknown) {
    super(message, {
      provider,
      code: 'INVALID_RESPONSE',
      retryable: false,
      cause,
    });
    this.name = 'AIInvalidResponseError';
  }
}

export class AIAbortedError extends AIProviderError {
  constructor(provider: string, message = 'AI provider request was aborted', cause?: unknown) {
    super(message, {
      provider,
      code: 'ABORTED',
      retryable: false,
      cause,
    });
    this.name = 'AIAbortedError';
  }
}
