# Technical Decisions

## TD-001: Prisma ORM v7 with `@prisma/adapter-pg` and `prisma-client` ESM Generator

- **Context**: Prisma v7 moves datasource URL configuration out of `schema.prisma` into `prisma.config.ts`, deprecates the `postgresqlExtensions` preview feature, and replaces `prisma-client-js` with the `prisma-client` generator outputting TypeScript into a local directory.
- **Decision**: Use `provider = "prisma-client"` outputting to `packages/database/src/generated/prisma` with `moduleFormat = "esm"` and `importFileExtension = "js"`, paired with `@prisma/adapter-pg` (`PrismaPg`). Manage the `vector` extension explicitly via `infrastructure/postgres/init.sql` (and SQL migrations in future sprints).
- **Consequences**: Clean Node 24 ESM compatibility (`NodeNext`), explicit driver adapter lifecycle, and no reliance on deprecated preview features. Requires running `pnpm db:generate` before building `packages/database`.

## TD-002: Explicit Dependency Injection in `buildApp()`

- **Context**: The API server exposes `/health` (liveness) and `/ready` (readiness). Testing readiness degraded states (`503`) and liveness (`200`) should not require live Docker containers during unit/CI runs.
- **Decision**: Decouple `buildApp(options)` from `server.ts` and accept `checkDatabase` and `checkRedis` callbacks as dependencies. `server.ts` wires real Prisma and `ioredis` clients, while tests inject deterministic stubs via `fastify.inject()`.
- **Consequences**: Fast, deterministic tests without mocking module globals, while keeping production startup clean and explicit.

## TD-003: Dual Exposure of Health Probes (`/` and `/api/v1`)

- **Context**: `docs/master_prompt.md` specifies `/api/v1` as the REST API base path while Sprint 1 calls for `GET /health` and infrastructure probes commonly target root `/health` and `/ready`.
- **Decision**: Register the shared `registerHealthRoutes` plugin both at root (`/health`, `/ready`) and under `/api/v1` (`/api/v1/health`, `/api/v1/ready`).
- **Consequences**: Container orchestrators and developers both get predictable liveness/readiness routes without duplicating route logic.

## TD-004: Strict TypeScript Compilation of Both `src` and `tests`

- **Context**: Workspace `tsconfig.json` files emit only `src/**/*.ts` into `dist/` so test files are never bundled into build artifacts.
- **Decision**: Add `tsconfig.typecheck.json` extending `tsconfig.json` with `noEmit: true` and `include: ["src/**/*.ts", "tests/**/*.ts"]` in packages that contain tests.
- **Consequences**: `pnpm typecheck` catches type errors in test suites as well as production code.

## TD-005: Vitest `--configLoader native` on Node.js 24

- **Context**: Vite's default config bundler writes temporary files under `node_modules/.vite-temp`, which fails in restricted sandboxes (`EPERM` on `mkdir`) and adds startup overhead.
- **Decision**: Run Vitest with `--configLoader native` in root `package.json`, leveraging Node 24's native TypeScript execution for `vitest.config.ts`.
- **Consequences**: Faster test startup and clean execution without temporary filesystem artifacts.

## TD-006: Chainguard MinIO & MinIO Client Images in Docker Compose

- **Context**: Official `minio/minio` and `minio/mc` repositories on Docker Hub returned `pull access denied / repository does not exist` because MinIO removed its Docker Hub images.
- **Decision**: Use `cgr.dev/chainguard/minio:latest` and `cgr.dev/chainguard/minio-client:latest` in `docker-compose.yml`, configuring `minio-init` via `MC_HOST_local` so bucket initialization runs directly via `/usr/bin/mc` without a wrapper script.
- **Consequences**: Reproducible anonymous pulls from Chainguard's public registry, non-root container execution, and verified S3-compatible local storage with automatic bucket creation.

## TD-007: Built-in Node.js `scrypt` + `jose` JWTs + Refresh Token Family Rotation

- **Context**: Sprint 2 requires secure password hashing, stateless API authentication, and revocable sessions without introducing heavy native dependencies or framework lock-in.
- **Decision**: Use Node.js built-in `crypto.scrypt` (`N=16384, r=8, p=1`, random 16-byte salt, `timingSafeEqual`) for passwords, `jose` (`HS256`) for short-lived access JWTs, and opaque 32-byte refresh tokens stored as SHA-256 hashes with `familyId` tracking in PostgreSQL. Reusing an already-rotated refresh token atomically revokes all tokens in that `familyId`.
- **Consequences**: Zero native C++ build dependencies on Windows/Linux, constant-time verification, and defense against stolen refresh token replay.

## TD-008: Email-Bound Organization Invitation Acceptance

- **Context**: Users can belong to multiple organizations with different roles (`OWNER`, `ADMIN`, `MEMBER`), and Sprint 2 has no outbound email delivery service yet.
- **Decision**: `POST /api/v1/organizations/:id/invitations` creates a `PENDING` `OrganizationInvitation` with an expiry timestamp. Authenticated users list their pending invitations (`GET /api/v1/organizations/invitations`) and accept via `POST /api/v1/organizations/invitations/:invitationId/accept`, which enforces `invitation.email === request.auth.email` and atomically transitions the invitation to `ACCEPTED` while creating the `Membership`.
- **Consequences**: Prevents unauthorized users from claiming another user's invitation without requiring an external SMTP server in Sprint 2.

## TD-009: Isolated `enterprise_knowledge_ai_test` Database for Integration Tests

- **Context**: Running real PostgreSQL integration tests against the primary development database risks wiping or polluting manual development data.
- **Decision**: Provision a separate `enterprise_knowledge_ai_test` database (with `pgvector` and deployed Prisma migrations) configured via `TEST_DATABASE_URL`, and truncate test tables before each integration test case.
- **Consequences**: Fast, deterministic integration testing against real PostgreSQL constraints, transactions, and indexes without affecting local development data.

## TD-010: Defer `DocumentChunk.embedding` (`pgvector`) Column to Sprint 4

- **Context**: `docs/master_prompt.md` lists `embedding` (`vector`) on `DocumentChunks` and requires embedding models to have a fixed, documented dimensionality without mixing incompatible embeddings in the same vector index, while `docs/SPRINT3.md` explicitly excludes embeddings and vector retrieval from Sprint 3.
- **Decision**: Omit the `embedding` column and vector index from `20261118133209_sprint3_document_processing` and defer adding `Unsupported("vector(N)")` + the vector index until Sprint 4 when the embedding provider and dimensionality are selected. Denormalize `organization_id` onto `document_chunks` now with `(organization_id, document_id)` indexing so Sprint 4 `pgvector` retrieval and Sprint 6 RLS can filter tenants directly on `document_chunks`.
- **Consequences**: Avoids locking in a speculative vector dimension or shadow-DB `CREATE EXTENSION` ordering before Sprint 4, while keeping `document_chunks` schema-ready for direct tenant-isolated vector retrieval.

## TD-011: `x-organization-id` Header with Pre-Stream Membership & RBAC Validation

- **Context**: Users can belong to multiple organizations, and `docs/master_prompt.md` Section 7 defines document endpoints at `/api/v1/documents`. Multipart uploads must reject unauthorized callers before buffering PDF payloads into memory.
- **Decision**: Scope `/api/v1/documents` endpoints via a required `x-organization-id` UUID header validated alongside JWT authentication, PostgreSQL `Membership` lookup, and RBAC (`MEMBER`+ for upload/list/get/status, `ADMIN`+ for reprocess/delete) in Fastify `preHandler` hooks before reading multipart streams.
- **Consequences**: Aligns routes with the API specification, ensures immediate enforcement of membership/role changes even before short-lived JWTs expire, and prevents unauthenticated or cross-tenant multipart buffering.

## TD-012: `processingVersion` Fencing, `SELECT ... FOR UPDATE` Chunk Swap, and DB-First Deletion

- **Context**: Asynchronous reprocessing, worker retries, and concurrent document deletion can race, risking duplicate chunks, stale chunks remaining readable, or orphaned chunks after deletion.
- **Decision**: Add `processingVersion` to `Document` and `DocumentProcessJobPayload`. On `POST /api/v1/documents/:id/reprocess`, an atomic `$transaction` guards `status IN ('COMPLETED', 'FAILED')`, increments `processingVersion`, resets status to `PENDING`, deletes existing `document_chunks`, and creates a new `ProcessingJob`. In `apps/worker`, `processDocumentJob` checks `processingVersion` at start and again inside its final `$transaction` using `SELECT id, processing_version FROM documents WHERE id = $1::uuid FOR UPDATE` before replacing chunks (`deleteMany` + `createMany` with `@@unique([documentId, chunkIndex])`). On `DELETE /api/v1/documents/:id`, PostgreSQL deletes the `Document` (cascading chunks and jobs) first, then MinIO deletes `storageKey` (ignoring `NoSuchKey`).
- **Consequences**: Stale jobs and mid-flight deletions abort cleanly without corrupting current state, old chunks cannot remain accessible after reprocessing, and tenant access is revoked immediately on delete even if object cleanup fails transiently.

## TD-013: `unpdf` Extraction, Page-Aware ~500/75 Token Chunking, and `UnrecoverableError` Classification

- **Context**: Sprint 3 requires Node.js 24 ESM-compatible text extraction preserving 1-based page numbers, ~500-token chunks with ~75-token overlap, and exponential-backoff retries that do not loop on permanently invalid PDFs.
- **Decision**: Use `unpdf` (`getDocumentProxy` + `extractText(..., { mergePages: false })`) with `pdf.destroy()` in `finally`, paired with `PageAwareTokenChunker` splitting within page boundaries using shared `DEFAULT_CHUNK_SIZE_TOKENS = 500` and `DEFAULT_CHUNK_OVERLAP_TOKENS = 75` constants. Classify corrupt/encrypted/zero-text PDFs, missing MinIO objects, and SHA-256 mismatches as BullMQ `UnrecoverableError` so BullMQ transitions them directly to `FAILED` instead of exhausting retries.
- **Consequences**: Zero native canvas/`DOMMatrix` runtime dependencies on Node 24, exact page attribution per chunk, and bounded retry queues for permanent failures.

## TD-014: Sequential Vitest Execution (`fileParallelism: false`) for Shared Infrastructure Suites

- **Context**: Integration test suites (`backend-core.integration.test.ts`, `documents.integration.test.ts`, and `document-process.integration.test.ts`) share the `enterprise_knowledge_ai_test` PostgreSQL database (truncated in `beforeEach`) and the `document-processing` BullMQ queue. Running test files concurrently causes cross-file table truncation and queue interference.
- **Decision**: Configure `fileParallelism: false` in root `vitest.config.ts` so Vitest executes test files sequentially against the shared local test infrastructure.
- **Consequences**: Deterministic integration test runs across API and worker suites without cross-file race conditions.
