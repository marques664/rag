# Project Status

## Current Sprint

- **Sprint 4 — Core RAG**: **Completed**
- **Next Sprint**: **Sprint 5 — Advanced RAG** (Ready to start)

## Current Task

- Sprint 4 Core RAG pipeline (`@enterprise-ai/ai` OpenAI embedding & LLM provider abstraction, `pgvector` `vector(1536)` schema & partial HNSW cosine index, tenant-isolated SQL semantic retrieval, worker chunk embedding persistence, grounded RAG orchestration with prompt-injection defenses & deterministic citations, `/api/v1/conversations` endpoints, and unit/integration verification against live PostgreSQL/pgvector, Redis, and MinIO) is complete and verified.

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

## Pending Tasks (Next: Sprint 5 — Advanced RAG)

- [ ] Implement PostgreSQL Full Text Search (`tsvector` / GIN) for lexical retrieval
- [ ] Implement hybrid retrieval combining semantic (`pgvector`) and lexical search
- [ ] Implement result fusion (e.g., Reciprocal Rank Fusion) and reranking
- [ ] Experiment with chunking strategies and context optimization
- [ ] Create evaluation dataset and reproducible retrieval comparison benchmarks

## Known Problems / Environment Gaps

- Integration tests connecting to `localhost:5432`, `localhost:6379`, and `localhost:9000` require Docker services (`postgres`, `redis`, `minio`) running and network access (outside the restricted Windows sandbox).
- Pre-Sprint-4 `document_chunks` rows with `embedding IS NULL` are intentionally excluded from semantic retrieval until those documents are reprocessed via `POST /api/v1/documents/:id/reprocess`.

## Current Architecture

- `apps/api`: Fastify v5 REST API with `/health`, `/ready`, `/api/v1/auth/*`, `/api/v1/organizations/*`, `/api/v1/documents/*`, and `/api/v1/conversations/*` (RAG orchestration & grounded Q&A).
- `apps/worker`: Independent BullMQ background worker consuming `document-processing` jobs, extracting per-page PDF text from MinIO, generating 1536-dim embeddings, and atomically persisting chunks + vectors in PostgreSQL.
- `packages/ai`: Replaceable AI provider abstraction (`EmbeddingProvider`, `LLMProvider`), OpenAI REST clients, centralized `loadAIConfig`, `AIProviderError` handling, and USD cost estimation.
- `packages/database`: Prisma 7 schema, migrations, `createDatabaseClient`, `checkDatabaseHealth`, `insertDocumentChunksWithEmbeddings`, and `PgVectorRetrievalService`.
- `packages/shared`: Shared constants, health/readiness types, document processing contracts, and RAG contracts (`Citation`, `UsageInformation`, `RAGResponse`, `RetrievalService`).

## Next Recommended Action

1. Review and commit Sprint 4 changes to Git when ready.
2. Begin **Sprint 5 — Advanced RAG**: add PostgreSQL Full Text Search, hybrid retrieval + result fusion, reranking, and evaluation datasets.
