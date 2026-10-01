import type { ActorType, Prisma } from "@prisma/client";
import { redact } from "@/lib/observability/logger";
import type { OrgContext, RequestMeta } from "@/server/context";

/**
 * AuditService — append-only record of security-sensitive and
 * business-critical actions.
 *
 * Write audit rows through the *same transaction* as the change they
 * describe (`recordAudit(tx, …)`), so there is never a change without its
 * record or a record of a change that rolled back. The table itself rejects
 * UPDATE and DELETE (trigger in migration `tenant_integrity`).
 */

export const AUDIT_ACTIONS = [
  "user.registered",
  "user.login_succeeded",
  "user.login_failed",
  "organization.created",
  "organization.updated",
  "organization.switched",
  "membership.invited",
  "membership.invitation_revoked",
  "membership.invitation_accepted",
  "membership.role_changed",
  "membership.removed",
  "membership.left",
  "team.created",
  "team.updated",
  "team.member_added",
  "team.member_removed",
  "ticket.created",
  "ticket.updated",
  "ticket.deleted",
  "ticket.status_changed",
  "ticket.assigned",
  "ticket.priority_changed",
  "ticket.comment_added",
  "ticket.watcher_added",
  "ticket.watcher_removed",
  "ticket.relation_added",
  "ticket.relation_removed",
  "attachment.upload_requested",
  "attachment.uploaded",
  "attachment.quarantined",
  "attachment.downloaded",
  "attachment.deleted",
  "ticket_config.updated",
  "workflow.updated",
  "authorization.denied",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditEntry {
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

/** The minimal client surface needed, satisfied by prisma, a tx, or a scoped tx. */
export interface AuditWriter {
  auditLog: {
    create(args: { data: Prisma.AuditLogUncheckedCreateInput }): Promise<unknown>;
  };
}

const MAX_STRING = 1000;
const MAX_METADATA_BYTES = 8_000;

function truncateStrings(v: unknown): unknown {
  if (typeof v === "string") return v.length > MAX_STRING ? `${v.slice(0, MAX_STRING)}…` : v;
  if (Array.isArray(v)) return v.map(truncateStrings);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, truncateStrings(x)]));
  }
  return v;
}

/**
 * Secrets never enter the audit log: keys that look sensitive are redacted,
 * long strings truncated, and oversized payloads replaced by a marker.
 */
export function sanitizeAuditMetadata(metadata: Record<string, unknown> | undefined): Prisma.InputJsonObject {
  if (!metadata) return {};
  const cleaned = truncateStrings(redact(metadata)) as Prisma.InputJsonObject;
  if (JSON.stringify(cleaned).length > MAX_METADATA_BYTES) {
    return { truncated: true, keys: Object.keys(metadata).slice(0, 50) };
  }
  return cleaned;
}

function requestFields(request: RequestMeta | undefined) {
  return {
    ipAddress: request?.ipAddress ?? null,
    userAgent: request?.userAgent?.slice(0, 512) ?? null,
    requestId: request?.requestId ?? null,
  };
}

/** Audit an action taken inside an organization. */
export async function recordAudit(db: AuditWriter, ctx: OrgContext, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      organizationId: ctx.organization.id,
      actorId: ctx.user.id,
      actorType: "USER",
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      metadata: sanitizeAuditMetadata(entry.metadata),
      ...requestFields(ctx.request),
    },
  });
}

/** Audit an action outside any organization (registration, login) or by the system. */
export async function recordGlobalAudit(
  db: AuditWriter,
  params: {
    actorId: string | null;
    actorType?: ActorType;
    organizationId?: string | null;
    request?: RequestMeta;
  } & AuditEntry,
): Promise<void> {
  await db.auditLog.create({
    data: {
      organizationId: params.organizationId ?? null,
      actorId: params.actorId,
      actorType: params.actorType ?? (params.actorId ? "USER" : "SYSTEM"),
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId ?? null,
      metadata: sanitizeAuditMetadata(params.metadata),
      ...requestFields(params.request),
    },
  });
}
