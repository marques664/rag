import {
  FeedbackRating,
  MessageRole,
  type DatabaseClient,
  type MessageFeedback,
} from '@enterprise-ai/database';

export interface OwnedMessageTarget {
  id: string;
  role: MessageRole;
}

/**
 * Tenant- and owner-aware repository for assistant message feedback.
 */
export class FeedbackRepository {
  constructor(private readonly db: DatabaseClient) {}

  async findOwnedMessage(params: {
    messageId: string;
    organizationId: string;
    userId: string;
  }): Promise<OwnedMessageTarget | null> {
    return this.db.message.findFirst({
      where: {
        id: params.messageId,
        conversation: {
          organizationId: params.organizationId,
          userId: params.userId,
        },
      },
      select: {
        id: true,
        role: true,
      },
    });
  }

  async upsertFeedback(params: {
    messageId: string;
    userId: string;
    rating: FeedbackRating;
    comment: string | null;
  }): Promise<MessageFeedback> {
    return this.db.messageFeedback.upsert({
      where: {
        messageId_userId: {
          messageId: params.messageId,
          userId: params.userId,
        },
      },
      create: {
        messageId: params.messageId,
        userId: params.userId,
        rating: params.rating,
        comment: params.comment,
      },
      update: {
        rating: params.rating,
        comment: params.comment,
      },
    });
  }
}
