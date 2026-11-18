# Project Status

## Current Sprint

- **Sprint 2 — Backend Core**: **Completed**
- **Next Sprint**: **Sprint 3 — Document Processing** (Ready to start)

## Current Task

- Sprint 2 backend core (database models, auth, organizations, memberships, RBAC, tenant isolation, and real PostgreSQL integration tests) is complete and verified; ready for Sprint 3 (asynchronous PDF ingestion with MinIO + BullMQ worker).

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

## Pending Tasks (Next: Sprint 3 — Document Processing)

- [ ] Add `Document`, `DocumentChunk`, and `ProcessingJob` Prisma models & migrations
- [ ] Integrate MinIO S3-compatible object storage client (`@aws-sdk/client-s3`)
- [ ] Implement document upload (`POST /api/v1/documents`), listing, status, deletion, and reprocessing endpoints
- [ ] Scaffold `apps/worker` with BullMQ consumer, PDF text extraction, page-aware chunking, retries, and idempotency

## Known Problems / Environment Gaps

- None blocking Sprint 2. Integration tests connecting to `localhost:5432` require Docker PostgreSQL running and network access (outside the restricted sandbox on Windows).

## Current Architecture

- `apps/api`: Fastify v5 REST API with `/health`, `/ready`, `/api/v1/auth/*`, and `/api/v1/organizations/*`.
- `packages/database`: Prisma 7 schema, migrations, `createDatabaseClient`, and `checkDatabaseHealth`.
- `packages/shared`: Shared constants and health/readiness types.

## Next Recommended Action

1. Review and commit Sprint 2 changes to Git when ready.
2. Begin **Sprint 3 — Document Processing**: add `Document`, `DocumentChunk`, and `ProcessingJob` database models, MinIO storage integration, document endpoints, and the `apps/worker` BullMQ ingestion pipeline.
