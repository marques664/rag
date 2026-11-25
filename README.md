# Enterprise Knowledge AI

Multi-tenant AI-powered knowledge management platform designed to transform unstructured business documents into searchable, contextualized knowledge using Retrieval-Augmented Generation (RAG) with verifiable source citations.

## Architecture

This project follows a **Modular Monolith with an independent background worker** organized as a `pnpm` monorepo:

- `apps/web` (`@enterprise-ai/web`): Next.js 16 App Router + React 19 + Tailwind CSS v4 frontend (`http://localhost:3000`) for Auth, Organizations, Document Library, Grounded RAG Chat with Citations & Feedback, and Analytics.
- `apps/api`: Fastify v5 + TypeScript REST API (`http://localhost:3001`) with `GET /` & `GET /api/v1` discovery, Zod validation, Pino structured logging with `x-request-id`, CORS & rate limiting, tenant-isolated documents, hybrid RAG orchestration, `/api/v1/conversations`, `/api/v1/messages/:id/feedback`, `/api/v1/dashboard/overview`, and `/api/v1/analytics/*`.
- `apps/worker` (`@enterprise-ai/worker`): Independent BullMQ background worker that downloads PDFs from MinIO, extracts per-page text with `unpdf`, generates overlapping chunks and `1536`-dimension embeddings, and persists chunks + vectors atomically in PostgreSQL.
- `packages/ai` (`@enterprise-ai/ai`): Replaceable split AI provider abstraction (`EmbeddingProvider`, `LLMProvider`, `RerankerService`) with centralized Zod config, Groq default LLM (`qwen/qwen3.8-27b`), paced Google Gemini embeddings (`gemini-embedding-001` at `1536` dims, auto-selected when `GEMINI_API_KEY` is set; `AI_EMBEDDING_PROVIDER=none` opt-out for lexical-only ingestion), plus optional OpenAI and Ollama `fetch` clients, `HybridLexicalReranker`, timeouts/retries (including Gemini `RetryInfo` delay extraction), secret redaction, and USD cost estimation.
- `packages/database`: Prisma ORM (`prisma-client` + `@prisma/adapter-pg`), `pgvector` vector persistence helpers, `PgVectorRetrievalService`, and `HybridRetrievalService` (semantic + PostgreSQL FTS + RRF).
- `packages/shared`: Shared domain-neutral constants, health types, document processing contracts, RAG contracts, and analytics/feedback DTOs.
- `infrastructure/postgres`: Database bootstrap script enabling the `vector` extension (`pgvector`).

## Prerequisites

- **Node.js** `>= 24.0.0` (verified on `v24.20.0`)
- **pnpm** `>= 9.0.0` (verified on `12.21.0`)
- **Docker & Docker Compose** (required to run PostgreSQL + `pgvector`, Redis 7, and MinIO locally)
- **Git** (optional for initial local setup, recommended for version control)

## Local Setup

1. Copy the environment template and configure AI/RAG environment variables as needed:

   ```bash
   cp .env.example .env
   ```

   Key AI, RAG & API variables (see `packages/ai/src/config/ai-config.ts` and `apps/api/src/config/env.ts`):
   - `AI_LLM_PROVIDER`: `'groq'` (default), `'gemini'`, `'openai'`, or `'ollama'`.
   - `AI_EMBEDDING_PROVIDER`: Auto-selects `'gemini'` when `GEMINI_API_KEY` is set (and defaults to `'none'` when unset); explicitly set `'none'` to disable vector embeddings and run lexical-only PostgreSQL FTS ingestion/chat, or choose `'gemini'`, `'openai'`, or `'ollama'`.
   - `GROQ_API_KEY`: Required when `AI_LLM_PROVIDER=groq` by `apps/api` to answer `POST /api/v1/conversations/:id/messages`. Groq defaults: `GROQ_BASE_URL` (`https://api.groq.com/openai/v1`), `GROQ_CHAT_MODEL` (`qwen/qwen3.8-27b`; other open-weight alternatives on Groq include `openai/gpt-oss-120b` and `openai/gpt-oss-20b`). When no embedding provider is active, both `apps/worker` PDF ingestion and `apps/api` (`'lexical'` FTS mode, advertised via `GET /api/v1` `rag` capabilities) run cleanly without embedding API calls.
   - `GEMINI_API_KEY`: Enables paced `1536`-dim `pgvector` + `'hybrid'` RRF retrieval automatically (unless `AI_EMBEDDING_PROVIDER=none` is explicitly set). Gemini defaults: `GEMINI_BASE_URL` (`https://generativelanguage.googleapis.com/v1beta`), `GEMINI_EMBEDDING_MODEL` (`gemini-embedding-001`, default batch size `20` with `1000ms` inter-batch pacing), `GEMINI_EMBEDDING_DIMENSIONS` (`1536`, fixed via `outputDimensionality: 1536` to match `vector(1536)`), `GEMINI_CHAT_MODEL` (`gemini-2.5-flash`).
   - OpenAI options (when `AI_LLM_PROVIDER=openai` / `AI_EMBEDDING_PROVIDER=openai`): `OPENAI_API_KEY`, `OPENAI_BASE_URL` (`https://api.openai.com/v1`), `OPENAI_EMBEDDING_MODEL` (`text-embedding-3-small`), `OPENAI_EMBEDDING_DIMENSIONS` (`1536`), `OPENAI_CHAT_MODEL` (`gpt-4o-mini`).
   - Ollama options (when `'ollama'`): `OLLAMA_BASE_URL` (`http://localhost:11434`), `OLLAMA_EMBEDDING_MODEL` (`nomic-embed-text`), `OLLAMA_EMBEDDING_DIMENSIONS` (`1536`), `OLLAMA_CHAT_MODEL` (`llama3.1`).
   - `AI_REQUEST_TIMEOUT_MS` (`30000`), `AI_MAX_RETRIES` (`3`), `AI_RETRY_BASE_DELAY_MS` (`500`), `AI_EMBEDDING_BATCH_SIZE` (`20` default for Gemini, `64` for OpenAI/Ollama), `AI_EMBEDDING_BATCH_DELAY_MS` (`1000` inter-batch pacing delay), `WORKER_LOCK_DURATION_MS` (`120000` BullMQ worker lock duration for multi-batch PDFs).
   - `RAG_RETRIEVAL_STRATEGY` (`hybrid` when embeddings are active; `apps/api` automatically defaults to `lexical` when embeddings are disabled), `RAG_DEFAULT_TOP_K` (`5`), `RAG_MAX_CONTEXT_CHARS` (`24000`).
   - `CORS_ORIGIN` (`http://localhost:3000`, comma-separated origins), `RATE_LIMIT_MAX` (`120`), `RATE_LIMIT_WINDOW_MS` (`60000`).
   - Frontend (`apps/web`): `NEXT_PUBLIC_API_URL` (`http://localhost:3001/api/v1` default).

   > **Note on pre-Sprint-4 documents**: Document chunks ingested before Sprint 4 (`embedding IS NULL`) are excluded from semantic vector retrieval until their documents are reprocessed (`POST /api/v1/documents/:id/reprocess`).

2. Install workspace dependencies:

   ```bash
   pnpm install
   ```

3. Start local infrastructure services (PostgreSQL 17 with `pgvector`, Redis 7, and MinIO):

   ```bash
   pnpm infra:up
   ```

4. Generate the Prisma client, deploy migrations, and build workspace packages:

   ```bash
   pnpm db:generate
   pnpm --filter @enterprise-ai/database db:migrate:deploy
   pnpm build
   ```

5. Start the API server, background worker, and Next.js web UI in development mode (in separate terminals):

   ```bash
   pnpm dev
   pnpm dev:worker
   pnpm dev:web
   ```

6. Verify endpoints and open the UI:

   - Web UI: `http://localhost:3000`
   - API Discovery: `GET http://localhost:3001/` and `GET http://localhost:3001/api/v1`
   - Liveness: `GET http://localhost:3001/health` (and `GET http://localhost:3001/api/v1/health`)
   - Readiness: `GET http://localhost:3001/ready` (and `GET http://localhost:3001/api/v1/ready`)

## Useful Scripts

- `pnpm dev`: Start the Fastify API in watch mode (`tsx watch`).
- `pnpm dev:worker`: Start the `@enterprise-ai/worker` BullMQ consumer in watch mode (`tsx watch`).
- `pnpm dev:web`: Start the Next.js 16 frontend on port `3000`.
- `pnpm build`: Compile all workspace packages (`@enterprise-ai/shared`, `@enterprise-ai/database`, `@enterprise-ai/ai`, `@enterprise-ai/api`, `@enterprise-ai/worker`, `@enterprise-ai/web`).
- `pnpm typecheck`: Run TypeScript type checking across `src` and `tests`.
- `pnpm lint`: Run ESLint across the monorepo.
- `pnpm test`: Run the Vitest test suite (`vitest run --configLoader native`).
- `pnpm db:generate`: Generate the Prisma client in `packages/database/src/generated/prisma`.
- `pnpm db:migrate`: Create and apply Prisma migrations in development (`prisma migrate dev`).
- `pnpm infra:up` / `pnpm infra:down`: Start or stop Docker Compose services.
