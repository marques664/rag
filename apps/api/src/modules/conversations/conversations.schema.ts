import {
  MAX_RETRIEVAL_TOP_K,
  RETRIEVAL_STRATEGIES,
} from '@enterprise-ai/shared';
import { z } from 'zod';

const messageRoleValues = ['USER', 'ASSISTANT'] as const;

export const conversationOrganizationHeaderSchema = z.object({
  'x-organization-id': z.string().uuid(),
});

export const conversationParamsSchema = z.object({
  id: z.string().uuid(),
});

export const createConversationBodySchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
});

export const listConversationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const listMessagesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const sendMessageBodySchema = z.object({
  content: z.string().trim().min(1).max(4000),
  topK: z.coerce.number().int().min(1).max(MAX_RETRIEVAL_TOP_K).optional(),
  strategy: z.enum(RETRIEVAL_STRATEGIES).optional(),
});

export const citationSchema = z.object({
  chunkId: z.string().uuid(),
  documentId: z.string().uuid(),
  filename: z.string(),
  pageNumber: z.number().int().positive(),
  chunkIndex: z.number().int().nonnegative(),
  relevanceScore: z.number().nullable(),
  excerpt: z.string(),
});

export const messageTokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});

export const ragStageLatenciesSchema = z.object({
  embeddingMs: z.number().int().nonnegative(),
  retrievalMs: z.number().int().nonnegative(),
  rerankMs: z.number().int().nonnegative(),
  generationMs: z.number().int().nonnegative(),
});

export const usageInformationSchema = z.object({
  model: z.string(),
  embeddingModel: z.string(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  embeddingInputTokens: z.number().int().nonnegative().optional(),
  latencyMs: z.number().int().nonnegative(),
  estimatedCost: z.number().nullable(),
  stageLatencies: ragStageLatenciesSchema.optional(),
});

export const conversationSummarySchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  userId: z.string().uuid(),
  title: z.string().nullable(),
  messageCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const messageSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  role: z.enum(messageRoleValues),
  content: z.string(),
  insufficientContext: z.boolean(),
  tokenUsage: messageTokenUsageSchema.nullable(),
  citations: z.array(citationSchema),
  createdAt: z.string(),
});

export const paginationSchema = z.object({
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});

export const createConversationResponseSchema = z.object({
  conversation: conversationSummarySchema,
});

export const listConversationsResponseSchema = z.object({
  conversations: z.array(conversationSummarySchema),
  pagination: paginationSchema,
});

export const getConversationResponseSchema = z.object({
  conversation: conversationSummarySchema,
});

export const deleteConversationResponseSchema = z.object({
  deleted: z.literal(true),
  conversationId: z.string().uuid(),
});

export const listMessagesResponseSchema = z.object({
  conversationId: z.string().uuid(),
  messages: z.array(messageSchema),
  pagination: paginationSchema,
});

export const sendMessageResponseSchema = z.object({
  conversationId: z.string().uuid(),
  userMessage: messageSchema,
  assistantMessage: messageSchema,
  citations: z.array(citationSchema),
  usage: usageInformationSchema.nullable(),
  insufficientContext: z.boolean(),
});
