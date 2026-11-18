import {
  DEFAULT_CHUNK_OVERLAP_TOKENS,
  DEFAULT_CHUNK_SIZE_TOKENS,
} from '@enterprise-ai/shared';
import { describe, expect, it } from 'vitest';
import {
  estimateTokenCount,
  PageAwareTokenChunker,
} from '../src/services/chunker.service.js';

function buildRepeatedSentences(count: number, prefix: string): string {
  const sentences: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    sentences.push(
      `${prefix} sentence number ${i} explains the operational guideline clearly.`,
    );
  }
  return sentences.join(' ');
}

describe('chunker.service', () => {
  it('validates constructor options', () => {
    expect(() => new PageAwareTokenChunker({ chunkSizeTokens: 0 })).toThrow();
    expect(() => new PageAwareTokenChunker({ overlapTokens: -1 })).toThrow();
    expect(
      () =>
        new PageAwareTokenChunker({
          chunkSizeTokens: 100,
          overlapTokens: 100,
        }),
    ).toThrow();
  });

  it('splits a long page into ~500-token chunks with ~75-token overlap', () => {
    const chunker = new PageAwareTokenChunker();
    const longPage = buildRepeatedSentences(120, 'Alpha');

    const chunks = chunker.chunkDocument({
      pages: [{ pageNumber: 1, text: longPage }],
      totalPages: 1,
      filename: 'manual.pdf',
      processingJobId: 'job-1',
    });

    expect(chunks.length).toBeGreaterThan(2);

    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i];
      expect(chunk).toBeDefined();
      if (!chunk) {
        continue;
      }
      expect(chunk.pageNumber).toBe(1);
      expect(chunk.chunkIndex).toBe(i);
      expect(chunk.tokenCount).toBeLessThanOrEqual(DEFAULT_CHUNK_SIZE_TOKENS);
      expect(chunk.tokenCount).toBeGreaterThan(0);
      expect(chunk.metadata).toMatchObject({
        filename: 'manual.pdf',
        pageNumber: 1,
        totalPages: 1,
        chunkIndex: i,
        tokenCount: chunk.tokenCount,
        processingJobId: 'job-1',
      });
    }

    // Verify consecutive chunks share overlapping content (~75 tokens).
    const first = chunks[0];
    const second = chunks[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first && second) {
      const tailWords = first.content.split(/\s+/).slice(-15);
      const overlapMatches = tailWords.filter((word) =>
        second.content.includes(word),
      );
      expect(overlapMatches.length).toBeGreaterThan(5);
      expect(DEFAULT_CHUNK_OVERLAP_TOKENS).toBe(75);
    }
  });

  it('preserves 1-based page numbers, skips empty pages, and assigns sequential chunkIndex', () => {
    const chunker = new PageAwareTokenChunker({
      chunkSizeTokens: 100,
      overlapTokens: 20,
    });

    const chunks = chunker.chunkDocument({
      pages: [
        { pageNumber: 1, text: buildRepeatedSentences(15, 'PageOne') },
        { pageNumber: 2, text: '   ' },
        { pageNumber: 3, text: buildRepeatedSentences(15, 'PageThree') },
      ],
      totalPages: 3,
      filename: 'guide.pdf',
      processingJobId: 'job-2',
    });

    const pageOneChunks = chunks.filter((c) => c.pageNumber === 1);
    const pageTwoChunks = chunks.filter((c) => c.pageNumber === 2);
    const pageThreeChunks = chunks.filter((c) => c.pageNumber === 3);

    expect(pageOneChunks.length).toBeGreaterThanOrEqual(2);
    expect(pageTwoChunks).toHaveLength(0);
    expect(pageThreeChunks.length).toBeGreaterThanOrEqual(2);

    expect(chunks.map((c) => c.chunkIndex)).toEqual(
      chunks.map((_, idx) => idx),
    );
  });

  it('splits oversized single tokens safely without exceeding chunk size', () => {
    const chunker = new PageAwareTokenChunker({
      chunkSizeTokens: 50,
      overlapTokens: 10,
    });

    const hugeUnspacedToken = 'A'.repeat(1000);
    const chunks = chunker.chunkDocument({
      pages: [{ pageNumber: 1, text: hugeUnspacedToken }],
      totalPages: 1,
      filename: 'blob.pdf',
      processingJobId: 'job-3',
    });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(estimateTokenCount(chunk.content)).toBeLessThanOrEqual(50);
    }
  });
});
