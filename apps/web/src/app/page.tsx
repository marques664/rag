'use client';

import {
  ArrowRight,
  BookOpenCheck,
  Building2,
  FileText,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/components/providers/auth-provider';

export default function HomePage() {
  const router = useRouter();
  const { isLoading, isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace('/analytics');
    }
  }, [isLoading, isAuthenticated, router]);

  if (isLoading || isAuthenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3 animate-fade-in">
          <div className="h-9 w-9 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
          <p className="text-xs font-medium text-slate-500">Preparing workspace...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-50 via-slate-50 to-sky-50/70 px-6 py-16">
      <div className="mx-auto w-full max-w-5xl animate-fade-in-up rounded-3xl border border-slate-200/90 bg-white/95 p-8 shadow-lg shadow-slate-200/50 backdrop-blur sm:p-12">
        <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50/90 px-3.5 py-1 text-xs font-semibold text-indigo-700">
          <ShieldCheck className="h-3.5 w-3.5" />
          Multi-Tenant RAG Knowledge Platform
        </div>

        <h1 className="mt-5 text-3xl font-bold tracking-tight text-slate-900 sm:text-5xl">
          Enterprise Knowledge{' '}
          <span className="bg-gradient-to-r from-indigo-600 to-sky-600 bg-clip-text text-transparent">
            AI
          </span>
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-600">
          Upload internal PDF manuals and rulebooks, track asynchronous indexing
          in real time, and ask grounded questions with verifiable page and chunk
          citations isolated per organization.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            href="/login"
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-indigo-200 transition-all duration-200 hover:-translate-y-0.5 hover:bg-indigo-700 hover:shadow-md active:scale-[0.98]"
          >
            Sign in
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/register"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-400 hover:bg-slate-50 active:scale-[0.98]"
          >
            Create free workspace
          </Link>
          <span className="inline-flex items-center gap-1.5 px-2 text-xs text-slate-500">
            <Sparkles className="h-3.5 w-3.5 text-indigo-500" />
            PostgreSQL FTS + pgvector + RLS
          </span>
        </div>

        <div className="mt-10 grid gap-4 border-t border-slate-200/80 pt-8 sm:grid-cols-3">
          <div
            className="animate-fade-in-up rounded-2xl border border-slate-100 bg-slate-50/80 p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-200 hover:bg-white hover:shadow-sm"
            style={{ animationDelay: '60ms' }}
          >
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600">
              <Building2 className="h-5 w-5" />
            </div>
            <h2 className="mt-3.5 text-sm font-semibold text-slate-900">
              1. Tenant Isolation + RLS
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              Switch organizations via{' '}
              <code className="rounded bg-white px-1 py-0.5 font-mono text-[11px] ring-1 ring-slate-200">
                x-organization-id
              </code>{' '}
              backed by RBAC and PostgreSQL Row-Level Security.
            </p>
          </div>

          <div
            className="animate-fade-in-up rounded-2xl border border-slate-100 bg-slate-50/80 p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-200 hover:bg-white hover:shadow-sm"
            style={{ animationDelay: '120ms' }}
          >
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-sky-100 text-sky-600">
              <FileText className="h-5 w-5" />
            </div>
            <h2 className="mt-3.5 text-sm font-semibold text-slate-900">
              2. Async PDF Ingestion
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              Drag-and-drop PDF upload to MinIO, BullMQ worker chunking, and
              PostgreSQL FTS + pgvector indexing with live status tracking.
            </p>
          </div>

          <div
            className="animate-fade-in-up rounded-2xl border border-slate-100 bg-slate-50/80 p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-200 hover:bg-white hover:shadow-sm"
            style={{ animationDelay: '180ms' }}
          >
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600">
              <BookOpenCheck className="h-5 w-5" />
            </div>
            <h2 className="mt-3.5 text-sm font-semibold text-slate-900">
              3. Grounded Citations
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              Every AI answer cites exact document pages and chunks, tracks
              token usage and latencies, and collects user feedback.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
