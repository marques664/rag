# ENTERPRISE KNOWLEDGE AI — SPRINT 3
## Document Processing Pipeline

Act as the Lead Software Architect and Engineering Orchestrator of Enterprise Knowledge AI.

Sprints 1 and 2 have already been completed.

Your responsibility is to coordinate a specialized multi-agent engineering team to implement Sprint 3: Document Processing.

The objective is to build a reliable, asynchronous PDF ingestion pipeline using the existing project architecture.

### 1. MANDATORY INITIAL INSPECTION

Before delegating any implementation:

- Inspect the entire repository structure.
- Read AGENTS.md and all project instructions.
- Read PROJECT_STATUS.md.
- Read ARCHITECTURE.md.
- Read TECHNICAL_DECISIONS.md.
- Read DEVELOPMENT_LOG.md.
- Inspect the existing Prisma schema and migrations.
- Inspect authentication, organization membership and authorization modules.
- Inspect Docker Compose, MinIO, Redis and PostgreSQL configurations.
- Verify which components from Sprints 1 and 2 are already implemented.

Do not assume that previous sprint requirements were implemented correctly.

Do not recreate existing functionality.

### 2. TEAM ORGANIZATION

Create the following specialized workstreams:

**Agent 1 — Upload & Storage Engineer**

Responsibilities:

- Implement PDF upload endpoints using the existing Fastify architecture.
- Validate MIME type, extension, file size and actual file content.
- Integrate MinIO using an appropriate S3-compatible client.
- Generate unique storage keys.
- Register document metadata in PostgreSQL.
- Enforce organization-level authorization.
- Implement document listing, details and deletion endpoints where appropriate.

**Agent 2 — Document Processing Engineer**

Responsibilities:

- Implement the BullMQ queue integration.
- Create the independent background worker.
- Implement PDF text extraction while preserving page numbers.
- Implement an initial chunking strategy of approximately 500 tokens with 75 tokens of overlap.
- Preserve document ID, page number, chunk index and relevant metadata.
- Update document processing status.
- Implement retry handling and failure reporting.
- Ensure processing is idempotent.

**Agent 3 — Database Engineer**

Responsibilities:

- Inspect the existing Prisma schema.
- Identify any missing models, relationships, indexes or constraints.
- Review document and processing job lifecycle requirements.
- Propose the required database changes.
- Validate referential integrity and transaction boundaries.
- Review data consistency during reprocessing and deletion.

The main orchestrator must own final schema integration and migration execution.

**Agent 4 — QA & Security Engineer**

Responsibilities:

- Review the upload and processing architecture.
- Define integration test scenarios.
- Test invalid files and oversized uploads.
- Test organization-level tenant isolation.
- Test duplicate processing and retries.
- Test worker failures and recovery.
- Verify that documents cannot be accessed by unauthorized organizations.
- Review deletion consistency between MinIO and PostgreSQL.

Initially operate in read-only review mode. Coordinate with implementation agents before proposing changes.

### 3. ARCHITECTURAL REQUIREMENTS

Preserve the existing architectural decisions:

- Node.js 24 and TypeScript.
- Fastify.
- Prisma ORM.
- PostgreSQL 17 with pgvector.
- Redis 7 and BullMQ.
- MinIO for S3-compatible object storage.
- Modular monolith with an independent background worker.
- pnpm workspaces.
- Zod for input validation.
- Pino for structured logging.
- Vitest for automated tests.

Do not introduce microservices.

Do not implement embeddings, vector retrieval or LLM generation in this sprint. Those belong to Sprint 4.

### 4. DOCUMENT LIFECYCLE

Implement and validate the following lifecycle:

PENDING → PROCESSING → COMPLETED

If processing fails:

PROCESSING → FAILED

The system must support:

- Upload.
- Queue submission.
- Asynchronous processing.
- Text extraction.
- Chunk generation.
- Chunk persistence.
- Processing status tracking.
- Retry after failure.
- Manual reprocessing.
- Document deletion.

Avoid duplicate chunks when a document is reprocessed.

Ensure old chunks cannot remain accessible as valid document content after a reprocessing operation.

Consider transaction boundaries and partial failures between PostgreSQL and MinIO.

### 5. MULTI-AGENT COORDINATION

Before implementation:

1. Establish clear ownership of files and modules.
2. Define shared interfaces and contracts.
3. Identify dependencies between workstreams.
4. Separate tasks that can safely run in parallel.
5. Prefer isolated worktrees for agents making overlapping architectural changes.

Never allow two agents to independently modify the same files without coordination.

The orchestrator must review every contribution before integration.

If an agent discovers an architectural conflict, report it to the orchestrator instead of independently changing shared architecture.

### 6. AUTONOMY POLICY

Operate autonomously for routine engineering decisions.

Do not interrupt the user for minor implementation choices.

Use existing project conventions and Context7 to verify documentation when necessary.

Ask for approval only when:

- A destructive or irreversible operation is required.
- An architectural decision materially changes existing agreements.
- A new paid service is necessary.
- Credentials or sensitive information are required.
- A database operation could cause data loss.

Never commit, push, merge or deploy without explicit approval.

### 7. QUALITY REQUIREMENTS

Before declaring the sprint complete:

- Run TypeScript checks.
- Run ESLint.
- Run relevant unit tests.
- Run integration tests.
- Verify upload and worker execution.
- Verify tenant isolation.
- Verify retries and idempotency.
- Verify document deletion consistency.
- Review error handling and structured logs.

Never claim a test passed without actually executing it.

### 8. DOCUMENTATION

Update:

- PROJECT_STATUS.md
- DEVELOPMENT_LOG.md
- ARCHITECTURE.md
- TECHNICAL_DECISIONS.md

Document significant architectural decisions and any deviations from the original roadmap.

### 9. EXECUTION STRATEGY

Work in the following order:

Phase 1 — Repository inspection and task decomposition.

Phase 2 — Architecture contracts and agent ownership.

Phase 3 — Parallel implementation of independent workstreams.

Phase 4 — Integration and conflict resolution.

Phase 5 — Automated testing and security review.

Phase 6 — Documentation and sprint report.

Do not start Sprint 4.

Do not implement embeddings, RAG, vector search or LLM integrations.

### 10. FINAL REPORT

When finished, provide:

- Implemented features.
- Agent responsibilities and contributions.
- Important architectural decisions.
- Files created or modified.
- Database changes and migrations.
- Tests executed and their results.
- Known limitations.
- Remaining issues.
- Recommended next steps.

The objective is not merely to generate code. Build a reliable, maintainable and production-oriented document processing pipeline.