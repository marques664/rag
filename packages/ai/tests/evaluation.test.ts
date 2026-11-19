import { describe, expect, it } from 'vitest';
import {
  computePrecisionAtK,
  computeRecallAtK,
  computeReciprocalRank,
  summarizeStrategyBenchmark,
} from '../src/evaluation/retrieval-metrics.js';

describe('RAG retrieval evaluation metrics', () => {
  it('computes Precision@K, Recall@K, and Reciprocal Rank accurately', () => {
    const relevant = new Set(['c2', 'c4']);
    const retrieved = ['c1', 'c2', 'c3', 'c4', 'c5'];

    expect(computePrecisionAtK(retrieved, relevant, 5)).toBe(0.4);
    expect(computeRecallAtK(retrieved, relevant, 5)).toBe(1);
    expect(computeReciprocalRank(retrieved, relevant, 5)).toBe(0.5);
    expect(computeReciprocalRank(['c9', 'c8'], relevant, 5)).toBe(0);
  });

  it('aggregates strategy benchmark summary across evaluation cases', () => {
    const summary = summarizeStrategyBenchmark({
      strategy: 'hybrid',
      topK: 3,
      dataset: [
        { id: 'q1', query: 'shirt rule', relevantChunkIds: ['c1'] },
        { id: 'q2', query: 'belt rule', relevantChunkIds: ['c2', 'c3'] },
      ],
      runs: [
        { caseId: 'q1', retrievedChunkIds: ['c1', 'c9'], latencyMs: 12 },
        { caseId: 'q2', retrievedChunkIds: ['c8', 'c2', 'c3'], latencyMs: 18 },
      ],
    });

    expect(summary.caseCount).toBe(2);
    expect(summary.meanRecallAtK).toBe(1);
    expect(summary.meanReciprocalRank).toBe(0.75);
    expect(summary.hitRateAtK).toBe(1);
    expect(summary.avgLatencyMs).toBe(15);
  });
});
