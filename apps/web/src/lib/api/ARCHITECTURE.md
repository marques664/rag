# `apps/web` Frontend & API Client Architecture Plan

## 1. Stack & Configuration
- **Framework**: Next.js 16 (App Router, `src/app/`), React 19, TypeScript (`strict: true`, `noUncheckedIndexedAccess: true`, `moduleResolution: "bundler"`).
- **Styling**: Tailwind CSS v4 (`@tailwindcss/postcss`, CSS-first `@import "tailwindcss"` and `@theme` in `src/app/globals.css`).
- **Port & Base URL**: Runs on `http://localhost:3000`; communicates with Fastify backend via `NEXT_PUBLIC_API_URL` defaulting to `http://localhost:3001/api/v1`.

## 2. Folder Organization (`apps/web/src/`)
- `app/`: App Router pages & route groups:
  - `(auth)/login`, `(auth)/register` — public auth pages
  - `(workspace)/dashboard` — organization overview, KPIs, quick actions
  - `(workspace)/documents` — PDF upload, status polling (`PENDING`/`PROCESSING`/`COMPLETED`/`FAILED`), chunk counts, reprocess/delete
  - `(workspace)/chat` — conversation list, RAG Q&A thread, expandable source citations, insufficient-context banner, thumbs up/down feedback
  - `(workspace)/organizations` — org switcher, create org, member roles, invitations
  - `(workspace)/analytics` — usage, latency, estimated cost, and feedback quality metrics
- `components/`: Reusable UI primitives (app shell, sidebar, org switcher, badges, empty states, citation drawer/cards).
- `features/`: Domain-scoped client components (auth, documents, chat, organizations, analytics).
- `hooks/`: Polling (`useDocumentPolling`), session/auth context (`useAuth`), active organization context (`useOrganization`).
- `lib/api/`: Typed HTTP client (`client.ts`) and API contract types (`types.ts`).

## 3. Auth, Refresh & Tenant Isolation Strategy
1. **Token Persistence**: `accessToken`, `refreshToken`, and active `organizationId` stored in browser `localStorage` under `ekai.*` keys (`readStoredSession`, `writeStoredTokens`, `writeStoredOrganizationId`).
2. **Automatic Header Injection**: Every authenticated `apiRequest` attaches `Authorization: Bearer <accessToken>` and `x-organization-id: <activeOrganizationId>` (when an org is selected).
3. **Single-Flight 401 Refresh**: On `401 Unauthorized`, `apiRequest` deduplicates concurrent refreshes via a shared `inFlightRefresh` promise calling `POST /api/v1/auth/refresh`, updates tokens, and retries the original request once (`skipRefresh: true`). If refresh fails, stored session is cleared so the UI redirects to `/login`.
4. **Multipart Uploads**: `apiClient.documents.upload(file)` passes `FormData` without setting `Content-Type` manually so the browser injects the multipart boundary alongside `Authorization` and `x-organization-id`.
5. **Phase 2 Extensions**: Once Sprint 5–7 endpoints (`POST /messages/:id/feedback`, `GET /dashboard/overview`, `GET /analytics/{usage,performance,quality}`) land on the API, their typed methods will be added directly to `apiClient`.
