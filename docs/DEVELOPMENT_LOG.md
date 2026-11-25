# Development Log

## 2026-11-16 — Sprint 1 Foundation Scaffolding

### Summary

Initialized the Sprint 1 monorepo foundation for **Enterprise Knowledge AI** with `pnpm` workspaces, strict TypeScript, Docker Compose infrastructure definitions, Prisma v7 database package, Fastify v5 API with liveness/readiness probes, ESLint, and Vitest.

### Implemented

- Root monorepo configuration (`package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.mjs`, `vitest.config.ts`, `.env.example`, `.gitignore`).
- Docker Compose local stack (`docker-compose.yml`, `infrastructure/postgres/init.sql`) for PostgreSQL 17 + `pgvector`, Redis 7, and MinIO.
- `@enterprise-ai/shared` package with shared constants and health/readiness types.
- `@enterprise-ai/database` package with Prisma 7 (`prisma.config.ts`, `prisma/schema.prisma`), `createDatabaseClient`, `checkDatabaseHealth`, and unit tests.
- `@enterprise-ai/api` Fastify v5 application with Zod env validation, Pino logging, `GET /health`, `GET /ready` (also under `/api/v1`), graceful shutdown, and integration/unit tests.

### Verification

- Installed `pnpm@12.21.0` and all workspace dependencies.
- Ran `pnpm db:generate` (generated Prisma Client `7.10.1`).
- Ran `pnpm build`, `pnpm typecheck`, `pnpm lint`, and `pnpm test` (all passed).
- Noted missing local prerequisites: `docker` / `docker compose` is not installed on the workstation, and `git init` could not write `.git` inside the sandbox.

## 2026-11-16 — Sprint 1 Infrastructure & Live Readiness Verification

### Summary

Verified the Git repository initialization, resolved the Docker Hub `minio/minio` image deprecation by switching to Chainguard MinIO images, started the full Docker Compose stack, and verified live API readiness against PostgreSQL (`pgvector`), Redis, and MinIO.

### Changed

- Updated `docker-compose.yml` to use `cgr.dev/chainguard/minio:latest` and `cgr.dev/chainguard/minio-client:latest` with `MC_HOST_local` for idempotent bucket creation.
- Updated `docs/PROJECT_STATUS.md`, `docs/TECHNICAL_DECISIONS.md` (TD-006), and `docs/DEVELOPMENT_LOG.md`.

### Verification

- `docker compose up -d --wait`: `enterprise-ai-postgres`, `enterprise-ai-redis`, and `enterprise-ai-minio` reported `healthy`; `enterprise-ai-minio-init` exited `0`.
- `GET http://127.0.0.1:3001/health`: returned `200` (`status: "ok"`).
- `GET http://127.0.0.1:3001/api/v1/ready`: returned `200` (`status: "ready"`, `database.status: "up"`, `pgvectorEnabled: true`, `redis.status: "up"`).
- `GET http://127.0.0.1:9000/minio/health/live`: returned `HTTP 200`.

## 2026-11-18 — Sprint 2 Backend Core (Auth, Organizations, RBAC, Tenant Isolation)

### Summary

Implemented the complete Sprint 2 Backend Core: PostgreSQL relational models and migrations, `scrypt` password hashing, JWT + refresh token rotation with reuse detection, multi-organization management, invitation workflow, RBAC (`OWNER`, `ADMIN`, `MEMBER`), and cross-tenant isolation integration tests.

### Implemented

- Prisma schema & migration `20261118131305_sprint2_backend_core` (`Organization`, `User`, `Membership`, `RefreshToken`, `OrganizationInvitation`, `MembershipRole`, `InvitationStatus`).
- Security & error primitives (`apps/api/src/shared/errors/app-error.ts`, `apps/api/src/shared/security/password.ts`, `apps/api/src/shared/security/tokens.ts`).
- Authentication middleware and RBAC (`apps/api/src/middleware/authenticate.ts`, `apps/api/src/middleware/rbac.ts`, `apps/api/src/types/fastify.d.ts`).
- `auth` module (`apps/api/src/modules/auth/*`): `register`, `login`, `refresh`, `logout`, `me`.
- `organizations` module (`apps/api/src/modules/organizations/*`): create, list, get, update, list members, create invitation, list pending invitations, accept invitation, update member role.
- Unit tests (`apps/api/tests/security.test.ts`) and real PostgreSQL integration tests (`apps/api/tests/backend-core.integration.test.ts`) running against `enterprise_knowledge_ai_test`.

### Verification

- `pnpm db:generate` and `prisma migrate dev --name sprint2_backend_core`: succeeded.
- `pnpm typecheck`, `pnpm lint`, `pnpm build`: all passed with exit code `0`.
- `pnpm test` (against live `enterprise_knowledge_ai_test` PostgreSQL): **5 test files, 18 tests passed**.

## 2026-11-18 — Sprint 3 Document Processing Pipeline (MinIO, BullMQ, PDF Extraction, Chunking)

### Summary

Implemented the complete Sprint 3 asynchronous PDF document ingestion pipeline: database schema & migration, shared queue/chunking contracts, MinIO S3 storage integration, tenant-scoped Fastify document endpoints, independent `apps/worker` BullMQ + `unpdf` processing service, and comprehensive unit + live integration tests against PostgreSQL, Redis, and MinIO.

### Implemented

- **Shared Contracts (`packages/shared`)**: Exported `DOCUMENT_PROCESSING_QUEUE_NAME`, `DOCUMENT_PROCESS_JOB_NAME`, `DEFAULT_CHUNK_SIZE_TOKENS` (`500`), `DEFAULT_CHUNK_OVERLAP_TOKENS` (`75`), `MAX_DOCUMENT_FILE_SIZE_BYTES` (`25 MiB`), `ALLOWED_DOCUMENT_MIME_TYPES`, `DEFAULT_JOB_ATTEMPTS` (`3`), `DEFAULT_JOB_BACKOFF_MS` (`2000`), `DOCUMENT_STATUS`, `PROCESSING_JOB_STATUS`, `DocumentProcessJobPayload`, and `DocumentChunkMetadata`.
- **Database Schema & Migration (`packages/database`)**: Added `Document`, `DocumentChunk`, `ProcessingJob`, `DocumentStatus`, and `ProcessingJobStatus` via migration `20261118133209_sprint3_document_processing` (with `processingVersion` fencing, `@@unique([documentId, chunkIndex])`, denormalized `organization_id` on `document_chunks`, and cascading deletes).
- **Document Upload & Management API (`apps/api`)**:
  - Added MinIO S3 client (`apps/api/src/infrastructure/storage.ts`), BullMQ queue producer (`apps/api/src/infrastructure/queue.ts`), and pre-stream `x-organization-id` membership/RBAC hook (`apps/api/src/middleware/organization-context.ts`).
  - Implemented `/api/v1/documents` endpoints (`POST /documents`, `GET /documents`, `GET /documents/:id`, `GET /documents/:id/status`, `POST /documents/:id/reprocess`, `DELETE /documents/:id`) with filename sanitization, `.pdf` / `application/pdf` / `%PDF-` magic-byte validation, SHA-256 checksums, MinIO upload compensation, and DB-first deletion.
- **Background Worker (`apps/worker`)**:
  - Scaffolded `@enterprise-ai/worker` with Zod env validation, Pino logging, dedicated Redis connection (`maxRetriesPerRequest: null`), MinIO PDF reader, `UnpdfTextExtractor`, `PageAwareTokenChunker`, `processDocumentJob` (`processingVersion` fencing, `SELECT ... FOR UPDATE` atomic chunk replacement, retry/attempt tracking, and `UnrecoverableError` handling), and graceful `SIGINT`/`SIGTERM` shutdown.
- **Automated Tests & Vitest Config**:
  - Added API unit tests (`apps/api/tests/documents.unit.test.ts`), worker unit tests (`apps/worker/tests/pdf-extractor.test.ts`, `chunker.test.ts`, `document-processor.test.ts`), and live integration suites (`apps/api/tests/documents.integration.test.ts`, `apps/worker/tests/document-process.integration.test.ts`).
  - Configured `fileParallelism: false` in root `vitest.config.ts` so integration suites share `enterprise_knowledge_ai_test` and Redis/MinIO deterministically.

### Verification

- `pnpm db:generate`, `prisma migrate dev --name sprint3_document_processing`, and `prisma migrate deploy` (against `enterprise_knowledge_ai_test`): succeeded.
- `pnpm typecheck`, `pnpm lint`, `pnpm build`: all passed with exit code `0`.
- `pnpm test` (against live `enterprise_knowledge_ai_test` PostgreSQL, Redis, and MinIO): **11 test files, 55 tests passed (55/55)**.

## 2026-11-18 — Sprint 4 Core RAG Pipeline (AI Providers, pgvector Retrieval, Grounded Conversations)

### Summary

Implemented the complete Sprint 4 Core RAG pipeline: replaceable `@enterprise-ai/ai` OpenAI embedding & LLM providers, `pgvector` `vector(1536)` schema & partial HNSW cosine index, tenant-isolated semantic retrieval, worker chunk embedding persistence, grounded RAG orchestration with prompt-injection defenses & deterministic citation validation, `/api/v1/conversations` endpoints, and unit + live integration verification.

### Implemented

- **Shared RAG Contracts (`packages/shared`)**: Exported `EMBEDDING_DIMENSIONS` (`1536`), `DEFAULT_RETRIEVAL_TOP_K` (`5`), `MAX_RETRIEVAL_TOP_K` (`20`), `RetrieveChunksInput`, `RetrievedChunk`, `RetrievalService`, `Citation`, `UsageInformation`, and `RAGResponse`.
- **AI Provider Abstraction (`packages/ai`)**: Built `@enterprise-ai/ai` using Node.js 24 native `fetch` + Zod (`loadAIConfig`, `OpenAIEmbeddingProvider`, `OpenAILLMProvider`, `createEmbeddingProvider`, `createLLMProvider`, `AIProviderError` hierarchy with secret redaction, `AbortSignal` timeouts, `429`/`5xx` retries, and `estimateModelCostUsd`).
- **Database Schema, Migration & pgvector Retrieval (`packages/database`)**:
  - Deployed migration `20261118183223_sprint4_core_rag` adding `DocumentChunk.embedding` (`vector(1536)`), partial HNSW index `document_chunks_embedding_hnsw_cosine_idx` (`WHERE embedding IS NOT NULL`), `MessageRole`, `Conversation`, `Message`, `MessageCitation`, and `UsageEvent`.
  - Implemented `assertValidVector`, `formatPgVectorLiteral`, `insertDocumentChunksWithEmbeddings`, `updateDocumentChunkEmbedding`, and `PgVectorRetrievalService` enforcing SQL-level `organization_id`, `COMPLETED` document status, and `embedding IS NOT NULL` filters.
- **Worker Embedding Persistence (`apps/worker`)**: Wired `EmbeddingProvider.embedDocuments` into `document-process.processor.ts` (outside DB row locks, with `processingVersion` re-check and `UnrecoverableError` mapping for non-retryable `AIProviderError`) and atomic `insertDocumentChunksWithEmbeddings` persistence inside the `FOR UPDATE` transaction.
- **RAG Orchestration & Conversations API (`apps/api`)**:
  - Implemented `apps/api/src/modules/rag/` (`XmlContextAssemblyService`, grounded system prompt, `0`-chunk short-circuit, `parseStructuredLLMResponse`, deterministic `validateCitations`, `RagService`).
  - Implemented `apps/api/src/modules/conversations/` (`POST /conversations`, `GET /conversations`, `GET /conversations/:id`, `DELETE /conversations/:id`, `POST /conversations/:id/messages`, `GET /conversations/:id/messages`) enforcing `authenticate`, `x-organization-id` membership, `(id, organizationId, userId)` ownership, atomic turn + citation + `UsageEvent` persistence, and `503` provider failure handling without partial assistant messages.
- **Automated Tests**: Added unit tests (`packages/ai/tests/`, `packages/database/tests/retrieval.test.ts`, `apps/api/tests/rag.unit.test.ts`) and live `pgvector`/PostgreSQL integration suites (`packages/database/tests/retrieval.integration.test.ts`, `apps/api/tests/rag-conversations.integration.test.ts`, and `vector(1536)` assertions in `apps/worker/tests/document-process.integration.test.ts`).

### Verification

- `pnpm db:generate`, `prisma migrate dev`, and `prisma migrate deploy` (against `enterprise_knowledge_ai_test`): succeeded.
- `pnpm build`, `pnpm typecheck`, `pnpm lint`: all passed with exit code `0`.
- `pnpm test` (against live `enterprise_knowledge_ai_test` PostgreSQL/`pgvector`, Redis, and MinIO): **18 test files, 114 tests passed (114/114)**.

## 2026-11-19 — 404 Investigation Fix, Sprints 5–7 Enhancements & Sprint 8 Next.js Frontend

### Summary

Diagnosed and fixed API `404` / trailing-slash routing issues, implemented Sprint 5–7 backend capabilities (PostgreSQL FTS + `pgvector` RRF hybrid retrieval, `HybridLexicalReranker`, optional Ollama provider, `@fastify/cors`, `@fastify/rate-limit`, `x-request-id` tracing, stage latencies, message feedback, and dashboard/analytics endpoints), and delivered the Sprint 8 Next.js 16 + Tailwind CSS v4 frontend (`apps/web`).

### Implemented

- **404 Root-Cause Fix, Security & Observability (`apps/api/src/{app.ts,server.ts,config/env.ts}`)**:
  - Enabled `routerOptions: { ignoreTrailingSlash: true }`, `requestIdHeader: 'x-request-id'`, `genReqId: () => randomUUID()`, and `onSend` `x-request-id` echo.
  - Added `GET /` and `GET /api/v1` discovery routes and `setNotFoundHandler` with `/api/v1` hint.
  - Registered `@fastify/cors` (`CORS_ORIGIN`) and `@fastify/rate-limit` (`429 RATE_LIMIT_EXCEEDED`, configurable via `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`, and `enableRateLimit`).
- **Database & Hybrid Retrieval (`packages/shared`, `packages/database`)**:
  - Deployed migration `20261119132210_sprint5_7_fts_feedback` adding `FeedbackRating`, `MessageFeedback`, and PostgreSQL FTS GIN index `document_chunks_content_fts_gin_idx`.
  - Implemented `HybridRetrievalService` (`'semantic' | 'lexical' | 'hybrid'`) with Reciprocal Rank Fusion (`k = 60`) and tenant-isolated FTS SQL (`websearch_to_tsquery` + `ts_rank_cd`), plus `packages/shared/src/types/analytics.ts` contracts.
- **AI Providers & Reranking (`packages/ai`)**:
  - Extracted shared `JsonHttpClient`, added optional `OllamaEmbeddingProvider` and `OllamaLLMProvider` (`AI_PROVIDER=ollama`, enforcing `EMBEDDING_DIMENSIONS = 1536`), and implemented deterministic `HybridLexicalReranker`.
- **Feedback, Analytics & Hybrid RAG APIs (`apps/api`)**:
  - Wired `HybridRetrievalService`, `HybridLexicalReranker`, per-stage latency logging (`embeddingMs`, `retrievalMs`, `rerankMs`, `generationMs`), and optional `strategy` on `POST /api/v1/conversations/:id/messages`.
  - Added `POST /api/v1/messages/:id/feedback`, `GET /api/v1/dashboard/overview`, and `GET /api/v1/analytics/{usage,performance,quality}`.
- **Next.js Frontend (`apps/web`)**:
  - Built `@enterprise-ai/web` (`Next.js 16`, `React 19`, `Tailwind CSS v4`, `lucide-react`) with `/login`, `/register`, protected workspace shell + org switcher, `/organizations`, `/documents` (upload + live polling + RBAC actions), `/chat` (strategy selector, citations, insufficient-context notice, feedback), and `/analytics`.

### Verification

- `pnpm db:generate`, `prisma migrate dev`, and `prisma migrate deploy` (against `enterprise_knowledge_ai_test`): succeeded.
- `pnpm build` (including `apps/web` production build), `pnpm typecheck`, `pnpm lint` (including `apps/web` lint): all passed with exit code `0`.
- `pnpm test` (against live `enterprise_knowledge_ai_test` PostgreSQL/`pgvector`+FTS, Redis, and MinIO): **24 test files, 142 tests passed (142/142)**.

## 2026-11-19 — Default AI Provider Switch to Google Gemini

### Summary

Switched the default AI provider in `@enterprise-ai/ai` (`packages/ai`), `apps/api/src/server.ts`, `.env.example`, and project documentation from OpenAI to Google Gemini (`gemini-embedding-001` at `outputDimensionality: 1536` + `gemini-2.5-flash`), while keeping `'openai'` and `'ollama'` selectable via `AI_PROVIDER`.

### Implemented

- **`packages/ai`**: Added `GeminiHttpClient` (`x-goog-api-key`), `GeminiEmbeddingProvider` (`:embedContent` / `:batchEmbedContents` with `outputDimensionality: 1536`), `GeminiLLMProvider` (`:generateContent` with `systemInstruction` + `responseMimeType: 'application/json'`), `hasProviderCredentials(config)`, Gemini pricing entries, and `AIza...` secret redaction; set `DEFAULT_AI_PROVIDER = 'gemini'`.
- **`apps/api/src/server.ts` & `.env.example`**: Wired `hasProviderCredentials(aiConfig)` in `server.ts` and updated `.env.example` defaults to `AI_PROVIDER=gemini` with documented `GEMINI_*`, `OPENAI_*`, and `OLLAMA_*` options.
- **Documentation**: Updated `README.md`, `docs/PROJECT_STATUS.md`, `docs/ARCHITECTURE.md`, `docs/TECHNICAL_DECISIONS.md` (`TD-023`), and `docs/DEVELOPMENT_LOG.md`.

## 2026-11-19 — Split LLM (`Groq`) & Embedding (`Gemini`) Provider Architecture

### Summary

Introduced split `AI_LLM_PROVIDER` (`'groq'` default with `llama-3.3-70b-versatile`) and `AI_EMBEDDING_PROVIDER` (`'gemini'` default with `gemini-embedding-001` at `1536` dims) configuration so Groq powers open-source LLM generation while dedicated embedding providers (or `'lexical'` PostgreSQL FTS fallback) supply retrieval.

### Implemented

- **`packages/ai`**: Added `GroqLLMProvider` (`https://api.groq.com/openai/v1`, `llama-3.3-70b-versatile`) reusing `OpenAILLMProvider` / `OpenAIHttpClient`, `gsk_...` secret redaction, `AI_LLM_PROVIDER` / `AI_EMBEDDING_PROVIDER` config with `hasLLMCredentials` / `hasEmbeddingCredentials`, and Groq pricing entries.
- **`apps/api`**: Made `embeddingProvider` optional in `RagService` and `buildApp`, defaulting to `'lexical'` FTS retrieval when only LLM credentials are configured and returning `503 AI_PROVIDER_NOT_CONFIGURED` when `'hybrid'` / `'semantic'` is requested without embedding credentials; wired independent `hasLLMCredentials` and `hasEmbeddingCredentials` checks in `server.ts`; added unit tests in `apps/api/tests/sprint5_7.unit.test.ts`.
- **`.env.example` & Documentation**: Updated `.env.example` (`AI_LLM_PROVIDER=groq`, `AI_EMBEDDING_PROVIDER=gemini`), `README.md`, `docs/PROJECT_STATUS.md`, `docs/ARCHITECTURE.md`, `docs/TECHNICAL_DECISIONS.md` (`TD-024`), and `docs/DEVELOPMENT_LOG.md`.

## 2026-11-19 — Lexical-Only Ingestion (`AI_EMBEDDING_PROVIDER=none`) & RAG Capability Discovery

### Summary

Added `AI_EMBEDDING_PROVIDER=none` as the default alongside Groq (`llama-3.3-70b-versatile`) so PDF ingestion and grounded Q&A run smoothly via PostgreSQL Full-Text Search without hitting Gemini/OpenAI embedding quota `429` errors, while keeping `gemini`, `openai`, and `ollama` embedding providers selectable for `'hybrid'` `pgvector` + FTS retrieval.

### Implemented

- **`packages/ai` & `apps/worker`**: Added `'none'` to `SUPPORTED_EMBEDDING_PROVIDERS` (`DEFAULT_EMBEDDING_PROVIDER = 'none'`); made `embeddingProvider` optional in `document-process.processor.ts` and `worker.ts` (persisting chunks with `embedding = NULL` via `createMany` when disabled).
- **`apps/api`**: Exposed non-secret `rag` capabilities (`defaultStrategy`, `embeddingsEnabled`, `llmConfigured`, `llmProvider`, `llmModel`, `embeddingProvider`) on `GET /` and `GET /api/v1`, defaulted `server.ts` to `'lexical'` when `!hasEmbeddingCredentials`, and added unit assertions in `apps/api/tests/sprint5_7.unit.test.ts`.
- **`apps/web`, `.env.example` & Docs**: Updated `/chat` to read `GET /api/v1` `rag` capabilities and default to `'lexical'` when embeddings are disabled; updated `.env.example` (`AI_EMBEDDING_PROVIDER=none`, `RAG_RETRIEVAL_STRATEGY=lexical`), `README.md`, `docs/PROJECT_STATUS.md`, `docs/TECHNICAL_DECISIONS.md` (`TD-025`), and `docs/DEVELOPMENT_LOG.md`.

## 2026-11-19 — Natural-Language Lexical FTS Query Fix & Active Groq Default Model (`qwen/qwen3.8-27b`)

### Summary

Fixed natural-language lexical retrieval returning 0 chunks (`INSUFFICIENT_CONTEXT_ANSWER`) and updated the default Groq open-weight chat model from `llama-3.3-70b-versatile` (`404` on the active Groq API project) to `qwen/qwen3.8-27b`.

### Implemented

- **`packages/database`**: Updated `HybridRetrievalService.retrieveLexical` in `packages/database/src/hybrid-retrieval.ts` to combine strict `websearch_to_tsquery('simple', queryText)` (`+10.0` score priority) with a stopword-filtered relaxed `OR` query preserving the `'simple'` GIN index scan, plus a `'portuguese'` stemmed fallback when exact `'simple'` matching returns zero rows (handling plurals/inflections); added unit and live PostgreSQL integration tests in `packages/database/tests/hybrid-retrieval*.ts`.
- **`packages/ai`, `apps/api` & `.env.example`**: Updated `DEFAULT_GROQ_CHAT_MODEL` to `'qwen/qwen3.8-27b'` in `packages/ai/src/config/ai-config.ts`, `.env.example`, and test assertions (`packages/ai/tests/config-and-pricing.test.ts`, `packages/ai/tests/groq-provider.test.ts`, `apps/api/tests/sprint5_7.unit.test.ts`).
- **Documentation**: Updated `README.md`, `docs/ARCHITECTURE.md`, `docs/PROJECT_STATUS.md`, `docs/TECHNICAL_DECISIONS.md` (`TD-026`), and `docs/DEVELOPMENT_LOG.md`.

## 2026-11-19 — Sprints 6–8 Final Hardening, Distributed Tracing, RAG Evaluation & Frontend UX Animations

### Summary

Completed the remaining scheduled production-hardening and evaluation tasks (PostgreSQL RLS defense-in-depth, W3C/OTLP distributed tracing across API + RAG + Worker, reproducible retrieval benchmark & Python RAGAS evaluation scripts) alongside friendly animations and UX improvements across `apps/web`.

### Implemented

- **`packages/database` (RLS)**: Added migration `20261119180000_sprint6_rls_policies` (`enterprise_ai_app` role + policies across 10 tenant/child tables), `withTenantRlsContext` in `packages/database/src/rls.ts`, unit tests (`rls.test.ts`), and live integration tests (`rls.integration.test.ts`).
- **`packages/shared`, `apps/api` & `apps/worker` (Distributed Tracing)**: Added `TelemetryTracer` and W3C `traceparent` propagation (`packages/shared/src/telemetry/tracing.ts`), `x-trace-id` / `traceparent` headers + `http.request` span in `apps/api/src/app.ts`, `rag.*` child spans in `RagService`, and `worker.*` spans in `apps/worker/src/processors/document-process.processor.ts`.
- **`packages/ai` & `evaluation/` (Benchmarks & RAGAS)**: Added retrieval evaluation metrics (`packages/ai/src/evaluation/retrieval-metrics.ts`, `evaluation.test.ts`), benchmark dataset (`evaluation/dataset.json`), runnable PostgreSQL benchmark script (`evaluation/run_benchmark.mjs`), Python RAGAS script (`evaluation/evaluate_ragas.py`), and generated `evaluation/BENCHMARK_REPORT.md`.
- **`apps/web` (UX & Animations)**: Added CSS keyframe animations with `prefers-reduced-motion` support (`globals.css`), gradient hero + workflow cards (`page.tsx`), password visibility toggle (`auth-form.tsx`), slide-in mobile drawer + route transitions (`app-shell.tsx`), starter prompt pills + 3-dot typing indicator + copy answer + animated citations (`chat-workspace.tsx`, `citation-card.tsx`), animated drag-and-drop + shimmer skeletons + Ask AI shortcut (`documents-workspace.tsx`), and animated KPI cards & progress bars (`analytics-dashboard.tsx`).

## 2026-11-25 — Paced Gemini Embeddings for Large PDFs & BullMQ Worker Lock Hardening

### Summary

Resolved `429` burst rate-limit failures when embedding large PDFs (100+ chunks) with Gemini, auto-enabled paced Gemini embeddings when `GEMINI_API_KEY` is configured (keeping `AI_EMBEDDING_PROVIDER=none` as explicit opt-out), and extended BullMQ worker lock duration for long-running multi-batch ingestion jobs.

### Implemented

- **`packages/ai`**: Added `extractGeminiRetryAfterMs` (parsing `google.rpc.RetryInfo` `retryDelay` and `"Please retry in Xs"` hints) with a `65_000ms` cap and `AbortSignal`-safe `sleepWithAbort`; set `DEFAULT_GEMINI_EMBEDDING_BATCH_SIZE = 20` and `AI_EMBEDDING_BATCH_DELAY_MS = 1000`; auto-selected `'gemini'` in `loadAIConfig` when `GEMINI_API_KEY` is set and `AI_EMBEDDING_PROVIDER` / `AI_PROVIDER` are unset (48/48 `packages/ai` unit tests passed).
- **`apps/worker`**: Added `WORKER_LOCK_DURATION_MS` (`120_000ms` default) and `stalled` event logging in `createDocumentProcessingWorker` (`apps/worker/src/queues/document-processing.worker.ts`, `config/env.ts`, `worker.ts`).
- **`apps/api`, `.env.example` & Docs**: Refined `apps/api/src/server.ts` fallback logging, updated `.env.example` (`WORKER_LOCK_DURATION_MS=120000`, `AI_EMBEDDING_BATCH_DELAY_MS=1000`, `RAG_RETRIEVAL_STRATEGY=hybrid` with auto-selected Gemini when `GEMINI_API_KEY` is set), and updated `README.md`, `docs/PROJECT_STATUS.md`, `docs/TECHNICAL_DECISIONS.md` (`TD-029`), and `docs/DEVELOPMENT_LOG.md`.
