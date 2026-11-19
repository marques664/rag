export type FeedbackRatingValue = 'UP' | 'DOWN';

export interface MessageFeedbackDto {
  id: string;
  messageId: string;
  userId: string;
  rating: FeedbackRatingValue;
  comment: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface AnalyticsOverview {
  organizationId: string;
  documents: {
    total: number;
    completed: number;
    pending: number;
    processing: number;
    failed: number;
    totalChunks: number;
  };
  conversations: {
    total: number;
    totalMessages: number;
  };
  usage: {
    totalEvents: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  };
  performance: {
    avgLatencyMs: number | null;
    p95LatencyMs: number | null;
  };
  quality: {
    totalAssistantMessages: number;
    insufficientContextCount: number;
    insufficientContextRate: number;
    totalFeedback: number;
    positiveFeedback: number;
    negativeFeedback: number;
    positiveFeedbackRate: number | null;
  };
}

export interface UsageByModelEntry {
  model: string;
  events: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface UsageDailyEntry {
  date: string;
  events: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface UsageAnalytics {
  organizationId: string;
  periodDays: number;
  totals: {
    events: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  };
  byModel: UsageByModelEntry[];
  daily: UsageDailyEntry[];
}

export interface PerformanceByOperationEntry {
  operation: string;
  events: number;
  avgLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
}

export interface PerformanceAnalytics {
  organizationId: string;
  periodDays: number;
  totalEvents: number;
  avgLatencyMs: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  maxLatencyMs: number | null;
  byOperation: PerformanceByOperationEntry[];
}

export interface QualityAnalytics {
  organizationId: string;
  periodDays: number;
  totalAssistantMessages: number;
  groundedAnswerCount: number;
  insufficientContextCount: number;
  insufficientContextRate: number;
  totalCitations: number;
  avgCitationsPerGroundedAnswer: number;
  feedback: {
    total: number;
    up: number;
    down: number;
    positiveRate: number | null;
  };
}
