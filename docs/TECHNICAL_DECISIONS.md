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
