import { z } from 'zod';

export const analyticsOrganizationHeaderSchema = z.object({
  'x-organization-id': z.string().uuid(),
});

export const analyticsPeriodQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
});

export const analyticsOverviewResponseSchema = z.object({
  overview: z.object({
    organizationId: z.string().uuid(),
    documents: z.object({
      total: z.number().int().nonnegative(),
      completed: z.number().int().nonnegative(),
      pending: z.number().int().nonnegative(),
      processing: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
      totalChunks: z.number().int().nonnegative(),
    }),
    conversations: z.object({
      total: z.number().int().nonnegative(),
      totalMessages: z.number().int().nonnegative(),
    }),
    usage: z.object({
      totalEvents: z.number().int().nonnegative(),
      totalInputTokens: z.number().int().nonnegative(),
      totalOutputTokens: z.number().int().nonnegative(),
      totalTokens: z.number().int().nonnegative(),
      estimatedCostUsd: z.number().nonnegative(),
    }),
    performance: z.object({
      avgLatencyMs: z.number().nullable(),
      p95LatencyMs: z.number().nullable(),
    }),
    quality: z.object({
      totalAssistantMessages: z.number().int().nonnegative(),
      insufficientContextCount: z.number().int().nonnegative(),
      insufficientContextRate: z.number(),
      totalFeedback: z.number().int().nonnegative(),
      positiveFeedback: z.number().int().nonnegative(),
      negativeFeedback: z.number().int().nonnegative(),
      positiveFeedbackRate: z.number().nullable(),
    }),
  }),
});

export const usageAnalyticsResponseSchema = z.object({
  usage: z.object({
    organizationId: z.string().uuid(),
    periodDays: z.number().int().positive(),
    totals: z.object({
      events: z.number().int().nonnegative(),
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      totalTokens: z.number().int().nonnegative(),
      estimatedCostUsd: z.number().nonnegative(),
    }),
    byModel: z.array(
      z.object({
        model: z.string(),
        events: z.number().int().nonnegative(),
        inputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
        totalTokens: z.number().int().nonnegative(),
        estimatedCostUsd: z.number().nonnegative(),
      }),
    ),
    daily: z.array(
      z.object({
        date: z.string(),
        events: z.number().int().nonnegative(),
        inputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
        totalTokens: z.number().int().nonnegative(),
        estimatedCostUsd: z.number().nonnegative(),
      }),
    ),
  }),
});

export const performanceAnalyticsResponseSchema = z.object({
  performance: z.object({
    organizationId: z.string().uuid(),
    periodDays: z.number().int().positive(),
    totalEvents: z.number().int().nonnegative(),
    avgLatencyMs: z.number().nullable(),
    p50LatencyMs: z.number().nullable(),
    p95LatencyMs: z.number().nullable(),
    maxLatencyMs: z.number().nullable(),
    byOperation: z.array(
      z.object({
        operation: z.string(),
        events: z.number().int().nonnegative(),
        avgLatencyMs: z.number(),
        minLatencyMs: z.number(),
        maxLatencyMs: z.number(),
      }),
    ),
  }),
});

export const qualityAnalyticsResponseSchema = z.object({
  quality: z.object({
    organizationId: z.string().uuid(),
    periodDays: z.number().int().positive(),
    totalAssistantMessages: z.number().int().nonnegative(),
    groundedAnswerCount: z.number().int().nonnegative(),
    insufficientContextCount: z.number().int().nonnegative(),
    insufficientContextRate: z.number(),
    totalCitations: z.number().int().nonnegative(),
    avgCitationsPerGroundedAnswer: z.number(),
    feedback: z.object({
      total: z.number().int().nonnegative(),
      up: z.number().int().nonnegative(),
      down: z.number().int().nonnegative(),
      positiveRate: z.number().nullable(),
    }),
  }),
});
