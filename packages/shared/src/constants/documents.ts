export const DOCUMENT_PROCESSING_QUEUE_NAME = 'document-processing';
export const DOCUMENT_PROCESS_JOB_NAME = 'process-document';

export const DEFAULT_CHUNK_SIZE_TOKENS = 500;
export const DEFAULT_CHUNK_OVERLAP_TOKENS = 75;

export const MAX_DOCUMENT_FILE_SIZE_BYTES = 25 * 1024 * 1024;
export const ALLOWED_DOCUMENT_MIME_TYPES = ['application/pdf'] as const;

export const DEFAULT_JOB_ATTEMPTS = 3;
export const DEFAULT_JOB_BACKOFF_MS = 2000;
