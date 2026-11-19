# Project Status

## Current Sprint

- **Sprints 1–4**: **Completed** (`Foundation`, `Backend Core`, `Document Processing`, `Core RAG`)
- **Sprints 5–8 (Core Platform & Showcase)**: **Completed** (404/Routing Fixes, Hybrid Retrieval + Reranking, Optional Ollama Provider, CORS + Rate Limiting, Request IDs + Stage Latencies, Feedback & Analytics APIs, Next.js 16 + Tailwind CSS v4 Frontend)
- **Next Tasks**: Optional Production Hardening & Evaluation Tooling (RAGAS Python evaluation environment, OpenTelemetry tracing, PostgreSQL RLS, Playwright E2E)

## Current Task

- Sprints 5–8 advancement is complete and verified across all 6 workspace packages (`@enterprise-ai/shared`, `@enterprise-ai/database`, `@enterprise-ai/ai`, `@enterprise-ai/api`, `@enterprise-ai/worker`, `@enterprise-ai/web`): 404 root-cause fixes & API discovery (including `rag` capability reporting), PostgreSQL FTS (with stopword-filtered relaxed OR + Portuguese stemming fallback) + `pgvector` RRF hybrid retrieval & `HybridLexicalReranker`, split AI provider defaults (Groq `qwen/qwen3.8-27b` LLM + `AI_EMBEDDING_PROVIDER=none` lexical-only default for quota-free PDF ingestion and chat, with optional Gemini, OpenAI, and Ollama embedding/LLM providers), `@fastify/cors` + `@fastify/rate-limit`, `x-request-id` + stage latencies, `POST /api/v1/messages/:id/feedback`, `/api/v1/dashboard/overview` + `/api/v1/analytics/*`, and Next.js 16 + Tailwind v4 frontend (`apps/web`).

## Completed Tasks

### Sprint 1 — Foundation
- [x] Git repository initialized (`main`), `pnpm` monorepo configured, strict TypeScript, ESLint, Vitest, Docker Compose (`pgvector`, Redis, MinIO), Prisma 7, Fastify v5 `/health` & `/ready`.

### Sprint 2 — Backend Core
- [x] Created relational Prisma models and migration `20261118131305_sprint2_backend_core` (`User`, `Organization`, `Membership`, `RefreshToken`, `OrganizationInvitation`, `MembershipRole`, `InvitationStatus`)
- [x] Provisioned isolated `enterprise_knowledge_ai_test` PostgreSQL database with `pgvector` and deployed migrations
- [x] Implemented `scrypt` password hashing with random 16-byte salts and constant-time comparison (`apps/api/src/shared/security/password.ts`)
- [x] Implemented JWT access tokens (`jose`, HS256) and SHA-256 hashed refresh tokens with rotation & reuse-detection family revocation (`apps/api/src/shared/security/tokens.ts`, `apps/api/src/modules/auth/`)
- [x] Implemented auth endpoints (`/api/v1/auth/register`, `/login`, `/refresh`, `/logout`, `/me`) and `createAuthenticateHook` middleware
- [x] Implemented tenant-aware `OrganizationsRepository`, `OrganizationsService`, RBAC hierarchy (`OWNER > ADMIN > MEMBER`), invitation acceptance flow, and last-owner protection (`apps/api/src/modules/organizations/`)
- [x] Added unit tests and real PostgreSQL integration tests verifying auth, multi-organization membership, RBAC, and cross-tenant isolation (`apps/api/tests/security.test.ts`, `apps/api/tests/backend-core.integration.test.ts`)

### Sprint 3 — Document Processing
- [x] Added Sprint 3 Prisma models (`Document`, `DocumentChunk`, `ProcessingJob`) and enums (`DocumentStatus`, `ProcessingJobStatus`) with migration `20261118133209_sprint3_document_processing` (deployed to both `enterprise_knowledge_ai` and `enterprise_knowledge_ai_test`)
- [x] Added shared document constants & contracts in `packages/shared` (`DOCUMENT_PROCESSING_QUEUE_NAME`, `DOCUMENT_PROCESS_JOB_NAME`, chunking defaults `500`/`75`, `DocumentProcessJobPayload`, `DocumentChunkMetadata`, `DocumentStatus`, `ProcessingJobStatus`)
- [x] Implemented MinIO S3-compatible object storage integration (`@aws-sdk/client-s3`) and BullMQ queue producer (`apps/api/src/infrastructure/storage.ts`, `apps/api/src/infrastructure/queue.ts`)
- [x] Implemented `x-organization-id` pre-stream membership/RBAC middleware (`apps/api/src/middleware/organization-context.ts`) and `/api/v1/documents` endpoints (`POST /documents`, `GET /documents`, `GET /documents/:id`, `GET /documents/:id/status`, `POST /documents/:id/reprocess`, `DELETE /documents/:id`) with PDF magic-byte/MIME/size validation, SHA-256 checksums, and opaque storage keys
- [x] Implemented independent background worker (`apps/worker`) with BullMQ consumer, `unpdf` page-preserving PDF text extraction, `PageAwareTokenChunker` (~500 tokens / 75 overlap), `processingVersion` fencing, `SELECT ... FOR UPDATE` atomic chunk replacement, exponential-backoff retries, and terminal failure tracking
- [x] Verified with unit and live PostgreSQL + Redis/BullMQ + MinIO integration tests (`11 test files, 55/55 tests passed`, `pnpm typecheck`, `pnpm lint`, `pnpm build`)

### Sprint 4 — Core RAG
- [x] Created `@enterprise-ai/ai` (`packages/ai`) with Zod-validated `loadAIConfig`, `EmbeddingProvider` (`OpenAIEmbeddingProvider`, `text-embedding-3-small`, fixed `1536` dimensions), `LLMProvider` (`OpenAILLMProvider`, `gpt-4o-mini`, structured `json_object` support), `AIProviderError` hierarchy with secret redaction, `AbortSignal` timeouts, bounded `429`/`5xx` retries, and `estimateModelCostUsd`
- [x] Added Sprint 4 Prisma models (`Conversation`, `Message`, `MessageRole`, `MessageCitation`, `UsageEvent`) and `DocumentChunk.embedding` (`vector(1536)`) + partial HNSW cosine index (`document_chunks_embedding_hnsw_cosine_idx`) via migration `20261118183223_sprint4_core_rag` (deployed to `enterprise_knowledge_ai` and `enterprise_knowledge_ai_test`)
- [x] Implemented `insertDocumentChunksWithEmbeddings`, `updateDocumentChunkEmbedding`, and tenant-isolated `PgVectorRetrievalService` in `packages/database` (`WHERE dc.organization_id = $1 AND d.organization_id = $1 AND d.status = 'COMPLETED' AND dc.embedding IS NOT NULL`)
- [x] Integrated `EmbeddingProvider.embedDocuments` into `apps/worker` (`document-process.processor.ts`) outside row locks, persisting `vector(1536)` embeddings atomically inside the `FOR UPDATE` chunk-swap transaction
- [x] Implemented `apps/api/src/modules/rag` (`XmlContextAssemblyService` with untrusted-data framing & delimiter escaping, grounded system prompt, `0`-chunk short-circuit, deterministic `validateCitations`, `RagService`) and `/api/v1/conversations` endpoints (`POST /`, `GET /`, `GET /:id`, `DELETE /:id`, `POST /:id/messages`, `GET /:id/messages`) enforcing `authenticate`, `x-organization-id` membership, `(id, organizationId, userId)` ownership, and atomic `Message` + `MessageCitation` + `UsageEvent` persistence
- [x] Verified with unit and live PostgreSQL/`pgvector`, Redis/BullMQ, and MinIO integration tests (`18 test files, 114/114 tests passed`, `pnpm build`, `pnpm typecheck`, `pnpm lint`)

### Sprints 5–8 — Hybrid RAG, Security/Observability, Analytics & Next.js Frontend
- [x] Fixed 404 root causes & improved DX in `apps/api/src/app.ts` (`routerOptions: { ignoreTrailingSlash: true }`, `GET /` & `GET /api/v1` API discovery endpoints, structured `setNotFoundHandler` with `/api/v1` guidance)
- [x] Added PostgreSQL Full-Text Search GIN index (`document_chunks_content_fts_gin_idx` on `to_tsvector('simple', "content")`) and `MessageFeedback` (`FeedbackRating` `UP` | `DOWN`) via migration `20261119132210_sprint5_7_fts_feedback` (deployed to `enterprise_knowledge_ai` and `enterprise_knowledge_ai_test`)
- [x] Implemented `HybridRetrievalService` (`'semantic' | 'lexical' | 'hybrid'`) with Reciprocal Rank Fusion (`k = 60`) in `packages/database/src/hybrid-retrieval.ts` and `HybridLexicalReranker` in `packages/ai/src/reranking/hybrid-lexical-reranker.ts`, wired into `RagService` + `POST /api/v1/conversations/:id/messages`
- [x] Added lexical-only ingestion & RAG mode (`AI_EMBEDDING_PROVIDER=none` default) across `packages/ai`, `apps/worker` (`createMany` without embeddings when disabled), `apps/api` (`GET /api/v1` `rag` capabilities + `'lexical'` default), and `apps/web` chat strategy selector so Groq runs end-to-end without hitting Gemini/OpenAI embedding `429` quotas (while `'gemini'`, `'openai'`, or `'ollama'` can be enabled anytime for hybrid `pgvector` + FTS)
- [x] Split LLM and embedding provider configuration (`AI_LLM_PROVIDER=groq` with `qwen/qwen3.8-27b` default; `AI_EMBEDDING_PROVIDER=none|gemini|openai|ollama`; `hasLLMCredentials` / `hasEmbeddingCredentials`), allowing `apps/api` to run Groq standalone in `'lexical'` FTS mode when embedding credentials are unset while preserving Gemini, OpenAI, and Ollama selection
- [x] Switched default AI provider in `packages/ai` and `apps/api/src/server.ts` to Google Gemini (`gemini-embedding-001` with `outputDimensionality: 1536`, `gemini-2.5-flash`), keeping `'openai'` and `'ollama'` selectable via `AI_PROVIDER` / `AI_LLM_PROVIDER` / `AI_EMBEDDING_PROVIDER`
- [x] Added optional local `OllamaEmbeddingProvider` and `OllamaLLMProvider` (`AI_PROVIDER=ollama`) in `packages/ai` sharing `JsonHttpClient` and enforcing `EMBEDDING_DIMENSIONS = 1536`
- [x] Added `@fastify/cors`, `@fastify/rate-limit` (`429 RATE_LIMIT_EXCEEDED`), `x-request-id` header propagation, and RAG stage latency instrumentation (`embeddingMs`, `retrievalMs`, `rerankMs`, `generationMs`)
- [x] Implemented `POST /api/v1/messages/:id/feedback`, `GET /api/v1/dashboard/overview`, and `GET /api/v1/analytics/{usage,performance,quality}` scoped strictly to active `x-organization-id` membership
- [x] Built Next.js 16 App Router + React 19 + Tailwind CSS v4 frontend (`apps/web`): `/login`, `/register`, protected workspace shell with org switcher, `/organizations`, `/documents` (drag-and-drop upload, live polling, shimmer skeletons, Quick Ask shortcut, reprocess, delete), `/chat` (hybrid/semantic/lexical selector, starter prompts, typing dots, copy answer, animated citations, feedback), and `/analytics` dashboard with animated KPI cards & bars
- [x] Evaluated and implemented PostgreSQL Row-Level Security (RLS) defense-in-depth (`20261119180000_sprint6_rls_policies`, `enterprise_ai_app` role, `withTenantRlsContext`) across all 10 tenant-owned tables with live PostgreSQL integration tests
- [x] Integrated OpenTelemetry-compatible W3C `traceparent` distributed tracing (`TelemetryTracer`) across Fastify API (`http.request`), RAG stages (`rag.*`), BullMQ enqueue, and worker execution (`worker.*`) with optional `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` JSON export
- [x] Created reproducible RAG evaluation suite (`evaluation/dataset.json`, `evaluation/run_benchmark.mjs`, `evaluation/BENCHMARK_REPORT.md`, `evaluation/evaluate_ragas.py`, and `@enterprise-ai/ai` metrics helpers)

## Pending Tasks (Optional Browser E2E)

- [ ] Add Playwright browser end-to-end tests covering the full `apps/web` + `apps/api` + `apps/worker` user journey (not executed automatically without Chromium browser binaries)

## Known Problems / Environment Gaps

- Integration tests connecting to `localhost:5432`, `localhost:6379`, and `localhost:9000` require Docker services (`postgres`, `redis`, `minio`) running and network access (outside the restricted Windows sandbox).
- Pre-Sprint-4 `document_chunks` rows with `embedding IS NULL` are intentionally excluded from semantic vector retrieval until those documents are reprocessed via `POST /api/v1/documents/:id/reprocess`.

## Current Architecture

- `apps/web`: Next.js 16 + React 19 + Tailwind CSS v4 frontend (`http://localhost:3000`) for Auth, Organizations, Document Library, Grounded RAG Chat with Citations/Feedback, and Analytics.
- `apps/api`: Fastify v5 REST API (`http://localhost:3001`) with `GET /` & `/api/v1` discovery, `/health`, `/ready`, `/api/v1/auth/*`, `/api/v1/organizations/*`, `/api/v1/documents/*`, `/api/v1/conversations/*`, `/api/v1/messages/:id/feedback`, `/api/v1/dashboard/overview`, and `/api/v1/analytics/*`, protected by `@fastify/cors`, `@fastify/rate-limit`, and `x-request-id` tracing.
- `apps/worker`: Independent BullMQ background worker consuming `document-processing` jobs, extracting per-page PDF text from MinIO, generating 1536-dim embeddings, and atomically persisting chunks + vectors in PostgreSQL.
- `packages/ai`: Replaceable split AI provider abstraction (`EmbeddingProvider`, `LLMProvider`, `RerankerService`), Groq (default LLM), Google Gemini (default embeddings & optional LLM), OpenAI & Ollama REST clients, centralized `loadAIConfig`, `hasLLMCredentials`, `hasEmbeddingCredentials`, `HybridLexicalReranker`, `AIProviderError` handling, and USD cost estimation.
- `packages/database`: Prisma 7 schema, migrations, `createDatabaseClient`, `checkDatabaseHealth`, `insertDocumentChunksWithEmbeddings`, `PgVectorRetrievalService`, and `HybridRetrievalService`.
- `packages/shared`: Shared constants, health/readiness types, document processing contracts, RAG contracts, and analytics/feedback DTOs.

## Next Recommended Action

1. Review and commit Sprints 5–8 changes to Git when ready.
2. Start Docker (`pnpm infra:up`), API (`pnpm dev`), Worker (`pnpm dev:worker`), and Frontend (`pnpm dev:web`) to explore the live application at `http://localhost:3000`, or proceed with optional OpenTelemetry/RAGAS/RLS/Playwright hardening.
