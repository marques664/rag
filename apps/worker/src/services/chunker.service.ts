import {
  DEFAULT_CHUNK_OVERLAP_TOKENS,
  DEFAULT_CHUNK_SIZE_TOKENS,
  type DocumentChunkMetadata,
} from '@enterprise-ai/shared';
import type { ExtractedPage } from './pdf-extractor.service.js';

export interface ChunkerOptions {
  chunkSizeTokens?: number;
  overlapTokens?: number;
}

export interface ChunkDocumentInput {
  pages: ExtractedPage[];
  totalPages: number;
  filename: string;
  processingJobId: string;
}

export interface GeneratedChunk {
  content: string;
  pageNumber: number;
  chunkIndex: number;
  tokenCount: number;
  metadata: DocumentChunkMetadata;
}

export interface DocumentChunker {
  chunkDocument(input: ChunkDocumentInput): GeneratedChunk[];
}

interface TextSegment {
  text: string;
  joinerBefore: '' | ' ' | '\n\n';
  tokens: number;
}

const CHUNK_STRATEGY = 'page-token-window-v1';
const APPROX_CHARS_PER_TOKEN = 4;

/**
 * Deterministic, dependency-free token estimator calibrated for English/technical prose
 * (~4 chars per token per whitespace-delimited word).
 */
export function estimateTokenCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }

  const words = trimmed.split(/\s+/);
  let total = 0;
  for (const word of words) {
    total += Math.max(1, Math.ceil(word.length / APPROX_CHARS_PER_TOKEN));
  }
  return total;
}

function splitLongTextByChars(text: string, maxTokens: number): string[] {
  const maxChars = Math.max(APPROX_CHARS_PER_TOKEN, maxTokens * APPROX_CHARS_PER_TOKEN);
  const slices: string[] = [];
  for (let offset = 0; offset < text.length; offset += maxChars) {
    slices.push(text.slice(offset, offset + maxChars));
  }
  return slices;
}

function segmentPageText(pageText: string, maxTokens: number): TextSegment[] {
  const paragraphs = pageText
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  const segments: TextSegment[] = [];

  for (let pIndex = 0; pIndex < paragraphs.length; pIndex += 1) {
    const paragraph = paragraphs[pIndex];
    if (!paragraph) {
      continue;
    }

    const sentences = paragraph
      .split(/(?<=[.!?])\s+|\n+/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length > 0);

    for (let sIndex = 0; sIndex < sentences.length; sIndex += 1) {
      const sentence = sentences[sIndex];
      if (!sentence) {
        continue;
      }

      const baseJoiner: '' | ' ' | '\n\n' =
        segments.length === 0 ? '' : sIndex === 0 ? '\n\n' : ' ';

      const sentenceTokens = estimateTokenCount(sentence);
      if (sentenceTokens <= maxTokens) {
        segments.push({
          text: sentence,
          joinerBefore: baseJoiner,
          tokens: sentenceTokens,
        });
        continue;
      }

      const words = sentence.split(/\s+/).filter((word) => word.length > 0);
      let firstWordInSentence = true;

      for (const word of words) {
        const wordTokens = estimateTokenCount(word);
        if (wordTokens <= maxTokens) {
          segments.push({
            text: word,
            joinerBefore:
              segments.length === 0
                ? ''
                : firstWordInSentence
                  ? baseJoiner
                  : ' ',
            tokens: wordTokens,
          });
          firstWordInSentence = false;
          continue;
        }

        const slices = splitLongTextByChars(word, maxTokens);
        for (const slice of slices) {
          segments.push({
            text: slice,
            joinerBefore:
              segments.length === 0
                ? ''
                : firstWordInSentence
                  ? baseJoiner
                  : ' ',
            tokens: estimateTokenCount(slice),
          });
          firstWordInSentence = false;
        }
      }
    }
  }

  return segments;
}

function joinSegments(segments: TextSegment[]): string {
  let result = '';
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    if (!segment) {
      continue;
    }
    if (i > 0) {
      result += segment.joinerBefore || ' ';
    }
    result += segment.text;
  }
  return result;
}

/**
 * Splits extracted PDF pages into ~500-token chunks with ~75-token overlap,
 * preserving exact 1-based page numbers and sequential document-wide chunk indices.
 */
export class PageAwareTokenChunker implements DocumentChunker {
  private readonly chunkSizeTokens: number;
  private readonly overlapTokens: number;

  constructor(options: ChunkerOptions = {}) {
    const chunkSizeTokens =
      options.chunkSizeTokens ?? DEFAULT_CHUNK_SIZE_TOKENS;
    const overlapTokens =
      options.overlapTokens ?? DEFAULT_CHUNK_OVERLAP_TOKENS;

    if (chunkSizeTokens <= 0) {
      throw new Error('chunkSizeTokens must be positive');
    }
    if (overlapTokens < 0 || overlapTokens >= chunkSizeTokens) {
      throw new Error(
        'overlapTokens must be >= 0 and strictly less than chunkSizeTokens',
      );
    }

    this.chunkSizeTokens = chunkSizeTokens;
    this.overlapTokens = overlapTokens;
  }

  public chunkDocument(input: ChunkDocumentInput): GeneratedChunk[] {
    const chunks: GeneratedChunk[] = [];
    let nextChunkIndex = 0;

    for (const page of input.pages) {
      const normalized = page.text.trim();
      if (!normalized) {
        continue;
      }

      const pageChunks = this.chunkSinglePage(normalized);
      for (const pageChunk of pageChunks) {
        const chunkIndex = nextChunkIndex;
        nextChunkIndex += 1;

        chunks.push({
          content: pageChunk.content,
          pageNumber: page.pageNumber,
          chunkIndex,
          tokenCount: pageChunk.tokenCount,
          metadata: {
            filename: input.filename,
            pageNumber: page.pageNumber,
            totalPages: input.totalPages,
            chunkIndex,
            tokenCount: pageChunk.tokenCount,
            charCount: pageChunk.content.length,
            charStart: pageChunk.charStart,
            charEnd: pageChunk.charEnd,
            strategy: CHUNK_STRATEGY,
            processingJobId: input.processingJobId,
          },
        });
      }
    }

    return chunks;
  }

  private chunkSinglePage(
    pageText: string,
  ): Array<{
    content: string;
    tokenCount: number;
    charStart: number;
    charEnd: number;
  }> {
    const segments = segmentPageText(pageText, this.chunkSizeTokens);
    if (segments.length === 0) {
      return [];
    }

    const result: Array<{
      content: string;
      tokenCount: number;
      charStart: number;
      charEnd: number;
    }> = [];

    let startIndex = 0;
    let searchCursor = 0;

    while (startIndex < segments.length) {
      let endIndex = startIndex;
      let windowTokens = 0;

      while (endIndex < segments.length) {
        const candidate = segments[endIndex];
        if (!candidate) {
          break;
        }
        const nextTokens = windowTokens + candidate.tokens;
        if (endIndex > startIndex && nextTokens > this.chunkSizeTokens) {
          break;
        }
        windowTokens = nextTokens;
        endIndex += 1;
      }

      const content = joinSegments(segments.slice(startIndex, endIndex));
      const tokenCount = estimateTokenCount(content);

      const firstSegmentText = segments[startIndex]?.text ?? '';
      const foundStart = pageText.indexOf(firstSegmentText, searchCursor);
      const charStart = foundStart >= 0 ? foundStart : searchCursor;
      const charEnd = charStart + content.length;

      result.push({
        content,
        tokenCount,
        charStart,
        charEnd,
      });

      if (endIndex >= segments.length) {
        break;
      }

      // Compute next window start index so ~overlapTokens are repeated at the start
      // of the next chunk, while guaranteeing forward progress of at least 1 segment.
      let overlapStart = endIndex;
      let overlapAccumulated = 0;

      for (let i = endIndex - 1; i > startIndex; i -= 1) {
        const seg = segments[i];
        if (!seg) {
          break;
        }
        if (overlapAccumulated + seg.tokens > this.overlapTokens) {
          if (overlapAccumulated === 0 && seg.tokens <= this.overlapTokens) {
            overlapStart = i;
          }
          break;
        }
        overlapAccumulated += seg.tokens;
        overlapStart = i;
      }

      const nextStartIndex = Math.max(startIndex + 1, overlapStart);
      if (nextStartIndex < endIndex) {
        searchCursor = Math.max(0, charStart);
      } else {
        searchCursor = Math.min(pageText.length, charEnd);
      }

      startIndex = nextStartIndex;
    }

    return result;
  }
}
