import {
  MessageRole,
  Prisma,
  type Conversation,
  type DatabaseClient,
  type Message,
} from '@enterprise-ai/database';
import type { RAGResponse } from '@enterprise-ai/shared';

export interface ConversationWithCountRecord {
  conversation: Conversation;
  messageCount: number;
}

export interface MessageWithCitationsRecord {
  message: Message;
  citations: Array<{
    chunkId: string;
    documentId: string;
    filename: string;
    pageNumber: number;
    chunkIndex: number;
    relevanceScore: number | null;
    content: string;
  }>;
}

function deriveConversationTitle(question: string): string {
  const collapsed = question.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= 80) {
    return collapsed;
  }
  return `${collapsed.slice(0, 77).trimEnd()}...`;
}

/**
 * Tenant- and owner-aware repository for conversations, messages, citations, and usage events.
 * Every conversation query enforces both `organizationId` and `userId` directly in PostgreSQL.
 */
export class ConversationsRepository {
  constructor(private readonly db: DatabaseClient) {}

  async create(params: {
    organizationId: string;
    userId: string;
    title?: string;
  }): Promise<ConversationWithCountRecord> {
    const conversation = await this.db.conversation.create({
      data: {
        organizationId: params.organizationId,
        userId: params.userId,
        title: params.title ?? null,
      },
    });

    return {
      conversation,
      messageCount: 0,
    };
  }

  async listByOwner(params: {
    organizationId: string;
    userId: string;
    page: number;
    limit: number;
  }): Promise<{ conversations: ConversationWithCountRecord[]; total: number }> {
    const where = {
      organizationId: params.organizationId,
      userId: params.userId,
    };

    const skip = (params.page - 1) * params.limit;

    const [records, total] = await Promise.all([
      this.db.conversation.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: params.limit,
        include: {
          _count: {
            select: { messages: true },
          },
        },
      }),
      this.db.conversation.count({ where }),
    ]);

    return {
      conversations: records.map(({ _count, ...conversation }) => ({
        conversation,
        messageCount: _count.messages,
      })),
      total,
    };
  }

  async findByIdForOwner(params: {
    conversationId: string;
    organizationId: string;
    userId: string;
  }): Promise<ConversationWithCountRecord | null> {
    const record = await this.db.conversation.findFirst({
      where: {
        id: params.conversationId,
        organizationId: params.organizationId,
        userId: params.userId,
      },
      include: {
        _count: {
          select: { messages: true },
        },
      },
    });

    if (!record) {
      return null;
    }

    const { _count, ...conversation } = record;
    return {
      conversation,
      messageCount: _count.messages,
    };
  }

  async existsForOwner(params: {
    conversationId: string;
    organizationId: string;
    userId: string;
  }): Promise<boolean> {
    const record = await this.db.conversation.findFirst({
      where: {
        id: params.conversationId,
        organizationId: params.organizationId,
        userId: params.userId,
      },
      select: { id: true },
    });

    return record !== null;
  }

  async deleteByIdForOwner(params: {
    conversationId: string;
    organizationId: string;
    userId: string;
  }): Promise<boolean> {
    const deleted = await this.db.conversation.deleteMany({
      where: {
        id: params.conversationId,
        organizationId: params.organizationId,
        userId: params.userId,
      },
    });

    return deleted.count === 1;
  }

  async listMessagesForOwner(params: {
    conversationId: string;
    organizationId: string;
    userId: string;
    page: number;
    limit: number;
  }): Promise<{
    found: boolean;
    messages: MessageWithCitationsRecord[];
    total: number;
  }> {
    const exists = await this.existsForOwner({
      conversationId: params.conversationId,
      organizationId: params.organizationId,
      userId: params.userId,
    });

    if (!exists) {
      return { found: false, messages: [], total: 0 };
    }

    const where = {
      conversationId: params.conversationId,
      conversation: {
        organizationId: params.organizationId,
        userId: params.userId,
      },
    };

    const skip = (params.page - 1) * params.limit;

    const [records, total] = await Promise.all([
      this.db.message.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip,
        take: params.limit,
        include: {
          citations: {
            orderBy: { createdAt: 'asc' },
            include: {
              chunk: {
                select: {
                  id: true,
                  documentId: true,
                  pageNumber: true,
                  chunkIndex: true,
                  content: true,
                  document: {
                    select: {
                      filename: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),
      this.db.message.count({ where }),
    ]);

    return {
      found: true,
      messages: records.map(({ citations, ...message }) => ({
        message,
        citations: citations.map((citation) => ({
          chunkId: citation.chunk.id,
          documentId: citation.chunk.documentId,
          filename: citation.chunk.document.filename,
          pageNumber: citation.chunk.pageNumber,
          chunkIndex: citation.chunk.chunkIndex,
          relevanceScore: citation.relevanceScore,
          content: citation.chunk.content,
        })),
      })),
      total,
    };
  }

  async persistRagTurnTransaction(params: {
    conversationId: string;
    organizationId: string;
    userId: string;
    question: string;
    ragResponse: RAGResponse;
  }): Promise<{
    userMessage: Message;
    assistantMessage: Message;
  } | null> {
    return this.db.$transaction(async (tx) => {
      const existing = await tx.conversation.findFirst({
        where: {
          id: params.conversationId,
          organizationId: params.organizationId,
          userId: params.userId,
        },
        select: {
          id: true,
          title: true,
        },
      });

      if (!existing) {
        return null;
      }

      const userMessage = await tx.message.create({
        data: {
          conversationId: params.conversationId,
          role: MessageRole.USER,
          content: params.question,
          insufficientContext: false,
        },
      });

      const usage = params.ragResponse.usage;
      const tokenUsagePayload: Prisma.InputJsonValue | typeof Prisma.JsonNull =
        usage
          ? {
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              totalTokens: usage.totalTokens,
            }
          : Prisma.JsonNull;

      const assistantMessage = await tx.message.create({
        data: {
          conversationId: params.conversationId,
          role: MessageRole.ASSISTANT,
          content: params.ragResponse.answer,
          insufficientContext: params.ragResponse.insufficientContext,
          tokenUsage: tokenUsagePayload,
        },
      });

      if (params.ragResponse.citations.length > 0) {
        await tx.messageCitation.createMany({
          data: params.ragResponse.citations.map((citation) => ({
            messageId: assistantMessage.id,
            chunkId: citation.chunkId,
            relevanceScore: citation.relevanceScore,
          })),
        });
      }

      if (usage) {
        const operation =
          params.ragResponse.insufficientContext &&
          usage.totalTokens === 0
            ? 'rag_retrieval_empty'
            : 'rag_query';

        await tx.usageEvent.create({
          data: {
            organizationId: params.organizationId,
            userId: params.userId,
            conversationId: params.conversationId,
            messageId: assistantMessage.id,
            operation,
            model: usage.model,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            latencyMs: usage.latencyMs,
            estimatedCost: usage.estimatedCost,
          },
        });
      }

      await tx.conversation.update({
        where: { id: params.conversationId },
        data: {
          updatedAt: new Date(),
          ...(existing.title === null
            ? { title: deriveConversationTitle(params.question) }
            : {}),
        },
      });

      return {
        userMessage,
        assistantMessage,
      };
    });
  }
}
