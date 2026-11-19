import type { RetrievedChunk } from '@enterprise-ai/shared';
import { describe, expect, it } from 'vitest';
import { AIInvalidRequestError, HybridLexicalReranker } from '../src/index.js';

function makeChunk(
  overrides: Partial<RetrievedChunk> & { rrfScore?: number },
): RetrievedChunk & { rrfScore?: number } {
  return {
    chunkId: 'chunk-default',
    documentId: 'doc-1',
    filename: 'manual.pdf',
    pageNumber: 1,
    chunkIndex: 0,
    content: 'General operational guidelines.',
    tokenCount: 10,
    metadata: {
      pageNumber: 1,
      chunkIndex: 0,
      tokenCount: 10,
    },
    distance: 0.2,
    similarity: 0.8,
    ...overrides,
  };
}

describe('HybridLexicalReranker', () => {
  it('promotes chunks with stronger query term overlap and exact phrase matches', async () => {
    const reranker = new HybridLexicalReranker();

    const genericHighSim = makeChunk({
      chunkId: 'chunk-generic',
      similarity: 0.82,
      content:
        'Routine equipment inspection happens regularly in the facility.',
    });
    const exactMatchChunk = makeChunk({
      chunkId: 'chunk-exact',
      similarity: 0.76,
      content:
        'The recommended maintenance procedure for turbine X requires shutting down power and inspecting bearings.',
    });
    const partialMatchChunk = makeChunk({
      chunkId: 'chunk-partial',
      similarity: 0.78,
      content:
        'Follow the turbine checklist before starting any maintenance shift.',
    });

    const result = reranker.rerankDetailed(
      'maintenance procedure for turbine X',
      [genericHighSim, partialMatchChunk, exactMatchChunk],
    );

    expect(result.chunks.map((c) => c.chunkId)).toEqual([
      'chunk-exact',
      'chunk-partial',
      'chunk-generic',
    ]);
    expect(result.scores[0]?.exactPhraseBoost).toBe(1);
    expect(result.scores[0]?.lexicalOverlapScore).toBe(1);
    expect(result.scores[0]?.rerankScore).toBeGreaterThan(
      result.scores[1]!.rerankScore,
    );
  });

  it('normalizes RRF scores when present and preserves extra hybrid chunk metadata', async () => {
    const reranker = new HybridLexicalReranker();

    const chunkA = makeChunk({
      chunkId: 'chunk-a',
      similarity: 0.4,
      rrfScore: 0.016,
      content: 'Unrelated overview paragraph.',
    });
    const chunkB = makeChunk({
      chunkId: 'chunk-b',
      similarity: 0.5,
      rrfScore: 0.032,
      content: 'Política de retenção de documentos fiscais por 5 anos.',
    });

    const reranked = await reranker.rerank(
      'politica de retencao',
      [chunkA, chunkB],
      1,
    );

    expect(reranked).toHaveLength(1);
    expect(reranked[0]?.chunkId).toBe('chunk-b');
    expect(reranked[0]?.rrfScore).toBe(0.032);
  });

  it('handles empty chunks, blank queries, topK=0, and invalid topK/weights', async () => {
    const reranker = new HybridLexicalReranker();

    expect(await reranker.rerank('any query', [])).toEqual([]);
    expect(
      await reranker.rerank('any query', [makeChunk({ chunkId: 'c1' })], 0),
    ).toEqual([]);

    const c1 = makeChunk({ chunkId: 'c1', similarity: 0.7 });
    const c2 = makeChunk({ chunkId: 'c2', similarity: 0.9 });
    expect(
      (await reranker.rerank('   ', [c1, c2])).map((c) => c.chunkId),
    ).toEqual(['c1', 'c2']);

    await expect(
      reranker.rerank('query', [c1], -1),
    ).rejects.toThrow(AIInvalidRequestError);

    expect(
      () =>
        new HybridLexicalReranker({
          baseWeight: 0,
          lexicalWeight: 0,
          phraseWeight: 0,
        }),
    ).toThrow(AIInvalidRequestError);
  });
});
