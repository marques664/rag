# Architecture Overview

## Architectural Style

Enterprise Knowledge AI uses a **Modular Monolith with an independent background worker** inside a `pnpm` workspace monorepo.

## Current Workspace Layout

```text
.
├── apps/
│   └── api/
│       ├── src/
│       │   ├── config/env.ts                    # Zod-validated runtime env (DB, Redis, JWT)
│       │   ├── infrastructure/redis.ts          # ioredis client factory and PING check
│       │   ├── middleware/
│       │   │   ├── authenticate.ts              # Bearer JWT verification hook
│       │   │   └── rbac.ts                      # Role hierarchy (OWNER > ADMIN > MEMBER)
│       │   ├── modules/
│       │   │   ├── auth/                        # Register, login, refresh rotation, logout, /me
│       │   │   ├── health/                      # Liveness (/health) and readiness (/ready)
│       │   │   └── organizations/               # Tenant-isolated orgs, memberships, invitations
│       │   ├── shared/
│       │   │   ├── errors/app-error.ts          # Typed domain-to-HTTP error hierarchy
│       │   │   └── security/                    # scrypt password hashing & jose JWT/token helpers
│       │   ├── types/fastify.d.ts               # Typed FastifyRequest.auth augmentation
│       │   ├── app.ts                           # Fastify v5 app factory
│       │   └── server.ts                        # Process entrypoint and graceful shutdown
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
│       └── src/                                 # Shared constants and TypeScript interfaces
├── infrastructure/
│   └── postgres/init.sql                        # Enables pgvector extension on first DB boot
├── docker-compose.yml                           # Local PostgreSQL+pgvector, Redis, MinIO stack
└── docs/                                        # Architecture, decisions, status, and dev log
```

## Main Components

- **Authentication & Sessions (`apps/api/src/modules/auth`)**: Issues short-lived HS256 access JWTs (`jose`) and opaque 256-bit refresh tokens stored as SHA-256 hashes in PostgreSQL (`refresh_tokens`). Refresh rotation tracks token families (`familyId`) and revokes the entire session family on token reuse detection.
- **Organizations & Multi-Tenancy (`apps/api/src/modules/organizations`)**: Every organization-scoped query in `OrganizationsRepository` enforces `organizationId` directly in PostgreSQL `where` clauses (including composite `(organizationId, userId)` lookups). RBAC enforces `OWNER > ADMIN > MEMBER` permissions and prevents demoting the last organization `OWNER`.
- **Database Layer (`packages/database`)**: Uses Prisma ORM v7 with `@prisma/adapter-pg` and `pg`. Migrations are managed via `prisma migrate dev` / `deploy`.
- **Local Infrastructure (`docker-compose.yml`)**: PostgreSQL 17 (`pgvector/pgvector:pg17`), Redis 7 (`redis:7-alpine`), and MinIO (`cgr.dev/chainguard/minio:latest`).
