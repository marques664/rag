# Architecture Overview

## Architectural Style

Enterprise Knowledge AI uses a **Modular Monolith with an independent background worker** inside a `pnpm` workspace monorepo.

## Current Workspace Layout

```text
.
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── config/env.ts                    # Zod-validated runtime env (DB, Redis, JWT, MinIO, upload limit)
│   │   │   ├── infrastructure/
│   │   │   │   ├── queue.ts                     # BullMQ producer queue for document processing
│   │   │   │   ├── redis.ts                     # ioredis client factory and PING check
│   │   │   │   └── storage.ts                   # MinIO S3-compatible upload & deletion client
│   │   │   ├── middleware/
│   │   │   │   ├── authenticate.ts              # Bearer JWT verification hook
│   │   │   │   ├── organization-context.ts      # x-organization-id + Membership + RBAC preHandler hook
│   │   │   │   └── rbac.ts                      # Role hierarchy (OWNER > ADMIN > MEMBER)
│   │   │   ├── modules/
│   │   │   │   ├── auth/                        # Register, login, refresh rotation, logout, /me
│   │   │   │   ├── documents/                   # PDF upload, listing, details, status, reprocess, delete
│   │   │   │   ├── health/                      # Liveness (/health) and readiness (/ready)
│   │   │   │   └── organizations/               # Tenant-isolated orgs, memberships, invitations
│   │   │   ├── shared/
│   │   │   │   ├── errors/app-error.ts          # Typed domain-to-HTTP error hierarchy
│   │   │   │   └── security/                    # scrypt password hashing & jose JWT/token helpers
│   │   │   ├── types/fastify.d.ts               # Typed FastifyRequest.auth & organizationContext augmentation
│   │   │   ├── app.ts                           # Fastify v5 app factory
│   │   │   └── server.ts                        # Process entrypoint and graceful shutdown
│   │   └── tests/
│   └── worker/
│       ├── src/
│       │   ├── config/env.ts                    # Zod-validated worker env (DB, Redis, MinIO, concurrency/retries)
│       │   ├── infrastructure/
│       │   │   ├── logger.ts                    # Pino structured logger factory
│       │   │   ├── redis.ts                     # ioredis client (maxRetriesPerRequest: null for BullMQ)
│       │   │   └── storage.ts                   # MinIO S3-compatible PDF byte reader
│       │   ├── processors/
│       │   │   └── document-process.processor.ts # Idempotent, version-fenced PDF ingestion & chunk swap
│       │   ├── queues/
│       │   │   └── document-processing.worker.ts # BullMQ Worker subscription & lifecycle hooks
│       │   ├── services/
│       │   │   ├── chunker.service.ts           # Deterministic page-aware token chunker (~500 / ~75 overlap)
│       │   │   └── pdf-extractor.service.ts     # unpdf per-page PDF text extractor
│       │   └── worker.ts                        # Independent worker entrypoint & SIGINT/SIGTERM shutdown
│       └── tests/
├── packages/
│   ├── database/
│   │   ├── prisma/
│   │   │   ├── migrations/                      # SQL migrations
│   │   │   └── schema.prisma                    # Prisma 7 schema (PostgreSQL + ESM client)
│   │   ├── prisma.config.ts                     # Prisma 7 CLI/migration config (loads root .env)
│   │   ├── src/client.ts                        # PrismaPg adapter + PrismaClient factory
│   │   ├── src/health.ts                        # Connectivity + pgvector extension check
│   │   └── tests/
│   └── shared/
│       └── src/                                 # Shared constants, health types, and document contracts
├── infrastructure/
│   └── postgres/init.sql                        # Enables pgvector extension on first DB boot
├── docker-compose.yml                           # Local PostgreSQL+pgvector, Redis, MinIO stack
└── docs/                                        # Architecture, decisions, status, and dev log
```

## Main Components

- **Authentication & Sessions (`apps/api/src/modules/auth`)**: Issues short-lived HS256 access JWTs (`jose`) and opaque 256-bit refresh tokens stored as SHA-256 hashes in PostgreSQL (`refresh_tokens`). Refresh rotation tracks token families (`familyId`) and revokes the entire session family on token reuse detection.
- **Organizations & Multi-Tenancy (`apps/api/src/modules/organizations`)**: Every organization-scoped query in `OrganizationsRepository` enforces `organizationId` directly in PostgreSQL `where` clauses (including composite `(organizationId, userId)` lookups). RBAC enforces `OWNER > ADMIN > MEMBER` permissions and prevents demoting the last organization `OWNER`.
- **Documents API & Object Storage (`apps/api/src/modules/documents`, `apps/api/src/infrastructure/{storage,queue}.ts`, `apps/api/src/middleware/organization-context.ts`)**: Enforces `x-organization-id` membership and RBAC in `preHandler` before reading multipart streams, validates `.pdf` extension, `application/pdf` MIME, file size, and `%PDF-` magic bytes, computes SHA-256 checksums, stores original PDFs in MinIO under opaque UUID keys, persists `Document` and `ProcessingJob` records in PostgreSQL, and enqueues BullMQ jobs.
- **Asynchronous Document Worker (`apps/worker`)**: Subscribes to the Redis-backed `document-processing` BullMQ queue, validates `processingVersion` fences, downloads PDF bytes from MinIO, verifies `%PDF-` magic bytes and SHA-256 integrity, extracts per-page text with `unpdf`, splits pages into ~500-token chunks with ~75-token overlap, and atomically replaces `document_chunks` inside a `SELECT ... FOR UPDATE` PostgreSQL transaction.
- **Database Layer (`packages/database`)**: Uses Prisma ORM v7 with `@prisma/adapter-pg` and `pg`. Migrations are managed via `prisma migrate dev` / `deploy`.
- **Local Infrastructure (`docker-compose.yml`)**: PostgreSQL 17 (`pgvector/pgvector:pg17`), Redis 7 (`redis:7-alpine`), and MinIO (`cgr.dev/chainguard/minio:latest`).

## Asynchronous PDF Ingestion Flow

1. **Upload (`POST /api/v1/documents`)**: `authenticate` + `createRequireOrganizationRoleHook` (`MEMBER`+) verify JWT and organization membership before `@fastify/multipart` parses the single-file stream.
2. **Validation & MinIO Storage**: `validatePdfUpload` checks filename sanitization, `.pdf` extension, `application/pdf` MIME, size bounds, `%PDF-` header bytes, and SHA-256 checksum. `MinioDocumentStorage` uploads the PDF to `organizations/{orgId}/documents/{docId}/{uuid}.pdf`.
3. **Database & Queue Submission**: PostgreSQL creates `Document` (`PENDING`, `processingVersion = 1`) and `ProcessingJob` (`PENDING`) atomically (deleting the MinIO object as compensation if the DB transaction fails). `BullMqDocumentQueue` enqueues `DocumentProcessJobPayload` onto `document-processing` (3 attempts, 2000ms exponential backoff). If enqueueing fails, both records transition to `FAILED` and the API returns `503`.
4. **Worker Extraction & Chunking**: `apps/worker` transitions `Document` and `ProcessingJob` to `PROCESSING` (guarded by `processingVersion`), downloads and verifies the PDF from MinIO, extracts 1-based page text via `UnpdfTextExtractor`, and builds deterministic chunks via `PageAwareTokenChunker`.
5. **Atomic Persistence & Recovery**: Inside `database.$transaction`, the worker locks the `documents` row (`SELECT ... FOR UPDATE`), confirms `processingVersion` matches, deletes any prior chunks, inserts new `DocumentChunk` rows (`@@unique([documentId, chunkIndex])`), and marks `Document` and `ProcessingJob` `COMPLETED`. On `POST /api/v1/documents/:id/reprocess` (`ADMIN`+), existing chunks are deleted and `processingVersion` is incremented so stale in-flight jobs exit cleanly. On `DELETE /api/v1/documents/:id` (`ADMIN`+), PostgreSQL deletes the `Document` (cascading chunks/jobs) first, then MinIO deletes `storageKey`.
