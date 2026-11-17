# Architecture Overview

## Architectural Style

Enterprise Knowledge AI uses a **Modular Monolith with an independent background worker** inside a `pnpm` workspace monorepo.

In Sprint 1, only the foundational packages required for local infrastructure, database connectivity, and the API service skeleton have been created. Additional applications (`apps/worker`, `apps/web`) and packages (`packages/ai`, `packages/observability`) will be added in their respective sprints.

## Current Workspace Layout

```text
.
├── apps/
│   └── api/
│       ├── src/
│       │   ├── config/env.ts            # Zod-validated runtime environment configuration
│       │   ├── infrastructure/redis.ts  # ioredis client factory and PING health check
│       │   ├── modules/health/          # Liveness (/health) and readiness (/ready) routes
│       │   ├── app.ts                   # Fastify v5 app factory (testable via app.inject)
│       │   └── server.ts                # Process entrypoint and graceful shutdown
│       └── tests/
├── packages/
│   ├── database/
│   │   ├── prisma/schema.prisma         # Prisma 7 schema (postgres datasource + ESM client)
│   │   ├── prisma.config.ts             # Prisma 7 CLI/migration configuration
│   │   ├── src/client.ts                # PrismaPg adapter + PrismaClient factory
│   │   ├── src/health.ts                # Connectivity + pgvector extension check
│   │   └── tests/
│   └── shared/
│       └── src/                         # Shared constants and TypeScript interfaces
├── infrastructure/
│   └── postgres/init.sql                # Enables pgvector extension on first DB boot
├── docker-compose.yml                   # Local PostgreSQL+pgvector, Redis, MinIO stack
└── docs/                                # Architecture, decisions, status, and dev log
```

## Main Components

- **Fastify API (`apps/api`)**: Uses Fastify v5 with `@fastify/type-provider-zod` for schema validation/serialization and Pino for structured logging. `buildApp()` is decoupled from network port binding so integration tests run in-memory via `fastify.inject()`.
- **Database Layer (`packages/database`)**: Uses Prisma ORM v7 with the `@prisma/adapter-pg` driver adapter and `pg`. Keeps client instantiation lazy via `createDatabaseClient(connectionString)` instead of side-effectful module-level singletons.
- **Shared Contracts (`packages/shared`)**: Holds framework-agnostic constants and TypeScript interfaces shared between workspaces.
- **Local Infrastructure (`docker-compose.yml`)**:
  - `postgres` (`pgvector/pgvector:pg17`) on port `5432`
  - `redis` (`redis:7-alpine`) on port `6379`
  - `minio` (`minio/minio:latest`) on ports `9000` (S3 API) and `9001` (Web Console), initialized with a default bucket via `minio-init`.
