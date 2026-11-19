export type {
  AnalyticsOverview,
  PerformanceAnalytics,
  PerformanceByOperationEntry,
  QualityAnalytics,
  UsageAnalytics,
  UsageByModelEntry,
  UsageDailyEntry,
} from '@enterprise-ai/shared';

export interface AnalyticsPeriodQuery {
  days: number;
}
