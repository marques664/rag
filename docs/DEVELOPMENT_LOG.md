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
