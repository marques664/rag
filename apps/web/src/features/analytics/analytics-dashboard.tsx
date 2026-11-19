'use client';

import {
  Activity,
  BarChart3,
  BookOpenCheck,
  Coins,
  FileText,
  Gauge,
  MessageSquareText,
  RefreshCw,
  ThumbsUp,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { useAuth } from '@/components/providers/auth-provider';
import { DocumentStatusBadge } from '@/components/ui/status-badge';
import { apiClient } from '@/lib/api/client';
import type {
  AnalyticsOverview,
  ConversationSummary,
  DocumentSummary,
  PerformanceAnalytics,
  QualityAnalytics,
  UsageAnalytics,
} from '@/lib/api/types';
import {
  formatDateTime,
  formatDurationMs,
  formatNumber,
  formatPercent,
  formatUsd,
  getErrorMessage,
} from '@/lib/format';

const PERIOD_OPTIONS = [7, 30, 90] as const;

export function AnalyticsDashboard() {
  const { activeOrganizationId } = useAuth();

  const [days, setDays] = useState<number>(30);
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [usage, setUsage] = useState<UsageAnalytics | null>(null);
  const [performance, setPerformance] = useState<PerformanceAnalytics | null>(
    null,
  );
  const [quality, setQuality] = useState<QualityAnalytics | null>(null);
  const [recentDocs, setRecentDocs] = useState<DocumentSummary[]>([]);
  const [recentConversations, setRecentConversations] = useState<
    ConversationSummary[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAnalyticsData = useCallback(
    async (orgId: string, periodDays: number) => {
      const [
        overviewRes,
        usageRes,
        perfRes,
        qualityRes,
        docsRes,
        convsRes,
      ] = await Promise.all([
        apiClient.analytics.overview(),
        apiClient.analytics.usage(periodDays),
        apiClient.analytics.performance(periodDays),
        apiClient.analytics.quality(periodDays),
        apiClient.documents.list({ page: 1, limit: 5 }),
        apiClient.conversations.list({ page: 1, limit: 5 }),
      ]);
      void orgId;
      return {
        overview: overviewRes.overview,
        usage: usageRes.usage,
        performance: perfRes.performance,
        quality: qualityRes.quality,
        recentDocs: docsRes.documents,
        recentConversations: convsRes.conversations,
      };
    },
    [],
  );

  const loadAnalytics = useCallback(async () => {
    if (!activeOrganizationId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAnalyticsData(activeOrganizationId, days);
      setOverview(data.overview);
      setUsage(data.usage);
      setPerformance(data.performance);
      setQuality(data.quality);
      setRecentDocs(data.recentDocs);
      setRecentConversations(data.recentConversations);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load analytics dashboard'));
    } finally {
      setLoading(false);
    }
  }, [activeOrganizationId, days, fetchAnalyticsData]);

  useEffect(() => {
    if (!activeOrganizationId) return;
    let cancelled = false;

    const run = async () => {
      try {
        const data = await fetchAnalyticsData(activeOrganizationId, days);
        if (cancelled) return;
        setOverview(data.overview);
        setUsage(data.usage);
        setPerformance(data.performance);
        setQuality(data.quality);
        setRecentDocs(data.recentDocs);
        setRecentConversations(data.recentConversations);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(getErrorMessage(err, 'Failed to load analytics dashboard'));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [activeOrganizationId, days, fetchAnalyticsData]);

  const maxDailyTokens = Math.max(
    1,
    ...(usage?.daily.map((d) => d.totalTokens) ?? [0]),
  );

  return (
    <AppShell
      title="Analytics & Overview"
      description="Monitor indexed knowledge, RAG latency, token costs, and answer quality for the active tenant."
      actions={
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 text-xs font-semibold">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setDays(opt)}
                className={`rounded-md px-2.5 py-1 transition ${
                  days === opt
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {opt}d
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={() => void loadAnalytics()}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
            />
            Refresh
          </button>
        </div>
      }
    >
      <div className="mx-auto max-w-7xl space-y-6">
        {error ? (
          <div
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
          >
            {error}
          </div>
        ) : null}

        {loading && !overview ? (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[0, 1, 2, 3].map((idx) => (
                <div
                  key={idx}
                  className="animate-pulse rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex items-center justify-between">
                    <div className="h-3 w-28 rounded bg-slate-200" />
                    <div className="h-8 w-8 rounded-xl bg-slate-200" />
                  </div>
                  <div className="mt-4 h-7 w-20 rounded bg-slate-200" />
                  <div className="mt-2 h-3 w-36 rounded bg-slate-100" />
                </div>
              ))}
            </div>
          </div>
        ) : overview ? (
          <>
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div
                className="animate-fade-in-up rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md"
                style={{ animationDelay: '0ms' }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Documents & Chunks
                  </span>
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                    <FileText className="h-4 w-4" />
                  </div>
                </div>
                <p className="mt-3 text-2xl font-bold text-slate-900">
                  {formatNumber(overview.documents.total)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {formatNumber(overview.documents.completed)} completed ·{' '}
                  {formatNumber(overview.documents.totalChunks)} chunks
                </p>
              </div>

              <div
                className="animate-fade-in-up rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md"
                style={{ animationDelay: '60ms' }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Token Usage & Cost
                  </span>
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
                    <Coins className="h-4 w-4" />
                  </div>
                </div>
                <p className="mt-3 text-2xl font-bold text-slate-900">
                  {formatNumber(overview.usage.totalTokens)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Est. cost {formatUsd(overview.usage.estimatedCostUsd)} ·{' '}
                  {formatNumber(overview.usage.totalEvents)} events
                </p>
              </div>

              <div
                className="animate-fade-in-up rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md"
                style={{ animationDelay: '120ms' }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    RAG Latency
                  </span>
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                    <Gauge className="h-4 w-4" />
                  </div>
                </div>
                <p className="mt-3 text-2xl font-bold text-slate-900">
                  {formatDurationMs(overview.performance.avgLatencyMs)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  P95 {formatDurationMs(overview.performance.p95LatencyMs)} ·{' '}
                  {formatNumber(overview.conversations.total)} chats
                </p>
              </div>

              <div
                className="animate-fade-in-up rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md"
                style={{ animationDelay: '180ms' }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Answer Quality
                  </span>
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                    <ThumbsUp className="h-4 w-4" />
                  </div>
                </div>
                <p className="mt-3 text-2xl font-bold text-slate-900">
                  {formatPercent(overview.quality.positiveFeedbackRate)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {overview.quality.positiveFeedback} up /{' '}
                  {overview.quality.negativeFeedback} down ·{' '}
                  {formatPercent(overview.quality.insufficientContextRate)}{' '}
                  insufficient
                </p>
              </div>
            </section>

            <div className="grid gap-6 lg:grid-cols-12">
              <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-7">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5 text-indigo-600" />
                    <h2 className="text-base font-semibold text-slate-900">
                      Daily Token Usage ({days}d)
                    </h2>
                  </div>
                  {usage ? (
                    <span className="text-xs text-slate-500">
                      {formatNumber(usage.totals.totalTokens)} tokens ·{' '}
                      {formatUsd(usage.totals.estimatedCostUsd)}
                    </span>
                  ) : null}
                </div>

                {!usage || usage.daily.length === 0 ? (
                  <p className="mt-6 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-xs text-slate-500">
                    No usage events recorded in the last {days} days. Ask a
                    question in AI Chat to generate usage telemetry.
                  </p>
                ) : (
                  <div className="mt-6 space-y-2.5">
                    {usage.daily.slice(-14).map((entry) => {
                      const widthPercent = Math.max(
                        4,
                        Math.round((entry.totalTokens / maxDailyTokens) * 100),
                      );
                      return (
                        <div
                          key={entry.date}
                          className="grid grid-cols-12 items-center gap-3 text-xs"
                        >
                          <span className="col-span-3 font-mono text-slate-600 sm:col-span-2">
                            {entry.date.slice(5)}
                          </span>
                          <div className="col-span-6 h-3 overflow-hidden rounded-full bg-slate-100 sm:col-span-7">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-indigo-600 transition-all duration-700 ease-out"
                              style={{ width: `${widthPercent}%` }}
                            />
                          </div>
                          <span className="col-span-3 text-right font-mono text-slate-700">
                            {formatNumber(entry.totalTokens)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {usage && usage.byModel.length > 0 ? (
                  <div className="mt-6 border-t border-slate-200 pt-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Usage by Model
                    </h3>
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="text-slate-500">
                          <tr>
                            <th className="py-1.5">Model</th>
                            <th className="py-1.5 text-right">Events</th>
                            <th className="py-1.5 text-right">Tokens</th>
                            <th className="py-1.5 text-right">Est. Cost</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {usage.byModel.map((m) => (
                            <tr key={m.model}>
                              <td className="py-2 font-mono font-medium text-slate-900">
                                {m.model}
                              </td>
                              <td className="py-2 text-right text-slate-600">
                                {formatNumber(m.events)}
                              </td>
                              <td className="py-2 text-right text-slate-600">
                                {formatNumber(m.totalTokens)}
                              </td>
                              <td className="py-2 text-right font-mono text-slate-700">
                                {formatUsd(m.estimatedCostUsd)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
              </section>

              <div className="space-y-6 lg:col-span-5">
                <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-center gap-2">
                    <Activity className="h-5 w-5 text-indigo-600" />
                    <h2 className="text-base font-semibold text-slate-900">
                      Performance ({days}d)
                    </h2>
                  </div>

                  {performance ? (
                    <div className="mt-4 space-y-4">
                      <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3 text-xs">
                        <div>
                          <span className="text-slate-500">P50 Latency</span>
                          <p className="mt-0.5 font-semibold text-slate-900">
                            {formatDurationMs(performance.p50LatencyMs)}
                          </p>
                        </div>
                        <div>
                          <span className="text-slate-500">P95 Latency</span>
                          <p className="mt-0.5 font-semibold text-slate-900">
                            {formatDurationMs(performance.p95LatencyMs)}
                          </p>
                        </div>
                        <div>
                          <span className="text-slate-500">Avg Latency</span>
                          <p className="mt-0.5 font-semibold text-slate-900">
                            {formatDurationMs(performance.avgLatencyMs)}
                          </p>
                        </div>
                        <div>
                          <span className="text-slate-500">Max Latency</span>
                          <p className="mt-0.5 font-semibold text-slate-900">
                            {formatDurationMs(performance.maxLatencyMs)}
                          </p>
                        </div>
                      </div>

                      {performance.byOperation.length > 0 ? (
                        <div className="divide-y divide-slate-100 text-xs">
                          {performance.byOperation.map((op) => (
                            <div
                              key={op.operation}
                              className="flex items-center justify-between py-2"
                            >
                              <div>
                                <p className="font-medium text-slate-900">
                                  {op.operation}
                                </p>
                                <p className="text-[11px] text-slate-500">
                                  {formatNumber(op.events)} events
                                </p>
                              </div>
                              <span className="font-mono font-semibold text-slate-700">
                                {formatDurationMs(op.avgLatencyMs)} avg
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </section>

                <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-center gap-2">
                    <BookOpenCheck className="h-5 w-5 text-indigo-600" />
                    <h2 className="text-base font-semibold text-slate-900">
                      Grounding & Quality ({days}d)
                    </h2>
                  </div>

                  {quality ? (
                    <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                      <div className="rounded-xl bg-slate-50 p-3">
                        <span className="text-slate-500">Grounded Answers</span>
                        <p className="mt-1 text-base font-bold text-slate-900">
                          {formatNumber(quality.groundedAnswerCount)}
                        </p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3">
                        <span className="text-slate-500">
                          Insufficient Context
                        </span>
                        <p className="mt-1 text-base font-bold text-slate-900">
                          {formatNumber(quality.insufficientContextCount)} (
                          {formatPercent(quality.insufficientContextRate)})
                        </p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3">
                        <span className="text-slate-500">
                          Citations / Answer
                        </span>
                        <p className="mt-1 text-base font-bold text-slate-900">
                          {quality.avgCitationsPerGroundedAnswer.toFixed(2)}
                        </p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3">
                        <span className="text-slate-500">
                          Feedback Positive
                        </span>
                        <p className="mt-1 text-base font-bold text-slate-900">
                          {formatPercent(quality.feedback.positiveRate)}
                        </p>
                      </div>
                    </div>
                  ) : null}
                </section>
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-indigo-600" />
                    <h2 className="text-sm font-semibold text-slate-900">
                      Recent Documents
                    </h2>
                  </div>
                  <Link
                    href="/documents"
                    className="text-xs font-semibold text-indigo-600 hover:text-indigo-700"
                  >
                    View all
                  </Link>
                </div>

                {recentDocs.length === 0 ? (
                  <p className="mt-4 text-xs text-slate-500">
                    No documents uploaded yet.
                  </p>
                ) : (
                  <div className="mt-3 divide-y divide-slate-100">
                    {recentDocs.map((doc) => (
                      <div
                        key={doc.id}
                        className="flex items-center justify-between gap-3 py-2.5 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-900">
                            {doc.filename}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            {formatDateTime(doc.updatedAt)}
                          </p>
                        </div>
                        <DocumentStatusBadge status={doc.status} />
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <MessageSquareText className="h-4 w-4 text-indigo-600" />
                    <h2 className="text-sm font-semibold text-slate-900">
                      Recent Conversations
                    </h2>
                  </div>
                  <Link
                    href="/chat"
                    className="text-xs font-semibold text-indigo-600 hover:text-indigo-700"
                  >
                    Open chat
                  </Link>
                </div>

                {recentConversations.length === 0 ? (
                  <p className="mt-4 text-xs text-slate-500">
                    No conversations yet.
                  </p>
                ) : (
                  <div className="mt-3 divide-y divide-slate-100">
                    {recentConversations.map((conv) => (
                      <Link
                        key={conv.id}
                        href="/chat"
                        className="flex items-center justify-between gap-3 py-2.5 text-xs hover:bg-slate-50"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-900">
                            {conv.title || 'Untitled conversation'}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            {formatDateTime(conv.updatedAt)}
                          </p>
                        </div>
                        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-700">
                          {conv.messageCount} msgs
                        </span>
                      </Link>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
