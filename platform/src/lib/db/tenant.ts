import type { Prisma } from "@prisma/client";
import { prisma } from "./client";
import { TenantAccessError } from "@/lib/errors";

/**
 * Tenant-scoped Prisma client — isolation layer 2 of 3 (see
 * docs/multi-tenancy.md).
 *
 * Layer 1 is the organization context: services only run with an
 * `OrgContext` produced by `requireOrganization()`. This layer makes a
 * forgotten `where: { organizationId }` harmless: every operation on a
 * tenant-owned model gets the organization filter injected, and every write
 * that names a *different* organization throws. Layer 3 is the database
 * itself (composite foreign keys), so even a raw query cannot link rows across
 * tenants.
 *
 * Rules for code using the scoped client:
 *   * Use scalar ("unchecked") inputs for tenant models — `organizationId` and
 *     `xxxId` columns — not `organization: { connect }`. The guard rejects the
 *     `organization` relation key outright.
 *   * `$queryRaw` is NOT intercepted. Raw SQL against tenant tables must take
 *     the organization id as an explicit parameter and be reviewed as such.
 */

export const TENANT_MODELS = new Set<Prisma.ModelName>([
  "OrganizationMembership",
  "Invitation",
  "Team",
  "TeamMembership",
  "AuditLog",
  "TicketSequence",
  "Workflow",
  "WorkflowStatus",
  "WorkflowTransition",
  "TicketPriority",
  "TicketCategory",
  "Ticket",
  "Comment",
  "TicketWatcher",
  "TicketRelation",
  "Attachment",
  "CommentMention",
  "CustomFieldDefinition",
  "TimeEntry",
]);

const WHERE_OPERATIONS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
  "upsert",
]);

const CREATE_OPERATIONS = new Set(["create", "createMany", "createManyAndReturn"]);

type AnyRecord = Record<string, unknown>;

function isRecord(v: unknown): v is AnyRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function crossTenant(model: string, operation: string): TenantAccessError {
  // Internal detail goes to logs via `details`; the public message is generic.
  return new TenantAccessError("Not found.", { model, operation, reason: "cross-tenant write rejected" });
}

function scopeWhere(where: unknown, organizationId: string, model: string, operation: string): AnyRecord {
  const w: AnyRecord = isRecord(where) ? { ...where } : {};
  if ("organizationId" in w && w.organizationId !== organizationId) {
    // A caller explicitly asked for another tenant's rows. That is a bug or
    // an attack; never silently "fix" it.
    throw crossTenant(model, operation);
  }
  w.organizationId = organizationId;
  return w;
}

function scopeCreateData(data: unknown, organizationId: string, model: string, operation: string): AnyRecord {
  if (!isRecord(data)) throw crossTenant(model, operation);
  if ("organization" in data) throw crossTenant(model, operation);
  if ("organizationId" in data && data.organizationId !== organizationId) throw crossTenant(model, operation);
  return { ...data, organizationId };
}

function guardUpdateData(data: unknown, organizationId: string, model: string, operation: string): void {
  if (!isRecord(data)) return;
  if ("organization" in data) throw crossTenant(model, operation);
  if ("organizationId" in data && data.organizationId !== organizationId) throw crossTenant(model, operation);
}

/** Pure transform, exported for unit tests. */
export function scopeArgs(model: string, operation: string, args: unknown, organizationId: string): AnyRecord {
  const a: AnyRecord = isRecord(args) ? { ...args } : {};

  if (CREATE_OPERATIONS.has(operation)) {
    if (Array.isArray(a.data)) {
      a.data = a.data.map((d) => scopeCreateData(d, organizationId, model, operation));
    } else {
      a.data = scopeCreateData(a.data, organizationId, model, operation);
    }
    return a;
  }

  if (WHERE_OPERATIONS.has(operation)) {
    a.where = scopeWhere(a.where, organizationId, model, operation);
    if (operation === "upsert") {
      a.create = scopeCreateData(a.create, organizationId, model, operation);
      guardUpdateData(a.update, organizationId, model, operation);
    } else if (operation.startsWith("update")) {
      guardUpdateData(a.data, organizationId, model, operation);
    }
    return a;
  }

  // Unknown operation on a tenant model: refuse rather than pass through.
  throw crossTenant(model, operation);
}

export function scopedDb(organizationId: string) {
  if (!organizationId) {
    // Fail closed: no context, no data.
    throw new TenantAccessError("Not found.", { reason: "scopedDb called without organizationId" });
  }
  return prisma.$extends({
    name: "tenant-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.has(model as Prisma.ModelName)) return query(args);
          return query(scopeArgs(model, operation, args, organizationId) as typeof args);
        },
      },
    },
  });
}

export type ScopedDb = ReturnType<typeof scopedDb>;
/** The transaction client handed to `scopedDb(...).$transaction(async (tx) => …)`. */
export type ScopedTx = Parameters<Parameters<ScopedDb["$transaction"]>[0]>[0];
