import { AIProviderError } from '@enterprise-ai/ai';
import type { Message } from '@enterprise-ai/database';
import type { Citation } from '@enterprise-ai/shared';
import { buildCitationExcerpt } from '../rag/citation-validator.js';
import {
  AiProviderNotConfiguredAppError,
  AiProviderUnavailableError,
} from '../rag/rag.errors.js';
import type { RagService } from '../rag/rag.service.js';
import { ConversationNotFoundError } from './conversations.errors.js';
import type {
  ConversationsRepository,
  ConversationWithCountRecord,
  MessageWithCitationsRecord,
} from './conversations.repository.js';
import type {
  ConversationSummaryDto,
  CreateConversationInput,
  ListConversationsQuery,
  ListConversationsResult,
  ListMessagesQuery,
  ListMessagesResult,
  MessageDto,
  MessageTokenUsageDto,
  SendMessageInput,
  SendMessageResult,
} from './conversations.types.js';

export interface ConversationsServiceLogger {
  error(context: Record<string, unknown>, message: string): void;
}

function parseTokenUsage(raw: unknown): MessageTokenUsageDto | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const record = raw as Record<string, unknown>;
  if (
    typeof record['inputTokens'] === 'number' &&
    typeof record['outputTokens'] === 'number' &&
    typeof record['totalTokens'] === 'number'
  ) {
    return {
      inputTokens: record['inputTokens'],
      outputTokens: record['outputTokens'],
      totalTokens: record['totalTokens'],
    };
  }

  return null;
}

function toConversationSummaryDto(
  record: ConversationWithCountRecord,
): ConversationSummaryDto {
  return {
    id: record.conversation.id,
    organizationId: record.conversation.organizationId,
    userId: record.conversation.userId,
    title: record.conversation.title,
    messageCount: record.messageCount,
    createdAt: record.conversation.createdAt.toISOString(),
    updatedAt: record.conversation.updatedAt.toISOString(),
  };
}

function toMessageDto(
  message: Message,
  citations: Citation[],
): MessageDto {
  return {
    id: message.id,
    conversationId: message.conversationId,
    role: message.role,
    content: message.content,
    insufficientContext: message.insufficientContext,
    tokenUsage: parseTokenUsage(message.tokenUsage),
    citations,
    createdAt: message.createdAt.toISOString(),
  };
}

function toHydratedMessageDto(record: MessageWithCitationsRecord): MessageDto {
  const citations: Citation[] = record.citations.map((item) => ({
    chunkId: item.chunkId,
    documentId: item.documentId,
    filename: item.filename,
    pageNumber: item.pageNumber,
    chunkIndex: item.chunkIndex,
    relevanceScore: item.relevanceScore,
    excerpt: buildCitationExcerpt(item.content),
  }));

  return toMessageDto(record.message, citations);
}

export class ConversationsService {
  constructor(
    private readonly repository: ConversationsRepository,
    private readonly ragService: Pick<RagService, 'answerQuestion'> | undefined,
    private readonly logger: ConversationsServiceLogger,
  ) {}

  async createConversation(
    input: CreateConversationInput,
  ): Promise<ConversationSummaryDto> {
    const created = await this.repository.create({
      organizationId: input.organizationId,
      userId: input.userId,
      title: input.title,
    });

    return toConversationSummaryDto(created);
  }

  async listConversations(
    organizationId: string,
    userId: string,
    query: ListConversationsQuery,
  ): Promise<ListConversationsResult> {
    const { conversations, total } = await this.repository.listByOwner({
      organizationId,
      userId,
      page: query.page,
      limit: query.limit,
    });

    const totalPages = total === 0 ? 0 : Math.ceil(total / query.limit);

    return {
      conversations: conversations.map(toConversationSummaryDto),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages,
      },
    };
  }

  async getConversation(
    conversationId: string,
    organizationId: string,
    userId: string,
  ): Promise<ConversationSummaryDto> {
    const record = await this.repository.findByIdForOwner({
      conversationId,
      organizationId,
      userId,
    });

    if (!record) {
      throw new ConversationNotFoundError();
    }

    return toConversationSummaryDto(record);
  }

  async deleteConversation(
    conversationId: string,
    organizationId: string,
    userId: string,
  ): Promise<void> {
    const deleted = await this.repository.deleteByIdForOwner({
      conversationId,
      organizationId,
      userId,
    });

    if (!deleted) {
      throw new ConversationNotFoundError();
    }
  }

  async listMessages(
    conversationId: string,
    organizationId: string,
    userId: string,
    query: ListMessagesQuery,
  ): Promise<ListMessagesResult> {
    const result = await this.repository.listMessagesForOwner({
      conversationId,
      organizationId,
      userId,
      page: query.page,
      limit: query.limit,
    });

    if (!result.found) {
      throw new ConversationNotFoundError();
    }

    const totalPages = result.total === 0 ? 0 : Math.ceil(result.total / query.limit);

    return {
      conversationId,
      messages: result.messages.map(toHydratedMessageDto),
      pagination: {
        page: query.page,
        limit: query.limit,
        total: result.total,
        totalPages,
      },
    };
  }

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    if (!this.ragService) {
      throw new AiProviderNotConfiguredAppError();
    }

    const exists = await this.repository.existsForOwner({
      conversationId: input.conversationId,
      organizationId: input.organizationId,
      userId: input.userId,
    });

    if (!exists) {
      throw new ConversationNotFoundError();
    }

    let ragResponse;
    try {
      ragResponse = await this.ragService.answerQuestion({
        organizationId: input.organizationId,
        question: input.content,
        topK: input.topK,
      });
    } catch (error) {
      if (error instanceof AIProviderError) {
        this.logger.error(
          {
            organizationId: input.organizationId,
            userId: input.userId,
            conversationId: input.conversationId,
            provider: error.provider,
            code: error.code,
            statusCode: error.statusCode,
            retryable: error.retryable,
            message: error.message,
          },
          'AI provider failure during RAG answer generation',
        );
        throw new AiProviderUnavailableError();
      }
      throw error;
    }

    const persisted = await this.repository.persistRagTurnTransaction({
      conversationId: input.conversationId,
      organizationId: input.organizationId,
      userId: input.userId,
      question: input.content,
      ragResponse,
    });

    if (!persisted) {
      throw new ConversationNotFoundError();
    }

    return {
      conversationId: input.conversationId,
      userMessage: toMessageDto(persisted.userMessage, []),
      assistantMessage: toMessageDto(
        persisted.assistantMessage,
        ragResponse.citations,
      ),
      citations: ragResponse.citations,
      usage: ragResponse.usage,
      insufficientContext: ragResponse.insufficientContext,
    };
  }
}
