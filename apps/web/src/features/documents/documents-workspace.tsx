'use client';

import { MAX_DOCUMENT_FILE_SIZE_BYTES } from '@enterprise-ai/shared';
import {
  AlertCircle,
  Eye,
  FileText,
  Loader2,
  MessageSquareText,
  RefreshCw,
  RotateCcw,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
} from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { useAuth } from '@/components/providers/auth-provider';
import { DocumentStatusBadge } from '@/components/ui/status-badge';
import { useDocumentPolling } from '@/hooks/use-document-polling';
import { ApiClientError, apiClient } from '@/lib/api/client';
import type {
  DocumentDetail,
  DocumentStatus,
  DocumentSummary,
  Pagination,
} from '@/lib/api/types';
import { formatBytes, formatDateTime, getErrorMessage } from '@/lib/format';

const STATUS_FILTERS: Array<{ label: string; value: DocumentStatus | 'ALL' }> = [
  { label: 'All', value: 'ALL' },
  { label: 'Completed', value: 'COMPLETED' },
  { label: 'Processing', value: 'PROCESSING' },
  { label: 'Pending', value: 'PENDING' },
  { label: 'Failed', value: 'FAILED' },
];

export function DocumentsWorkspace() {
  const { activeOrganization, activeOrganizationId } = useAuth();
  return (
    <DocumentsWorkspaceInner
      key={activeOrganizationId ?? 'no-org'}
      activeOrganizationId={activeOrganizationId}
      role={activeOrganization?.role ?? null}
      organizationName={activeOrganization?.name ?? ''}
    />
  );
}

function DocumentsWorkspaceInner({
  activeOrganizationId,
  role,
  organizationName,
}: {
  activeOrganizationId: string | null;
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | null;
  organizationName: string;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });
  const [statusFilter, setStatusFilter] = useState<DocumentStatus | 'ALL'>('ALL');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [selectedDoc, setSelectedDoc] = useState<DocumentDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [confirmDeleteDoc, setConfirmDeleteDoc] =
    useState<DocumentSummary | null>(null);
  const [busyDocId, setBusyDocId] = useState<string | null>(null);

  const canManageDocuments = role === 'OWNER' || role === 'ADMIN';

  const fetchDocuments = useCallback(
    async (silent = false) => {
      if (!activeOrganizationId) return;
      if (!silent) setLoading(true);
      try {
        const res = await apiClient.documents.list({
          status: statusFilter === 'ALL' ? undefined : statusFilter,
          page,
          limit: 20,
        });
        setDocuments(res.documents);
        setPagination(res.pagination);
      } catch (err) {
        if (!silent) {
          setError(getErrorMessage(err, 'Failed to load documents'));
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [activeOrganizationId, statusFilter, page],
  );

  useEffect(() => {
    if (!activeOrganizationId) return;
    let cancelled = false;

    const run = async () => {
      try {
        const res = await apiClient.documents.list({
          status: statusFilter === 'ALL' ? undefined : statusFilter,
          page,
          limit: 20,
        });
        if (cancelled) return;
        setDocuments(res.documents);
        setPagination(res.pagination);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(getErrorMessage(err, 'Failed to load documents'));
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
  }, [activeOrganizationId, statusFilter, page]);

  const isPolling = useDocumentPolling(documents, () => fetchDocuments(true), 2500);

  const uploadFile = async (file: File) => {
    setError(null);
    setNotice(null);

    const isPdf =
      file.type === 'application/pdf' ||
      file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      setError('Only PDF files are supported for ingestion.');
      return;
    }
    if (file.size === 0) {
      setError('The selected file is empty.');
      return;
    }
    if (file.size > MAX_DOCUMENT_FILE_SIZE_BYTES) {
      setError(
        `File exceeds the maximum allowed size (${formatBytes(MAX_DOCUMENT_FILE_SIZE_BYTES)}).`,
      );
      return;
    }

    setUploading(true);
    try {
      const res = await apiClient.documents.upload(file);
      setNotice(
        `Uploaded "${res.document.filename}". Background worker ingestion queued.`,
      );
      setPage(1);
      await fetchDocuments(false);
    } catch (err) {
      if (err instanceof ApiClientError && err.statusCode === 429) {
        setError(
          `Rate limit reached (${err.message}). Please wait a moment before uploading again.`,
        );
      } else if (err instanceof ApiClientError && err.statusCode === 503) {
        setError(
          `Storage or queue service temporarily unavailable (${err.message}).`,
        );
      } else {
        setError(getErrorMessage(err, 'Failed to upload document'));
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files[0];
    if (file) {
      void uploadFile(file);
    }
  };

  const handleInspect = async (docId: string) => {
    setLoadingDetail(true);
    setError(null);
    try {
      const res = await apiClient.documents.getById(docId);
      setSelectedDoc(res.document);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load document details'));
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleReprocess = async (doc: DocumentSummary) => {
    setBusyDocId(doc.id);
    setError(null);
    setNotice(null);
    try {
      await apiClient.documents.reprocess(doc.id);
      setNotice(`Queued reprocessing for "${doc.filename}".`);
      await fetchDocuments(false);
      if (selectedDoc?.id === doc.id) {
        await handleInspect(doc.id);
      }
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to queue document reprocessing'));
    } finally {
      setBusyDocId(null);
    }
  };

  const handleDelete = async () => {
    if (!confirmDeleteDoc) return;
    setBusyDocId(confirmDeleteDoc.id);
    setError(null);
    setNotice(null);
    try {
      await apiClient.documents.delete(confirmDeleteDoc.id);
      setNotice(`Deleted "${confirmDeleteDoc.filename}".`);
      if (selectedDoc?.id === confirmDeleteDoc.id) {
        setSelectedDoc(null);
      }
      setConfirmDeleteDoc(null);
      await fetchDocuments(false);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to delete document'));
    } finally {
      setBusyDocId(null);
    }
  };

  return (
    <AppShell
      title="Document Library"
      description="Upload PDFs to MinIO, monitor asynchronous BullMQ chunking & pgvector indexing, and manage tenant documents."
      actions={
        <div className="flex items-center gap-2">
          {isPolling ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Live polling
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => void fetchDocuments(false)}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      }
    >
      <div className="mx-auto max-w-6xl space-y-6">
        {error ? (
          <div
            role="alert"
            className="animate-fade-in-up flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        {notice ? (
          <div className="animate-fade-in-up rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {notice}
          </div>
        ) : null}

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          className={`rounded-2xl border-2 border-dashed p-8 text-center transition-all duration-200 ${
            dragActive
              ? 'scale-[1.01] border-indigo-500 bg-indigo-50/80 shadow-md shadow-indigo-100/60'
              : 'border-slate-300 bg-white hover:border-indigo-300 hover:bg-slate-50/40'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadFile(file);
            }}
          />
          <div
            className={`mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 transition-transform duration-200 ${
              dragActive ? 'scale-110 bg-indigo-100' : ''
            }`}
          >
            {uploading ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <UploadCloud className="h-6 w-6" />
            )}
          </div>
          <h2 className="mt-3 text-sm font-semibold text-slate-900">
            {uploading
              ? 'Uploading PDF and queuing ingestion...'
              : 'Drag and drop a PDF document here'}
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Text-based PDFs up to {formatBytes(MAX_DOCUMENT_FILE_SIZE_BYTES)}.
            Chunks and search indexes are generated asynchronously.
          </p>
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:bg-indigo-700 active:scale-[0.98] disabled:opacity-60"
          >
            Select PDF file
          </button>
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div className="flex flex-wrap items-center gap-1.5">
              {STATUS_FILTERS.map((tab) => {
                const active = statusFilter === tab.value;
                return (
                  <button
                    key={tab.value}
                    type="button"
                    onClick={() => {
                      setStatusFilter(tab.value);
                      setPage(1);
                    }}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      active
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-slate-500">
              {pagination.total} document{pagination.total === 1 ? '' : 's'}
            </p>
          </div>

          {loading && documents.length === 0 ? (
            <div className="space-y-3 p-6">
              {[0, 1, 2].map((idx) => (
                <div
                  key={idx}
                  className="flex animate-pulse items-center justify-between gap-4 rounded-xl bg-slate-50 px-4 py-3.5"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-lg bg-slate-200" />
                    <div className="space-y-1.5">
                      <div className="h-3.5 w-44 rounded bg-slate-200" />
                      <div className="h-2.5 w-24 rounded bg-slate-200" />
                    </div>
                  </div>
                  <div className="h-5 w-20 rounded-full bg-slate-200" />
                </div>
              ))}
            </div>
          ) : documents.length === 0 ? (
            <div className="p-12 text-center">
              <FileText className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-3 text-sm font-medium text-slate-700">
                No documents found
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Upload a PDF above to start indexing knowledge for{' '}
                {organizationName || 'this organization'}.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Document</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Size</th>
                    <th className="px-4 py-3">Pages</th>
                    <th className="px-4 py-3">Updated</th>
                    <th className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {documents.map((doc) => (
                    <tr key={doc.id} className="hover:bg-slate-50/80">
                      <td className="px-5 py-3.5">
                        <div className="flex items-start gap-2.5">
                          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" />
                          <div className="min-w-0">
                            <p className="truncate font-medium text-slate-900">
                              {doc.filename}
                            </p>
                            {doc.errorMessage ? (
                              <p className="mt-0.5 text-xs text-rose-600">
                                {doc.errorMessage}
                              </p>
                            ) : (
                              <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                                v{doc.processingVersion} · {doc.id.slice(0, 8)}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <DocumentStatusBadge status={doc.status} />
                      </td>
                      <td className="px-4 py-3.5 text-xs text-slate-600">
                        {formatBytes(doc.fileSize)}
                      </td>
                      <td className="px-4 py-3.5 text-xs text-slate-600">
                        {doc.pageCount ?? '—'}
                      </td>
                      <td className="px-4 py-3.5 text-xs text-slate-500">
                        {formatDateTime(doc.updatedAt)}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <div className="inline-flex items-center gap-1">
                          {doc.status === 'COMPLETED' ? (
                            <Link
                              href="/chat"
                              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-indigo-600 transition hover:bg-indigo-50 hover:text-indigo-700"
                              title="Ask AI about indexed documents"
                            >
                              <MessageSquareText className="h-3.5 w-3.5" />
                              <span className="hidden sm:inline">Ask AI</span>
                            </Link>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => void handleInspect(doc.id)}
                            className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                            title="Inspect details"
                            aria-label={`Inspect ${doc.filename}`}
                          >
                            <Eye className="h-4 w-4" />
                          </button>

                          {canManageDocuments ? (
                            <>
                              <button
                                type="button"
                                disabled={
                                  busyDocId === doc.id ||
                                  doc.status === 'PENDING' ||
                                  doc.status === 'PROCESSING'
                                }
                                onClick={() => void handleReprocess(doc)}
                                className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-indigo-600 disabled:opacity-40"
                                title="Reprocess document"
                                aria-label={`Reprocess ${doc.filename}`}
                              >
                                <RotateCcw className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                disabled={busyDocId === doc.id}
                                onClick={() => setConfirmDeleteDoc(doc)}
                                className="rounded-lg p-1.5 text-slate-500 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
                                title="Delete document"
                                aria-label={`Delete ${doc.filename}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {pagination.totalPages > 1 ? (
            <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3 text-xs text-slate-600">
              <span>
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="rounded-lg border border-slate-300 px-3 py-1 font-medium disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={page >= pagination.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="rounded-lg border border-slate-300 px-3 py-1 font-medium disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </section>
      </div>

      {selectedDoc || loadingDetail ? (
        <div className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-[2px]">
          <div className="animate-scale-in w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  {loadingDetail
                    ? 'Loading document details...'
                    : selectedDoc?.filename}
                </h3>
                {selectedDoc ? (
                  <p className="mt-0.5 font-mono text-xs text-slate-500">
                    {selectedDoc.id}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setSelectedDoc(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close document details"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {loadingDetail ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-indigo-600" />
              </div>
            ) : selectedDoc ? (
              <div className="mt-4 space-y-4 text-sm">
                <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-4 text-xs">
                  <div>
                    <span className="text-slate-500">Status</span>
                    <div className="mt-1">
                      <DocumentStatusBadge status={selectedDoc.status} />
                    </div>
                  </div>
                  <div>
                    <span className="text-slate-500">Chunks Indexed</span>
                    <p className="mt-1 font-semibold text-slate-900">
                      {selectedDoc.chunkCount}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-500">Pages</span>
                    <p className="mt-1 font-semibold text-slate-900">
                      {selectedDoc.pageCount ?? '—'}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-500">Processing Version</span>
                    <p className="mt-1 font-semibold text-slate-900">
                      v{selectedDoc.processingVersion}
                    </p>
                  </div>
                  <div className="col-span-2">
                    <span className="text-slate-500">SHA-256 Checksum</span>
                    <p className="mt-1 break-all font-mono text-[11px] text-slate-700">
                      {selectedDoc.checksum}
                    </p>
                  </div>
                </div>

                {selectedDoc.errorMessage ? (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
                    <p className="font-semibold">Error Message</p>
                    <p className="mt-1">{selectedDoc.errorMessage}</p>
                  </div>
                ) : null}

                {selectedDoc.latestJob ? (
                  <div className="rounded-xl border border-slate-200 p-4 text-xs">
                    <p className="font-semibold text-slate-900">
                      Latest Processing Job
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-slate-600">
                      <p>Status: {selectedDoc.latestJob.status}</p>
                      <p>Attempts: {selectedDoc.latestJob.attempts}</p>
                      <p>
                        Started: {formatDateTime(selectedDoc.latestJob.startedAt)}
                      </p>
                      <p>
                        Completed:{' '}
                        {formatDateTime(selectedDoc.latestJob.completedAt)}
                      </p>
                    </div>
                    {selectedDoc.latestJob.error ? (
                      <p className="mt-2 text-rose-600">
                        {selectedDoc.latestJob.error}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {canManageDocuments &&
                selectedDoc.status !== 'PENDING' &&
                selectedDoc.status !== 'PROCESSING' ? (
                  <div className="flex justify-end pt-1">
                    <button
                      type="button"
                      disabled={busyDocId === selectedDoc.id}
                      onClick={() => void handleReprocess(selectedDoc)}
                      className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Reprocess Document
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {confirmDeleteDoc ? (
        <div className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-[2px]">
          <div className="animate-scale-in w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-base font-semibold text-slate-900">
              Delete document?
            </h3>
            <p className="mt-2 text-sm text-slate-600">
              This will permanently remove{' '}
              <span className="font-semibold text-slate-900">
                {confirmDeleteDoc.filename}
              </span>{' '}
              from MinIO object storage and delete all indexed chunks from
              pgvector.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteDoc(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busyDocId === confirmDeleteDoc.id}
                onClick={() => void handleDelete()}
                className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
              >
                {busyDocId === confirmDeleteDoc.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                Delete permanently
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
