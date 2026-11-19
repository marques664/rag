-- Defense-in-depth PostgreSQL Row-Level Security (RLS) for multi-tenant isolation.
-- Superuser connections (migrations, background worker, auth bootstrap) retain bypass
-- privileges, while tenant-scoped queries running under `enterprise_ai_app` are
-- strictly isolated by `app.current_organization_id` (fail-closed when unset).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'enterprise_ai_app') THEN
    CREATE ROLE "enterprise_ai_app" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA "public" TO "enterprise_ai_app";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "public" TO "enterprise_ai_app";
ALTER DEFAULT PRIVILEGES IN SCHEMA "public"
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "enterprise_ai_app";

-- Direct organization_id tenant tables
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organization_invitations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_chunks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "usage_events" ENABLE ROW LEVEL SECURITY;

-- Indirect tenant-owned child tables
ALTER TABLE "processing_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "message_citations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "message_feedback" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation_memberships" ON "memberships";
CREATE POLICY "tenant_isolation_memberships"
  ON "memberships"
  FOR ALL
  TO "enterprise_ai_app"
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

DROP POLICY IF EXISTS "tenant_isolation_invitations" ON "organization_invitations";
CREATE POLICY "tenant_isolation_invitations"
  ON "organization_invitations"
  FOR ALL
  TO "enterprise_ai_app"
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

DROP POLICY IF EXISTS "tenant_isolation_documents" ON "documents";
CREATE POLICY "tenant_isolation_documents"
  ON "documents"
  FOR ALL
  TO "enterprise_ai_app"
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

DROP POLICY IF EXISTS "tenant_isolation_document_chunks" ON "document_chunks";
CREATE POLICY "tenant_isolation_document_chunks"
  ON "document_chunks"
  FOR ALL
  TO "enterprise_ai_app"
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

DROP POLICY IF EXISTS "tenant_isolation_conversations" ON "conversations";
CREATE POLICY "tenant_isolation_conversations"
  ON "conversations"
  FOR ALL
  TO "enterprise_ai_app"
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

DROP POLICY IF EXISTS "tenant_isolation_usage_events" ON "usage_events";
CREATE POLICY "tenant_isolation_usage_events"
  ON "usage_events"
  FOR ALL
  TO "enterprise_ai_app"
  USING ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

DROP POLICY IF EXISTS "tenant_isolation_processing_jobs" ON "processing_jobs";
CREATE POLICY "tenant_isolation_processing_jobs"
  ON "processing_jobs"
  FOR ALL
  TO "enterprise_ai_app"
  USING (
    EXISTS (
      SELECT 1
      FROM "documents" d
      WHERE d."id" = "processing_jobs"."document_id"
        AND d."organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM "documents" d
      WHERE d."id" = "processing_jobs"."document_id"
        AND d."organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
    )
  );

DROP POLICY IF EXISTS "tenant_isolation_messages" ON "messages";
CREATE POLICY "tenant_isolation_messages"
  ON "messages"
  FOR ALL
  TO "enterprise_ai_app"
  USING (
    EXISTS (
      SELECT 1
      FROM "conversations" c
      WHERE c."id" = "messages"."conversation_id"
        AND c."organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM "conversations" c
      WHERE c."id" = "messages"."conversation_id"
        AND c."organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
    )
  );

DROP POLICY IF EXISTS "tenant_isolation_message_citations" ON "message_citations";
CREATE POLICY "tenant_isolation_message_citations"
  ON "message_citations"
  FOR ALL
  TO "enterprise_ai_app"
  USING (
    EXISTS (
      SELECT 1
      FROM "messages" m
      INNER JOIN "conversations" c ON c."id" = m."conversation_id"
      WHERE m."id" = "message_citations"."message_id"
        AND c."organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM "messages" m
      INNER JOIN "conversations" c ON c."id" = m."conversation_id"
      WHERE m."id" = "message_citations"."message_id"
        AND c."organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
    )
  );

DROP POLICY IF EXISTS "tenant_isolation_message_feedback" ON "message_feedback";
CREATE POLICY "tenant_isolation_message_feedback"
  ON "message_feedback"
  FOR ALL
  TO "enterprise_ai_app"
  USING (
    EXISTS (
      SELECT 1
      FROM "messages" m
      INNER JOIN "conversations" c ON c."id" = m."conversation_id"
      WHERE m."id" = "message_feedback"."message_id"
        AND c."organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM "messages" m
      INNER JOIN "conversations" c ON c."id" = m."conversation_id"
      WHERE m."id" = "message_feedback"."message_id"
        AND c."organization_id" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
    )
  );
