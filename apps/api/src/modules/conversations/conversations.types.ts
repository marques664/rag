import type { MessageRole } from '@enterprise-ai/database';
import type { Citation, UsageInformation } from '@enterprise-ai/shared';

export interface MessageTokenUsageDto {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ConversationSummaryDto {
  id: string;
  organizationId: string;
  userId: string;
  title: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface MessageDto {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  insufficientContext: boolean;
  tokenUsage: MessageTokenUsageDto | null;
  citations: Citation[];
  createdAt: string;
}

export interface CreateConversationInput {
  organizationId: string;
  userId: string;
  title?: string;
}

export interface ListConversationsQuery {
  page: number;
  limit: number;
}

export interface ListConversationsResult {
  conversations: ConversationSummaryDto[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ListMessagesQuery {
  page: number;
  limit: number;
}

export interface ListMessagesResult {
  conversationId: string;
  messages: MessageDto[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface SendMessageInput {
  conversationId: string;
  organizationId: string;
  userId: string;
  content: string;
  topK?: number;
}

export interface SendMessageResult {
  conversationId: string;
  userMessage: MessageDto;
  assistantMessage: MessageDto;
  citations: Citation[];
  usage: UsageInformation | null;
  insufficientContext: boolean;
}
