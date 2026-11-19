import { DocumentStatus, FeedbackRating } from '@enterprise-ai/database';
import type {
  AnalyticsOverview,
  PerformanceAnalytics,
  PerformanceByOperationEntry,
  QualityAnalytics,
  UsageAnalytics,
  UsageByModelEntry,
  UsageDailyEntry,
} from '@enterprise-ai/shared';
import type {
  AnalyticsRepository,
  UsageEventSample,
} from './analytics.repository.js';

function toFiniteNumber(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (
    value !== null &&
    typeof value === 'object' &&
    'toNumber' in value &&
    typeof (value as { toNumber: unknown }).toNumber === 'function'
  ) {
    const parsed = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function roundUsd(value: number): number {
  return Number(value.toFixed(8));
}

function roundMetric(value: number): number {
  return Number(value.toFixed(4));
}

function computePercentile(
  sortedAsc: readonly number[],
  percentile: number,
): number | null {
  if (sortedAsc.length === 0) {
    return null;
  }
  if (sortedAsc.length === 1) {
    return sortedAsc[0] ?? null;
  }

  const index = (sortedAsc.length - 1) * percentile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const lowerVal = sortedAsc[lower] ?? 0;
  const upperVal = sortedAsc[upper] ?? lowerVal;

  if (lower === upper) {
    return Number(lowerVal.toFixed(2));
  }

  const interpolated = lowerVal + (upperVal - lowerVal) * (index - lower);
  return Number(interpolated.toFixed(2));
}

function computeLatencySummary(events: readonly UsageEventSample[]) {
  if (events.length === 0) {
    return {
      avgLatencyMs: null,
      p50LatencyMs: null,
      p95LatencyMs: null,
      maxLatencyMs: null,
    };
  }

  const latencies = events
    .map((event) => event.latencyMs)
    .sort((a, b) => a - b);
  const sum = latencies.reduce((acc, value) => acc + value, 0);

  return {
    avgLatencyMs: Number((sum / latencies.length).toFixed(2)),
    p50LatencyMs: computePercentile(latencies, 0.5),
    p95LatencyMs: computePercentile(latencies, 0.95),
    maxLatencyMs: latencies[latencies.length - 1] ?? null,
  };
}

function computePeriodStart(days: number): Date {
  const now = new Date();
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export class AnalyticsService {
  constructor(private readonly repository: AnalyticsRepository) {}

  async getOverview(organizationId: string): Promise<AnalyticsOverview> {
    const raw = await this.repository.fetchOverviewData(organizationId);

    const statusMap = new Map<DocumentStatus, number>();
    for (const item of raw.documentStatusCounts) {
      statusMap.set(item.status, item.count);
    }

    const completed = statusMap.get(DocumentStatus.COMPLETED) ?? 0;
    const pending = statusMap.get(DocumentStatus.PENDING) ?? 0;
    const processing = statusMap.get(DocumentStatus.PROCESSING) ?? 0;
    const failed = statusMap.get(DocumentStatus.FAILED) ?? 0;
    const totalDocs = completed + pending + processing + failed;

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let estimatedCostUsd = 0;

    for (const event of raw.usageEvents) {
      totalInputTokens += event.inputTokens;
      totalOutputTokens += event.outputTokens;
      estimatedCostUsd += toFiniteNumber(event.estimatedCost);
    }

    const latencySummary = computeLatencySummary(raw.usageEvents);

    const feedbackMap = new Map<FeedbackRating, number>();
    for (const item of raw.feedbackRatingCounts) {
      feedbackMap.set(item.rating, item.count);
    }

    const positiveFeedback = feedbackMap.get(FeedbackRating.UP) ?? 0;
    const negativeFeedback = feedbackMap.get(FeedbackRating.DOWN) ?? 0;
    const totalFeedback = positiveFeedback + negativeFeedback;

    const insufficientContextRate =
      raw.assistantMessagesTotal > 0
        ? roundMetric(
            raw.assistantMessagesInsufficient / raw.assistantMessagesTotal,
          )
        : 0;

    const positiveFeedbackRate =
      totalFeedback > 0 ? roundMetric(positiveFeedback / totalFeedback) : null;

    return {
      organizationId,
      documents: {
        total: totalDocs,
        completed,
        pending,
        processing,
        failed,
        totalChunks: raw.totalChunks,
      },
      conversations: {
        total: raw.totalConversations,
        totalMessages: raw.totalMessages,
      },
      usage: {
        totalEvents: raw.usageEvents.length,
        totalInputTokens,
        totalOutputTokens,
        totalTokens: totalInputTokens + totalOutputTokens,
        estimatedCostUsd: roundUsd(estimatedCostUsd),
      },
      performance: {
        avgLatencyMs: latencySummary.avgLatencyMs,
        p95LatencyMs: latencySummary.p95LatencyMs,
      },
      quality: {
        totalAssistantMessages: raw.assistantMessagesTotal,
        insufficientContextCount: raw.assistantMessagesInsufficient,
        insufficientContextRate,
        totalFeedback,
        positiveFeedback,
        negativeFeedback,
        positiveFeedbackRate,
      },
    };
  }

  async getUsage(
    organizationId: string,
    periodDays: number,
  ): Promise<UsageAnalytics> {
    const since = computePeriodStart(periodDays);
    const events = await this.repository.fetchUsageEventsSince(
      organizationId,
      since,
    );

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCost = 0;

    const byModelMap = new Map<string, UsageByModelEntry>();
    const dailyMap = new Map<string, UsageDailyEntry>();

    for (const event of events) {
      const eventCost = toFiniteNumber(event.estimatedCost);
      const eventTotalTokens = event.inputTokens + event.outputTokens;
      totalInputTokens += event.inputTokens;
      totalOutputTokens += event.outputTokens;
      totalCost += eventCost;

      const modelEntry = byModelMap.get(event.model) ?? {
        model: event.model,
        events: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
      };
      modelEntry.events += 1;
      modelEntry.inputTokens += event.inputTokens;
      modelEntry.outputTokens += event.outputTokens;
      modelEntry.totalTokens += eventTotalTokens;
      modelEntry.estimatedCostUsd = roundUsd(
        modelEntry.estimatedCostUsd + eventCost,
      );
      byModelMap.set(event.model, modelEntry);

      const dateKey = event.createdAt.toISOString().slice(0, 10);
      const dayEntry = dailyMap.get(dateKey) ?? {
        date: dateKey,
        events: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
      };
      dayEntry.events += 1;
      dayEntry.inputTokens += event.inputTokens;
      dayEntry.outputTokens += event.outputTokens;
      dayEntry.totalTokens += eventTotalTokens;
      dayEntry.estimatedCostUsd = roundUsd(
        dayEntry.estimatedCostUsd + eventCost,
      );
      dailyMap.set(dateKey, dayEntry);
    }

    const byModel = Array.from(byModelMap.values()).sort(
      (a, b) => b.totalTokens - a.totalTokens || a.model.localeCompare(b.model),
    );
    const daily = Array.from(dailyMap.values()).sort((a, b) =>
      a.date.localeCompare(b.date),
    );

    return {
      organizationId,
      periodDays,
      totals: {
        events: events.length,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        totalTokens: totalInputTokens + totalOutputTokens,
        estimatedCostUsd: roundUsd(totalCost),
      },
      byModel,
      daily,
    };
  }

  async getPerformance(
    organizationId: string,
    periodDays: number,
  ): Promise<PerformanceAnalytics> {
    const since = computePeriodStart(periodDays);
    const events = await this.repository.fetchUsageEventsSince(
      organizationId,
      since,
    );
    const overall = computeLatencySummary(events);

    interface OperationBucket {
      operation: string;
      events: number;
      sumLatencyMs: number;
      minLatencyMs: number;
      maxLatencyMs: number;
    }

    const opMap = new Map<string, OperationBucket>();
    for (const event of events) {
      const existing = opMap.get(event.operation);
      if (!existing) {
        opMap.set(event.operation, {
          operation: event.operation,
          events: 1,
          sumLatencyMs: event.latencyMs,
          minLatencyMs: event.latencyMs,
          maxLatencyMs: event.latencyMs,
        });
      } else {
        existing.events += 1;
        existing.sumLatencyMs += event.latencyMs;
        existing.minLatencyMs = Math.min(existing.minLatencyMs, event.latencyMs);
        existing.maxLatencyMs = Math.max(existing.maxLatencyMs, event.latencyMs);
      }
    }

    const byOperation: PerformanceByOperationEntry[] = Array.from(
      opMap.values(),
    )
      .map((bucket) => ({
        operation: bucket.operation,
        events: bucket.events,
        avgLatencyMs: Number((bucket.sumLatencyMs / bucket.events).toFixed(2)),
        minLatencyMs: bucket.minLatencyMs,
        maxLatencyMs: bucket.maxLatencyMs,
      }))
      .sort(
        (a, b) => b.events - a.events || a.operation.localeCompare(b.operation),
      );

    return {
      organizationId,
      periodDays,
      totalEvents: events.length,
      avgLatencyMs: overall.avgLatencyMs,
      p50LatencyMs: overall.p50LatencyMs,
      p95LatencyMs: overall.p95LatencyMs,
      maxLatencyMs: overall.maxLatencyMs,
      byOperation,
    };
  }

  async getQuality(
    organizationId: string,
    periodDays: number,
  ): Promise<QualityAnalytics> {
    const since = computePeriodStart(periodDays);
    const raw = await this.repository.fetchQualityDataSince(
      organizationId,
      since,
    );

    const groundedAnswerCount = Math.max(
      0,
      raw.totalAssistantMessages - raw.insufficientContextCount,
    );
    const insufficientContextRate =
      raw.totalAssistantMessages > 0
        ? roundMetric(raw.insufficientContextCount / raw.totalAssistantMessages)
        : 0;
    const avgCitationsPerGroundedAnswer =
      groundedAnswerCount > 0
        ? roundMetric(raw.totalCitations / groundedAnswerCount)
        : 0;

    const feedbackTotal = raw.feedbackUp + raw.feedbackDown;
    const positiveRate =
      feedbackTotal > 0 ? roundMetric(raw.feedbackUp / feedbackTotal) : null;

    return {
      organizationId,
      periodDays,
      totalAssistantMessages: raw.totalAssistantMessages,
      groundedAnswerCount,
      insufficientContextCount: raw.insufficientContextCount,
      insufficientContextRate,
      totalCitations: raw.totalCitations,
      avgCitationsPerGroundedAnswer,
      feedback: {
        total: feedbackTotal,
        up: raw.feedbackUp,
        down: raw.feedbackDown,
        positiveRate,
      },
    };
  }
}
