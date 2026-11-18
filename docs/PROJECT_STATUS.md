# Project Status

## Current Sprint

- **Sprint 3 — Document Processing**: **Completed**
- **Next Sprint**: **Sprint 4 — Core RAG** (Ready to start)

## Current Task

- Sprint 3 asynchronous PDF ingestion pipeline (database models & migration, shared queue/chunking contracts, MinIO S3 storage, Fastify multipart upload/management endpoints, independent `apps/worker` BullMQ + `unpdf` processor, and unit/integration tests against live PostgreSQL, Redis, and MinIO) is complete and verified.

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

## Pending Tasks (Next: Sprint 4 — Core RAG)

- [ ] Add `embedding` (`vector(N)`) column and vector index on `document_chunks` once the embedding provider & fixed dimensionality are configured
- [ ] Create `packages/ai` provider abstraction (embeddings + LLM generation)
- [ ] Implement embedding generation for document chunks and vector persistence in PostgreSQL/`pgvector`
- [ ] Implement tenant-aware semantic retrieval (`WHERE organization_id = $1` directly in `pgvector` queries)
- [ ] Add `Conversation`, `Message`, `MessageCitation`, and `UsageEvent` models and `/api/v1/conversations` endpoints with grounded prompts, source citations, and insufficient-context handling

## Known Problems / Environment Gaps

- Integration tests connecting to `localhost:5432`, `localhost:6379`, and `localhost:9000` require Docker services (`postgres`, `redis`, `minio`) running and network access (outside the restricted Windows sandbox).

## Current Architecture

- `apps/api`: Fastify v5 REST API with `/health`, `/ready`, `/api/v1/auth/*`, `/api/v1/organizations/*`, and `/api/v1/documents/*`.
- `apps/worker`: Independent BullMQ background worker consuming `document-processing` jobs, extracting per-page PDF text from MinIO, and atomically persisting chunks in PostgreSQL.
- `packages/database`: Prisma 7 schema, migrations, `createDatabaseClient`, and `checkDatabaseHealth`.
- `packages/shared`: Shared constants, health/readiness types, and document processing contracts.

## Next Recommended Action

1. Review and commit Sprint 3 changes to Git when ready.
2. Begin **Sprint 4 — Core RAG**: finalize embedding model dimensionality, add the `document_chunks.embedding` `pgvector` column + index, implement `packages/ai`, and build tenant-aware semantic retrieval + grounded conversations.
