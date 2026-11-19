import {
  DocumentStatus,
  FeedbackRating,
  MessageRole,
  type DatabaseClient,
} from '@enterprise-ai/database';

export interface UsageEventSample {
  model: string;
  operation: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  estimatedCost: unknown;
  createdAt: Date;
}

export interface OverviewRawData {
  documentStatusCounts: Array<{ status: DocumentStatus; count: number }>;
  totalChunks: number;
  totalConversations: number;
  totalMessages: number;
  assistantMessagesTotal: number;
  assistantMessagesInsufficient: number;
  feedbackRatingCounts: Array<{ rating: FeedbackRating; count: number }>;
  usageEvents: UsageEventSample[];
}

export interface QualityRawData {
  totalAssistantMessages: number;
  insufficientContextCount: number;
  totalCitations: number;
  feedbackUp: number;
  feedbackDown: number;
}

/**
 * Tenant-isolated repository for organization dashboard and analytics queries.
 * Every query scopes directly by `organizationId` in PostgreSQL.
 */
export class AnalyticsRepository {
  constructor(private readonly db: DatabaseClient) {}

  async fetchOverviewData(organizationId: string): Promise<OverviewRawData> {
    const [
      docGroups,
      totalChunks,
      totalConversations,
      totalMessages,
      assistantMessagesTotal,
      assistantMessagesInsufficient,
      feedbackGroups,
      usageEvents,
    ] = await Promise.all([
      this.db.document.groupBy({
        by: ['status'],
        where: { organizationId },
        _count: { _all: true },
      }),
      this.db.documentChunk.count({
        where: { organizationId },
      }),
      this.db.conversation.count({
        where: { organizationId },
      }),
      this.db.message.count({
        where: { conversation: { organizationId } },
      }),
      this.db.message.count({
        where: {
          role: MessageRole.ASSISTANT,
          conversation: { organizationId },
        },
      }),
      this.db.message.count({
        where: {
          role: MessageRole.ASSISTANT,
          insufficientContext: true,
          conversation: { organizationId },
        },
      }),
      this.db.messageFeedback.groupBy({
        by: ['rating'],
        where: {
          message: {
            conversation: { organizationId },
          },
        },
        _count: { _all: true },
      }),
      this.db.usageEvent.findMany({
        where: { organizationId },
        select: {
          model: true,
          operation: true,
          inputTokens: true,
          outputTokens: true,
          latencyMs: true,
          estimatedCost: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    return {
      documentStatusCounts: docGroups.map((group) => ({
        status: group.status,
        count: group._count._all,
      })),
      totalChunks,
      totalConversations,
      totalMessages,
      assistantMessagesTotal,
      assistantMessagesInsufficient,
      feedbackRatingCounts: feedbackGroups.map((group) => ({
        rating: group.rating,
        count: group._count._all,
      })),
      usageEvents,
    };
  }

  async fetchUsageEventsSince(
    organizationId: string,
    since: Date,
  ): Promise<UsageEventSample[]> {
    return this.db.usageEvent.findMany({
      where: {
        organizationId,
        createdAt: { gte: since },
      },
      select: {
        model: true,
        operation: true,
        inputTokens: true,
        outputTokens: true,
        latencyMs: true,
        estimatedCost: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async fetchQualityDataSince(
    organizationId: string,
    since: Date,
  ): Promise<QualityRawData> {
    const [
      totalAssistantMessages,
      insufficientContextCount,
      totalCitations,
      feedbackUp,
      feedbackDown,
    ] = await Promise.all([
      this.db.message.count({
        where: {
          role: MessageRole.ASSISTANT,
          createdAt: { gte: since },
          conversation: { organizationId },
        },
      }),
      this.db.message.count({
        where: {
          role: MessageRole.ASSISTANT,
          insufficientContext: true,
          createdAt: { gte: since },
          conversation: { organizationId },
        },
      }),
      this.db.messageCitation.count({
        where: {
          createdAt: { gte: since },
          message: {
            role: MessageRole.ASSISTANT,
            conversation: { organizationId },
          },
        },
      }),
      this.db.messageFeedback.count({
        where: {
          rating: FeedbackRating.UP,
          createdAt: { gte: since },
          message: {
            conversation: { organizationId },
          },
        },
      }),
      this.db.messageFeedback.count({
        where: {
          rating: FeedbackRating.DOWN,
          createdAt: { gte: since },
          message: {
            conversation: { organizationId },
          },
        },
      }),
    ]);

    return {
      totalAssistantMessages,
      insufficientContextCount,
      totalCitations,
      feedbackUp,
      feedbackDown,
    };
  }
}
