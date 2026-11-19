import { AIInvalidResponseError } from '@enterprise-ai/ai';
import type { Citation, RetrievedChunk } from '@enterprise-ai/shared';
import { z } from 'zod';
import type { StructuredLLMOutput } from './rag.types.js';

const DEFAULT_MAX_EXCERPT_CHARS = 240;

const structuredLLMOutputSchema = z.object({
  answer: z.string().trim().min(1),
  insufficientContext: z.boolean(),
  citedChunkIds: z.array(z.string().trim().min(1)).default([]),
});

function stripOptionalCodeFences(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('```')) {
    return trimmed;
  }

  return trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

/**
 * Parses and validates the JSON payload returned by the LLM provider.
 */
export function parseStructuredLLMResponse(
  rawContent: string,
): StructuredLLMOutput {
  const candidate = stripOptionalCodeFences(rawContent);

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(candidate);
  } catch (error) {
    throw new AIInvalidResponseError(
      'rag',
      'LLM returned non-JSON structured response',
      error,
    );
  }

  const validated = structuredLLMOutputSchema.safeParse(parsedJson);
  if (!validated.success) {
    throw new AIInvalidResponseError(
      'rag',
      'LLM response JSON does not match expected RAG schema',
    );
  }

  return validated.data;
}

export function buildCitationExcerpt(
  content: string,
  maxChars = DEFAULT_MAX_EXCERPT_CHARS,
): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(1, maxChars - 3)).trimEnd()}...`;
}

/**
 * Deterministically validates cited chunk IDs against the retrieved chunks for
 * the current query and constructs citations strictly from database metadata.
 */
export function validateCitations(params: {
  insufficientContext: boolean;
  citedChunkIds: readonly string[];
  chunksById: ReadonlyMap<string, RetrievedChunk>;
  maxExcerptChars?: number;
}): Citation[] {
  if (params.insufficientContext) {
    return [];
  }

  const seenChunkIds = new Set<string>();
  const citations: Citation[] = [];

  for (const rawId of params.citedChunkIds) {
    const chunkId = rawId.trim();
    if (!chunkId || seenChunkIds.has(chunkId)) {
      continue;
    }

    const chunk = params.chunksById.get(chunkId);
    if (!chunk) {
      // Discard fabricated, out-of-scope, or cross-tenant chunk IDs.
      continue;
    }

    seenChunkIds.add(chunkId);
    citations.push({
      chunkId: chunk.chunkId,
      documentId: chunk.documentId,
      filename: chunk.filename,
      pageNumber: chunk.pageNumber,
      chunkIndex: chunk.chunkIndex,
      relevanceScore: Number.isFinite(chunk.similarity)
        ? Number(chunk.similarity.toFixed(6))
        : null,
      excerpt: buildCitationExcerpt(chunk.content, params.maxExcerptChars),
    });
  }

  return citations;
}
