'use client';

import { ChevronDown, FileText } from 'lucide-react';
import { useState } from 'react';
import type { Citation } from '@/lib/api/types';

export function CitationCard({
  citation,
  index,
}: {
  citation: Citation;
  index: number;
}) {
  const [expanded, setExpanded] = useState(false);

  const scorePercent =
    citation.relevanceScore !== null && Number.isFinite(citation.relevanceScore)
      ? `${Math.round(citation.relevanceScore * 100)}%`
      : null;

  return (
    <div
      className="animate-fade-in-up rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-200 hover:bg-white hover:shadow-xs"
      style={{ animationDelay: `${Math.min(index, 6) * 45}ms` }}
    >
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className="flex w-full items-start justify-between gap-2 text-left"
      >
        <div className="flex min-w-0 items-start gap-2">
          <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-indigo-100 font-mono text-[11px] font-semibold text-indigo-700">
            {index + 1}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <FileText className="h-3.5 w-3.5 shrink-0 text-indigo-600" />
              <span className="truncate font-semibold text-slate-900">
                {citation.filename}
              </span>
              <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-600 ring-1 ring-slate-200">
                p.{citation.pageNumber} · chunk #{citation.chunkIndex}
              </span>
            </div>

            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {scorePercent ? (
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
                  Relevance {scorePercent}
                </span>
              ) : null}
              {citation.matchedBy?.map((source) => (
                <span
                  key={source}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${
                    source === 'semantic'
                      ? 'bg-indigo-50 text-indigo-700 ring-indigo-200'
                      : 'bg-amber-50 text-amber-700 ring-amber-200'
                  }`}
                >
                  {source}
                </span>
              ))}
            </div>
          </div>
        </div>

        <span className="mt-0.5 shrink-0 text-slate-400">
          <ChevronDown
            className={`h-4 w-4 transition-transform duration-200 ${
              expanded ? 'rotate-180 text-indigo-600' : ''
            }`}
          />
        </span>
      </button>

      {expanded ? (
        <blockquote className="animate-fade-in mt-2.5 rounded-r-lg border-l-2 border-indigo-400 bg-white p-2.5 text-xs leading-relaxed text-slate-700 shadow-2xs">
          {citation.excerpt}
        </blockquote>
      ) : (
        <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-slate-600">
          {citation.excerpt}
        </p>
      )}
    </div>
  );
}
