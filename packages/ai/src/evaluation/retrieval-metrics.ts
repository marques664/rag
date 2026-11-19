import type { RetrievalStrategy } from '@enterprise-ai/shared';

export interface RetrievalEvaluationCase {
  id: string;
  query: string;
  relevantChunkIds: readonly string[];
}

export interface StrategyRetrievalRun {
  caseId: string;
  retrievedChunkIds: readonly string[];
  latencyMs: number;
}

export interface CaseRetrievalMetrics {
  caseId: string;
  precisionAtK: number;
  recallAtK: number;
  reciprocalRank: number;
  hitAtK: boolean;
  latencyMs: number;
}

export interface StrategyBenchmarkSummary {
  strategy: RetrievalStrategy;
  topK: number;
  caseCount: number;
  meanPrecisionAtK: number;
  meanRecallAtK: number;
  meanReciprocalRank: number;
  hitRateAtK: number;
  avgLatencyMs: number;
  cases: CaseRetrievalMetrics[];
}

export function computePrecisionAtK(
  retrievedIds: readonly string[],
  relevantIds: ReadonlySet<string>,
  k: number,
): number {
  if (k <= 0) {
    return 0;
  }
  const topSlice = retrievedIds.slice(0, k);
  if (topSlice.length === 0) {
    return 0;
  }
  const hits = topSlice.filter((id) => relevantIds.has(id)).length;
  return Number((hits / topSlice.length).toFixed(4));
}

export function computeRecallAtK(
  retrievedIds: readonly string[],
  relevantIds: ReadonlySet<string>,
  k: number,
): number {
  if (relevantIds.size === 0) {
    return retrievedIds.slice(0, k).length === 0 ? 1 : 0;
  }
  const topSlice = retrievedIds.slice(0, k);
  const hits = topSlice.filter((id) => relevantIds.has(id)).length;
  return Number((hits / relevantIds.size).toFixed(4));
}

export function computeReciprocalRank(
  retrievedIds: readonly string[],
  relevantIds: ReadonlySet<string>,
  k: number,
): number {
  const topSlice = retrievedIds.slice(0, k);
  const index = topSlice.findIndex((id) => relevantIds.has(id));
  if (index === -1) {
    return 0;
  }
  return Number((1 / (index + 1)).toFixed(4));
}

/**
 * Evaluates a retrieval strategy across a labeled evaluation dataset using
 * Precision@K, Recall@K, MRR, HitRate@K, and average latency.
 */
export function summarizeStrategyBenchmark(params: {
  strategy: RetrievalStrategy;
  topK: number;
  dataset: readonly RetrievalEvaluationCase[];
  runs: readonly StrategyRetrievalRun[];
}): StrategyBenchmarkSummary {
  const runByCaseId = new Map(params.runs.map((run) => [run.caseId, run]));
  const cases: CaseRetrievalMetrics[] = params.dataset.map((item) => {
    const run = runByCaseId.get(item.id);
    const retrieved = run?.retrievedChunkIds ?? [];
    const relevantSet = new Set(item.relevantChunkIds);
    const precisionAtK = computePrecisionAtK(retrieved, relevantSet, params.topK);
    const recallAtK = computeRecallAtK(retrieved, relevantSet, params.topK);
    const reciprocalRank = computeReciprocalRank(
      retrieved,
      relevantSet,
      params.topK,
    );

    return {
      caseId: item.id,
      precisionAtK,
      recallAtK,
      reciprocalRank,
      hitAtK: reciprocalRank > 0 || (relevantSet.size === 0 && retrieved.length === 0),
      latencyMs: run?.latencyMs ?? 0,
    };
  });

  const n = cases.length || 1;
  return {
    strategy: params.strategy,
    topK: params.topK,
    caseCount: cases.length,
    meanPrecisionAtK: Number(
      (cases.reduce((acc, c) => acc + c.precisionAtK, 0) / n).toFixed(4),
    ),
    meanRecallAtK: Number(
      (cases.reduce((acc, c) => acc + c.recallAtK, 0) / n).toFixed(4),
    ),
    meanReciprocalRank: Number(
      (cases.reduce((acc, c) => acc + c.reciprocalRank, 0) / n).toFixed(4),
    ),
    hitRateAtK: Number(
      (cases.filter((c) => c.hitAtK).length / n).toFixed(4),
    ),
    avgLatencyMs: Number(
      (cases.reduce((acc, c) => acc + c.latencyMs, 0) / n).toFixed(2),
    ),
    cases,
  };
}
