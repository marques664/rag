export const DOCUMENT_STATUS = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;

export type DocumentStatus =
  (typeof DOCUMENT_STATUS)[keyof typeof DOCUMENT_STATUS];

export const PROCESSING_JOB_STATUS = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;

export type ProcessingJobStatus =
  (typeof PROCESSING_JOB_STATUS)[keyof typeof PROCESSING_JOB_STATUS];

export interface DocumentProcessJobPayload {
  documentId: string;
  organizationId: string;
  processingJobId: string;
  storageKey: string;
  processingVersion: number;
}

export interface DocumentChunkMetadata {
  filename?: string;
  pageNumber: number;
  chunkIndex: number;
  tokenCount: number;
  totalPages?: number;
  charCount?: number;
  charStart?: number;
  charEnd?: number;
  strategy?: string;
  processingJobId?: string;
  [key: string]: unknown;
}
