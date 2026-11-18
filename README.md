# Enterprise Knowledge AI

Multi-tenant AI-powered knowledge management platform designed to transform unstructured business documents into searchable, contextualized knowledge using Retrieval-Augmented Generation (RAG) with verifiable source citations.

## Architecture

This project follows a **Modular Monolith with an independent background worker** organized as a `pnpm` monorepo:

- `apps/api`: Fastify v5 + TypeScript REST API with Zod validation and Pino structured logging.
- `apps/worker` (`@enterprise-ai/worker`): Independent BullMQ background worker that downloads PDFs from MinIO, extracts per-page text with `unpdf`, generates overlapping chunks, and persists chunks atomically in PostgreSQL.
- `packages/database`: Prisma ORM (`prisma-client` + `@prisma/adapter-pg`) and PostgreSQL + `pgvector` health/connection utilities.
- `packages/shared`: Shared domain-neutral constants, health types, and document processing contracts.
- `infrastructure/postgres`: Database bootstrap script enabling the `vector` extension (`pgvector`).

## Prerequisites

- **Node.js** `>= 24.0.0` (verified on `v24.20.0`)
- **pnpm** `>= 9.0.0` (verified on `12.21.0`)
- **Docker & Docker Compose** (required to run PostgreSQL + `pgvector`, Redis 7, and MinIO locally)
- **Git** (optional for initial local setup, recommended for version control)

## Local Setup

1. Copy the environment template:

   ```bash
   cp .env.example .env
   ```

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
- `pnpm build`: Compile all workspace packages (`@enterprise-ai/shared`, `@enterprise-ai/database`, `@enterprise-ai/api`, `@enterprise-ai/worker`).
- `pnpm typecheck`: Run TypeScript type checking across `src` and `tests`.
- `pnpm lint`: Run ESLint across the monorepo.
- `pnpm test`: Run the Vitest test suite (`vitest run --configLoader native`).
- `pnpm db:generate`: Generate the Prisma client in `packages/database/src/generated/prisma`.
- `pnpm db:migrate`: Create and apply Prisma migrations in development (`prisma migrate dev`).
- `pnpm infra:up` / `pnpm infra:down`: Start or stop Docker Compose services.
