'use client';

import {
  AlertTriangle,
  Bot,
  Check,
  Copy,
  Loader2,
  MessageSquarePlus,
  Send,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  User,
} from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { useAuth } from '@/components/providers/auth-provider';
import { CitationCard } from '@/features/chat/citation-card';
import { apiClient } from '@/lib/api/client';
import type {
  ChatMessage,
  ConversationSummary,
  FeedbackRatingValue,
  RagCapabilities,
  RetrievalStrategy,
  UsageInformation,
} from '@/lib/api/types';
import {
  formatDateTime,
  formatDurationMs,
  formatNumber,
  formatUsd,
  getErrorMessage,
} from '@/lib/format';

interface FeedbackState {
  rating: FeedbackRatingValue;
  comment: string | null;
}

const STARTER_PROMPTS = [
  'Quais são as principais regras e requisitos do documento?',
  'Quais exceções ou restrições importantes são mencionadas?',
  'Resuma os pontos essenciais com as citações correspondentes.',
] as const;

export function ChatWorkspace() {
  const { activeOrganizationId } = useAuth();
  return (
    <ChatWorkspaceInner
      key={activeOrganizationId ?? 'no-org'}
      activeOrganizationId={activeOrganizationId}
    />
  );
}

function ChatWorkspaceInner({
  activeOrganizationId,
}: {
  activeOrganizationId: string | null;
}) {
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [usageByMessageId, setUsageByMessageId] = useState<
    Record<string, UsageInformation>
  >({});
  const [feedbackByMessageId, setFeedbackByMessageId] = useState<
    Record<string, FeedbackState>
  >({});
  const [commentDraftMessageId, setCommentDraftMessageId] = useState<
    string | null
  >(null);
  const [commentDraft, setCommentDraft] = useState('');

  const [ragCapabilities, setRagCapabilities] =
    useState<RagCapabilities | null>(null);
  const [strategy, setStrategy] = useState<RetrievalStrategy>('hybrid');
  const strategyTouchedRef = useRef(false);
  const [topK, setTopK] = useState<number>(8);
  const [question, setQuestion] = useState('');

  const [loadingList, setLoadingList] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [submittingFeedbackId, setSubmittingFeedbackId] = useState<
    string | null
  >(null);
  const [deletingConversationId, setDeletingConversationId] = useState<
    string | null
  >(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const discovery = await apiClient.discovery.get();
        if (cancelled || !discovery.rag) return;
        setRagCapabilities(discovery.rag);
        if (!discovery.rag.embeddingsEnabled) {
          setStrategy('lexical');
        } else if (!strategyTouchedRef.current) {
          setStrategy(discovery.rag.defaultStrategy);
        }
      } catch {
        // Fail-soft: keep default retrieval selector if discovery is unreachable.
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeOrganizationId) return;
    let cancelled = false;

    const run = async () => {
      try {
        const res = await apiClient.conversations.list({ page: 1, limit: 50 });
        if (cancelled) return;
        setConversations(res.conversations);
        const firstId = res.conversations[0]?.id ?? null;
        setActiveConversationId((prev) =>
          prev && res.conversations.some((c) => c.id === prev) ? prev : firstId,
        );
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(getErrorMessage(err, 'Failed to load conversations'));
        }
      } finally {
        if (!cancelled) {
          setLoadingList(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [activeOrganizationId]);

  useEffect(() => {
    if (!activeOrganizationId || !activeConversationId) return;
    let cancelled = false;

    const run = async () => {
      try {
        const res = await apiClient.conversations.listMessages(
          activeConversationId,
          { page: 1, limit: 100 },
        );
        if (cancelled) return;
        setMessages(res.messages);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(
            getErrorMessage(err, 'Failed to load conversation messages'),
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingMessages(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [activeOrganizationId, activeConversationId]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, sending]);

  const handleCreateConversation = async () => {
    setError(null);
    try {
      const res = await apiClient.conversations.create();
      setConversations((prev) => [res.conversation, ...prev]);
      setActiveConversationId(res.conversation.id);
      setMessages([]);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to create conversation'));
    }
  };

  const handleDeleteConversation = async (conversationId: string) => {
    setDeletingConversationId(conversationId);
    setError(null);
    try {
      await apiClient.conversations.delete(conversationId);
      setConversations((prev) => {
        const remaining = prev.filter((c) => c.id !== conversationId);
        if (activeConversationId === conversationId) {
          setActiveConversationId(remaining[0]?.id ?? null);
        }
        return remaining;
      });
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to delete conversation'));
    } finally {
      setDeletingConversationId(null);
    }
  };

  const handleSendMessage = async () => {
    const trimmed = question.trim();
    if (!trimmed || sending) return;

    setError(null);
    setSending(true);

    try {
      let targetConversationId = activeConversationId;
      if (!targetConversationId) {
        const created = await apiClient.conversations.create({
          title: trimmed.slice(0, 80),
        });
        targetConversationId = created.conversation.id;
        setConversations((prev) => [created.conversation, ...prev]);
        setActiveConversationId(targetConversationId);
      }

      const activeStrategy: RetrievalStrategy =
        ragCapabilities && !ragCapabilities.embeddingsEnabled
          ? 'lexical'
          : strategy;

      setQuestion('');
      const res = await apiClient.conversations.sendMessage(
        targetConversationId,
        {
          content: trimmed,
          topK,
          strategy: activeStrategy,
        },
      );

      setMessages((prev) => [...prev, res.userMessage, res.assistantMessage]);
      const usageInfo = res.usage;
      if (usageInfo) {
        setUsageByMessageId((prev) => ({
          ...prev,
          [res.assistantMessage.id]: usageInfo,
        }));
      }

      setConversations((prev) =>
        prev.map((c) =>
          c.id === targetConversationId
            ? {
                ...c,
                title: c.title ?? trimmed.slice(0, 80),
                messageCount: c.messageCount + 2,
                updatedAt: res.assistantMessage.createdAt,
              }
            : c,
        ),
      );
    } catch (err) {
      setQuestion(trimmed);
      setError(getErrorMessage(err, 'Failed to send question'));
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSendMessage();
    }
  };

  const handleSubmitFeedback = async (
    messageId: string,
    rating: FeedbackRatingValue,
    comment?: string,
  ) => {
    setSubmittingFeedbackId(messageId);
    setError(null);
    try {
      const res = await apiClient.feedback.submit(messageId, {
        rating,
        ...(comment && comment.trim() ? { comment: comment.trim() } : {}),
      });
      setFeedbackByMessageId((prev) => ({
        ...prev,
        [messageId]: {
          rating: res.feedback.rating,
          comment: res.feedback.comment,
        },
      }));
      setCommentDraftMessageId(null);
      setCommentDraft('');
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to submit feedback'));
    } finally {
      setSubmittingFeedbackId(null);
    }
  };

  const handleCopyAnswer = async (messageId: string, text: string) => {
    try {
      await navigator.clipboard?.writeText(text);
      setCopiedMessageId(messageId);
      setTimeout(() => {
        setCopiedMessageId((prev) => (prev === messageId ? null : prev));
      }, 1800);
    } catch {
      // Clipboard may be unavailable in non-secure contexts
    }
  };

  return (
    <AppShell
      title="AI Chat (RAG)"
      description="Ask questions grounded strictly in your organization's indexed PDF documents."
      actions={
        <button
          type="button"
          onClick={() => void handleCreateConversation()}
          className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:bg-indigo-700 active:scale-[0.98]"
        >
          <MessageSquarePlus className="h-4 w-4" />
          New Chat
        </button>
      }
    >
      <div className="mx-auto grid h-[calc(100vh-11rem)] max-w-7xl grid-cols-1 gap-4 lg:grid-cols-12">
        <aside className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:col-span-3">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Conversations ({conversations.length})
            </h2>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {loadingList ? (
              <div className="flex items-center justify-center py-8 text-xs text-slate-500">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading...
              </div>
            ) : conversations.length === 0 ? (
              <p className="p-4 text-center text-xs text-slate-500">
                No conversations yet. Start a new chat or ask a question directly.
              </p>
            ) : (
              <div className="space-y-1">
                {conversations.map((conv) => {
                  const isActive = conv.id === activeConversationId;
                  return (
                    <div
                      key={conv.id}
                      className={`group flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left transition ${
                        isActive
                          ? 'bg-indigo-50 text-indigo-950 ring-1 ring-indigo-200'
                          : 'hover:bg-slate-50'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          if (conv.id !== activeConversationId) {
                            setMessages([]);
                            setLoadingMessages(true);
                            setActiveConversationId(conv.id);
                          }
                        }}
                        className="min-w-0 flex-1 text-left"
                      >
                        <p className="truncate text-xs font-semibold text-slate-900">
                          {conv.title || 'Untitled conversation'}
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          {conv.messageCount} msgs · {formatDateTime(conv.updatedAt)}
                        </p>
                      </button>
                      <button
                        type="button"
                        disabled={deletingConversationId === conv.id}
                        onClick={() => void handleDeleteConversation(conv.id)}
                        className="rounded-md p-1 text-slate-400 opacity-0 transition hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100 disabled:opacity-40"
                        title="Delete conversation"
                        aria-label="Delete conversation"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:col-span-9">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-indigo-600" />
              <span className="text-sm font-semibold text-slate-900">
                Grounded Knowledge Assistant
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs">
              {ragCapabilities ? (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
                    ragCapabilities.embeddingsEnabled
                      ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                      : 'border-amber-200 bg-amber-50 text-amber-800'
                  }`}
                >
                  {ragCapabilities.embeddingsEnabled
                    ? 'Hybrid + Vector Active'
                    : 'Lexical FTS Mode (embeddings disabled)'}
                  {ragCapabilities.llmConfigured && ragCapabilities.llmProvider
                    ? ` · ${ragCapabilities.llmProvider}${
                        ragCapabilities.llmModel
                          ? ` (${ragCapabilities.llmModel})`
                          : ''
                      }`
                    : ''}
                </span>
              ) : null}

              <label className="flex items-center gap-1.5 text-slate-600">
                <span className="font-medium">Retrieval:</span>
                <select
                  aria-label="Retrieval strategy"
                  value={
                    ragCapabilities && !ragCapabilities.embeddingsEnabled
                      ? 'lexical'
                      : strategy
                  }
                  onChange={(e) => {
                    strategyTouchedRef.current = true;
                    setStrategy(e.target.value as RetrievalStrategy);
                  }}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-800 outline-none focus:border-indigo-500"
                >
                  <option
                    value="hybrid"
                    disabled={
                      ragCapabilities !== null &&
                      !ragCapabilities.embeddingsEnabled
                    }
                  >
                    Hybrid (RRF + Rerank)
                    {ragCapabilities !== null &&
                    !ragCapabilities.embeddingsEnabled
                      ? ' — requires embeddings'
                      : ''}
                  </option>
                  <option
                    value="semantic"
                    disabled={
                      ragCapabilities !== null &&
                      !ragCapabilities.embeddingsEnabled
                    }
                  >
                    Semantic (pgvector)
                    {ragCapabilities !== null &&
                    !ragCapabilities.embeddingsEnabled
                      ? ' — requires embeddings'
                      : ''}
                  </option>
                  <option value="lexical">Lexical (Postgres FTS)</option>
                </select>
              </label>

              <label className="flex items-center gap-1.5 text-slate-600">
                <span className="font-medium">Top K:</span>
                <select
                  aria-label="Top K chunks"
                  value={topK}
                  onChange={(e) => setTopK(Number(e.target.value))}
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-800 outline-none focus:border-indigo-500"
                >
                  <option value={5}>5</option>
                  <option value={8}>8</option>
                  <option value={12}>12</option>
                </select>
              </label>
            </div>
          </div>

          {error ? (
            <div
              role="alert"
              className="mx-5 mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs text-rose-800"
            >
              {error}
            </div>
          ) : null}

          <div className="flex-1 space-y-5 overflow-y-auto p-5">
            {loadingMessages ? (
              <div className="flex items-center justify-center py-16 text-sm text-slate-500">
                <Loader2 className="mr-2 h-5 w-5 animate-spin text-indigo-600" />
                Loading messages...
              </div>
            ) : messages.length === 0 ? (
              <div className="animate-fade-in-up mx-auto flex max-w-xl flex-col items-center justify-center py-12 text-center">
                <div className="animate-float-slow flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-50 to-sky-50 text-indigo-600 ring-1 ring-indigo-100">
                  <Bot className="h-7 w-7" />
                </div>
                <h3 className="mt-4 text-base font-semibold text-slate-900">
                  Ask a question about your organization&apos;s documents
                </h3>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                  Answers are generated only from retrieved chunks inside your
                  active tenant. Every claim includes verifiable page and chunk
                  citations.
                </p>

                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  {STARTER_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => setQuestion(prompt)}
                      className="rounded-full border border-slate-200 bg-slate-50/90 px-3.5 py-1.5 text-xs font-medium text-slate-700 transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-800 active:scale-[0.98]"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg) => {
                const isUser = msg.role === 'USER';
                const usage = usageByMessageId[msg.id];
                const feedback = feedbackByMessageId[msg.id];
                const isCopied = copiedMessageId === msg.id;

                return (
                  <div
                    key={msg.id}
                    className={`animate-fade-in-up flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
                  >
                    {!isUser ? (
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white">
                        <Bot className="h-4 w-4" />
                      </div>
                    ) : null}

                    <div
                      className={`max-w-3xl space-y-3 rounded-2xl px-4 py-3.5 ${
                        isUser
                          ? 'bg-indigo-600 text-white'
                          : 'border border-slate-200 bg-white text-slate-900 shadow-xs'
                      }`}
                    >
                      {!isUser && msg.insufficientContext ? (
                        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                          <span>
                            <strong>Insufficient context:</strong> Not enough
                            verifiable evidence was found in your
                            organization&apos;s documents to answer reliably.
                          </span>
                        </div>
                      ) : null}

                      <div className="whitespace-pre-wrap text-sm leading-relaxed">
                        {msg.content}
                      </div>

                      {!isUser && msg.citations.length > 0 ? (
                        <div className="space-y-2 border-t border-slate-100 pt-3">
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                            Sources ({msg.citations.length})
                          </p>
                          <div className="grid gap-2 sm:grid-cols-2">
                            {msg.citations.map((citation, idx) => (
                              <CitationCard
                                key={`${msg.id}-${citation.chunkId}`}
                                citation={citation}
                                index={idx}
                              />
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {!isUser ? (
                        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-2.5 text-[11px] text-slate-500">
                          <div className="flex flex-wrap items-center gap-2">
                            {usage ? (
                              <>
                                <span className="font-mono">{usage.model}</span>
                                <span>·</span>
                                <span>
                                  {formatNumber(usage.totalTokens)} tokens
                                </span>
                                <span>·</span>
                                <span>{formatDurationMs(usage.latencyMs)}</span>
                                {usage.estimatedCost !== null ? (
                                  <>
                                    <span>·</span>
                                    <span>{formatUsd(usage.estimatedCost)}</span>
                                  </>
                                ) : null}
                              </>
                            ) : msg.tokenUsage ? (
                              <span>
                                {formatNumber(msg.tokenUsage.totalTokens)} tokens
                                (in {formatNumber(msg.tokenUsage.inputTokens)} /
                                out {formatNumber(msg.tokenUsage.outputTokens)})
                              </span>
                            ) : (
                              <span>{formatDateTime(msg.createdAt)}</span>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                void handleCopyAnswer(msg.id, msg.content)
                              }
                              className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 font-medium transition ${
                                isCopied
                                  ? 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200'
                                  : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
                              }`}
                              title="Copy answer"
                            >
                              {isCopied ? (
                                <Check className="h-3.5 w-3.5" />
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                              {isCopied ? 'Copied' : 'Copy'}
                            </button>
                            <button
                              type="button"
                              disabled={submittingFeedbackId === msg.id}
                              onClick={() =>
                                void handleSubmitFeedback(msg.id, 'UP')
                              }
                              className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 font-medium transition ${
                                feedback?.rating === 'UP'
                                  ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                                  : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
                              }`}
                              title="Helpful answer"
                            >
                              <ThumbsUp className="h-3.5 w-3.5" />
                              Helpful
                            </button>
                            <button
                              type="button"
                              disabled={submittingFeedbackId === msg.id}
                              onClick={() => {
                                setCommentDraftMessageId(
                                  commentDraftMessageId === msg.id
                                    ? null
                                    : msg.id,
                                );
                                setCommentDraft(feedback?.comment ?? '');
                                void handleSubmitFeedback(msg.id, 'DOWN');
                              }}
                              className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 font-medium transition ${
                                feedback?.rating === 'DOWN'
                                  ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-200'
                                  : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
                              }`}
                              title="Needs improvement"
                            >
                              <ThumbsDown className="h-3.5 w-3.5" />
                              Not helpful
                            </button>
                          </div>
                        </div>
                      ) : null}

                      {!isUser && commentDraftMessageId === msg.id ? (
                        <div className="flex items-center gap-2 pt-1">
                          <input
                            type="text"
                            maxLength={1000}
                            value={commentDraft}
                            onChange={(e) => setCommentDraft(e.target.value)}
                            placeholder="Optional: tell us what was missing or inaccurate..."
                            className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs outline-none focus:border-indigo-500"
                          />
                          <button
                            type="button"
                            disabled={submittingFeedbackId === msg.id}
                            onClick={() =>
                              void handleSubmitFeedback(
                                msg.id,
                                feedback?.rating ?? 'DOWN',
                                commentDraft,
                              )
                            }
                            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                          >
                            Save note
                          </button>
                        </div>
                      ) : null}
                    </div>

                    {isUser ? (
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-200 text-slate-700">
                        <User className="h-4 w-4" />
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}

            {sending ? (
              <div className="animate-fade-in-up flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-xs">
                  <Bot className="h-4 w-4" />
                </div>
                <div className="inline-flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
                  <span className="inline-flex items-center gap-1" aria-hidden="true">
                    <span
                      className="animate-typing-dot h-1.5 w-1.5 rounded-full bg-indigo-600"
                      style={{ animationDelay: '0ms' }}
                    />
                    <span
                      className="animate-typing-dot h-1.5 w-1.5 rounded-full bg-indigo-600"
                      style={{ animationDelay: '150ms' }}
                    />
                    <span
                      className="animate-typing-dot h-1.5 w-1.5 rounded-full bg-indigo-600"
                      style={{ animationDelay: '300ms' }}
                    />
                  </span>
                  <span>
                    Searching chunks (
                    {ragCapabilities && !ragCapabilities.embeddingsEnabled
                      ? 'lexical'
                      : strategy}
                    ) and writing grounded answer...
                  </span>
                </div>
              </div>
            ) : null}

            <div ref={threadEndRef} />
          </div>

          <div className="border-t border-slate-200 bg-slate-50/70 p-4">
            <div className="flex items-end gap-2">
              <textarea
                rows={2}
                maxLength={4000}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask a question about your uploaded PDFs... (Enter to send, Shift+Enter for new line)"
                className="flex-1 resize-none rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              />
              <button
                type="button"
                disabled={sending || question.trim().length === 0}
                onClick={() => void handleSendMessage()}
                className="inline-flex h-11 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:bg-indigo-700 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Send
              </button>
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
