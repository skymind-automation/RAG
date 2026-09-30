-- Integrity rules Prisma cannot express: CHECKs, partial unique indexes,
-- and audit-log immutability.
-- See docs/multi-tenancy.md ("Layer 3: the database").

-- Composite tenant FKs (ticket → category/team/member, comment → author,
-- watcher → member) are declared in schema.prisma and live in the init
-- migration. This file holds only what Prisma cannot express.

-- ── Value constraints ─────────────────────────────────────────────────────
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_lowercase_chk" CHECK ("email" = lower("email"));

ALTER TABLE "invitations"
  ADD CONSTRAINT "invitations_email_lowercase_chk" CHECK ("email" = lower("email"));

ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_slug_format_chk"
  CHECK ("slug" ~ '^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$');

ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_ticket_prefix_chk" CHECK ("ticketPrefix" ~ '^[A-Z][A-Z0-9]{0,9}$');

ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_ticket_padding_chk" CHECK ("ticketNumberPadding" BETWEEN 3 AND 10);

ALTER TABLE "tickets" ADD CONSTRAINT "tickets_number_positive_chk" CHECK ("number" > 0);
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_version_positive_chk" CHECK ("version" > 0);
ALTER TABLE "ticket_sequences" ADD CONSTRAINT "ticket_sequences_next_positive_chk" CHECK ("nextValue" > 0);

-- At most one default workflow / priority per organization.
CREATE UNIQUE INDEX "workflows_one_default_per_org"
  ON "workflows"("organizationId") WHERE "isDefault";
CREATE UNIQUE INDEX "ticket_priorities_one_default_per_org"
  ON "ticket_priorities"("organizationId") WHERE "isDefault";
-- Exactly one initial status per workflow (at most one enforced here; the
-- workflow service guarantees at least one).
CREATE UNIQUE INDEX "workflow_statuses_one_initial"
  ON "workflow_statuses"("workflowId") WHERE "isInitial";

-- An organization always has at least the member who created it; this index
-- makes "list my organizations" an index-only lookup.
CREATE INDEX "organization_memberships_active_by_user"
  ON "organization_memberships"("userId") WHERE "status" = 'ACTIVE';

-- ── Audit log is append-only ──────────────────────────────────────────────
-- Enforced in the database so neither application bugs nor a compromised
-- service account using the app role can rewrite history. TRUNCATE is not
-- blocked (row triggers don't fire on it) — restrict it by role grants in
-- production; see docs/security.md.
CREATE OR REPLACE FUNCTION "audit_logs_immutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only (% rejected)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "audit_logs_no_update"
  BEFORE UPDATE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "audit_logs_immutable"();

CREATE TRIGGER "audit_logs_no_delete"
  BEFORE DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "audit_logs_immutable"();
