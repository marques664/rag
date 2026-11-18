import { z } from 'zod';

const documentStatusValues = [
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
] as const;

const processingJobStatusValues = [
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
] as const;

export const documentOrganizationHeaderSchema = z.object({
  'x-organization-id': z.string().uuid(),
});

export const documentParamsSchema = z.object({
  id: z.string().uuid(),
});

export const listDocumentsQuerySchema = z.object({
  status: z.enum(documentStatusValues).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const processingJobSummarySchema = z.object({
  id: z.string().uuid(),
  status: z.enum(processingJobStatusValues),
  attempts: z.number().int().nonnegative(),
  error: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const documentSummarySchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  uploadedByUserId: z.string().uuid().nullable(),
  filename: z.string(),
  mimeType: z.string(),
  fileSize: z.number().int().positive(),
  checksum: z.string(),
  status: z.enum(documentStatusValues),
  pageCount: z.number().int().nullable(),
  processingVersion: z.number().int().positive(),
  errorMessage: z.string().nullable(),
  processedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const documentDetailSchema = documentSummarySchema.extend({
  chunkCount: z.number().int().nonnegative(),
  latestJob: processingJobSummarySchema.nullable(),
});

export const uploadDocumentResponseSchema = z.object({
  document: documentSummarySchema,
});

export const listDocumentsResponseSchema = z.object({
  documents: z.array(documentSummarySchema),
  pagination: z.object({
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }),
});

export const documentDetailResponseSchema = z.object({
  document: documentDetailSchema,
});

export const documentStatusResponseSchema = z.object({
  status: z.object({
    documentId: z.string().uuid(),
    status: z.enum(documentStatusValues),
    processingVersion: z.number().int().positive(),
    chunkCount: z.number().int().nonnegative(),
    pageCount: z.number().int().nullable(),
    errorMessage: z.string().nullable(),
    processedAt: z.string().nullable(),
    updatedAt: z.string(),
    latestJob: processingJobSummarySchema.nullable(),
  }),
});

export const reprocessDocumentResponseSchema = z.object({
  document: documentSummarySchema,
  job: processingJobSummarySchema,
});

export const deleteDocumentResponseSchema = z.object({
  deleted: z.literal(true),
  documentId: z.string().uuid(),
});
