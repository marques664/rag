# Enterprise Knowledge AI

Multi-tenant AI-powered knowledge management platform designed to transform unstructured business documents into searchable, contextualized knowledge using Retrieval-Augmented Generation (RAG) with verifiable source citations.

## Architecture

This project follows a **Modular Monolith with an independent background worker** organized as a `pnpm` monorepo:

- `apps/api`: Fastify v5 + TypeScript REST API with Zod validation, Pino structured logging, tenant-isolated documents, grounded RAG orchestration, and `/api/v1/conversations`.
- `apps/worker` (`@enterprise-ai/worker`): Independent BullMQ background worker that downloads PDFs from MinIO, extracts per-page text with `unpdf`, generates overlapping chunks and `1536`-dimension embeddings, and persists chunks + vectors atomically in PostgreSQL.
- `packages/ai` (`@enterprise-ai/ai`): Replaceable AI provider abstraction (`EmbeddingProvider`, `LLMProvider`) with centralized Zod config, OpenAI `fetch` clients (`text-embedding-3-small`, `gpt-4o-mini`), timeouts/retries, secret redaction, and USD cost estimation.
- `packages/database`: Prisma ORM (`prisma-client` + `@prisma/adapter-pg`), `pgvector` vector persistence helpers, and tenant-isolated `PgVectorRetrievalService`.
- `packages/shared`: Shared domain-neutral constants, health types, document processing contracts, and RAG contracts (`Citation`, `UsageInformation`, `RAGResponse`, `RetrievalService`).
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

   Key AI & RAG variables (see `packages/ai/src/config/ai-config.ts` and `apps/api/src/config/env.ts`):
   - `OPENAI_API_KEY`: Required by `apps/worker` at startup to generate chunk embeddings and by `apps/api` to answer `POST /api/v1/conversations/:id/messages` (when unset, the API still starts and returns `503 AI_PROVIDER_NOT_CONFIGURED` for RAG queries).
   - `AI_PROVIDER` (`openai`), `OPENAI_BASE_URL` (`https://api.openai.com/v1`), `OPENAI_EMBEDDING_MODEL` (`text-embedding-3-small`), `OPENAI_EMBEDDING_DIMENSIONS` (`1536`, fixed to match the `vector(1536)` schema/index), `OPENAI_CHAT_MODEL` (`gpt-4o-mini`).
   - `AI_REQUEST_TIMEOUT_MS` (`30000`), `AI_MAX_RETRIES` (`3`), `AI_RETRY_BASE_DELAY_MS` (`500`), `AI_EMBEDDING_BATCH_SIZE` (`64`).
   - `RAG_DEFAULT_TOP_K` (`5`), `RAG_MAX_CONTEXT_CHARS` (`24000`).

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

5. Start the API server and background worker in development mode (in separate terminals):

   ```bash
   pnpm dev
   pnpm dev:worker
   ```

6. Verify health endpoints:

   - Liveness: `GET http://localhost:3001/health` (and `GET http://localhost:3001/api/v1/health`)
   - Readiness: `GET http://localhost:3001/ready` (and `GET http://localhost:3001/api/v1/ready`)

## Useful Scripts

- `pnpm dev`: Start the Fastify API in watch mode (`tsx watch`).
- `pnpm dev:worker`: Start the `@enterprise-ai/worker` BullMQ consumer in watch mode (`tsx watch`).
- `pnpm build`: Compile all workspace packages (`@enterprise-ai/shared`, `@enterprise-ai/database`, `@enterprise-ai/ai`, `@enterprise-ai/api`, `@enterprise-ai/worker`).
- `pnpm typecheck`: Run TypeScript type checking across `src` and `tests`.
- `pnpm lint`: Run ESLint across the monorepo.
- `pnpm test`: Run the Vitest test suite (`vitest run --configLoader native`).
- `pnpm db:generate`: Generate the Prisma client in `packages/database/src/generated/prisma`.
- `pnpm db:migrate`: Create and apply Prisma migrations in development (`prisma migrate dev`).
- `pnpm infra:up` / `pnpm infra:down`: Start or stop Docker Compose services.
