import type { DocumentStatus, ProcessingJobStatus } from '@enterprise-ai/database';

export interface ProcessingJobSummaryDto {
  id: string;
  status: ProcessingJobStatus;
  attempts: number;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentSummaryDto {
  id: string;
  organizationId: string;
  uploadedByUserId: string | null;
  filename: string;
  mimeType: string;
  fileSize: number;
  checksum: string;
  status: DocumentStatus;
  pageCount: number | null;
  processingVersion: number;
  errorMessage: string | null;
  processedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentDetailDto extends DocumentSummaryDto {
  chunkCount: number;
  latestJob: ProcessingJobSummaryDto | null;
}

export interface DocumentStatusDto {
  documentId: string;
  status: DocumentStatus;
  processingVersion: number;
  chunkCount: number;
  pageCount: number | null;
  errorMessage: string | null;
  processedAt: string | null;
  updatedAt: string;
  latestJob: ProcessingJobSummaryDto | null;
}

export interface PaginationDto {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ListDocumentsQuery {
  status?: DocumentStatus;
  page: number;
  limit: number;
}

export interface ListDocumentsResult {
  documents: DocumentSummaryDto[];
  pagination: PaginationDto;
}

export interface UploadDocumentInput {
  organizationId: string;
  uploadedByUserId: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
}

export interface ReprocessDocumentResult {
  document: DocumentSummaryDto;
  job: ProcessingJobSummaryDto;
}
