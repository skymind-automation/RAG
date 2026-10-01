import { scopedDb, type ScopedTx } from "@/lib/db/tenant";
import { isUniqueViolation } from "@/lib/db/errors";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { roleHas } from "@/lib/permissions";
import { parseInput } from "@/lib/validation/parse";
import {
  addStatusSchema,
  archiveCategorySchema,
  archiveCustomFieldSchema,
  createCategorySchema,
  createCustomFieldSchema,
  renameStatusSchema,
  setDefaultPrioritySchema,
  setTransitionSchema,
  updateCategorySchema,
  updatePrioritySchema,
} from "@/lib/validation/schemas";
import { recordAudit } from "@/server/audit/audit-service";
import { can, requireAnyPermission, requirePermission } from "@/server/auth/resolve";
import type { OrgContext } from "@/server/context";

/**
 * Ticket configuration: the per-organization vocabulary tickets are built
 * from (priorities, categories, custom fields, workflow). Reads are open to
 * anyone who files or works tickets (forms need them); writes need
 * tickets.configure, or workflows.manage for statuses and transitions.
 *
 * Nothing here deletes rows tickets reference: categories and custom fields
 * are archived, statuses can be renamed and re-wired but not removed.
 */

/** Everything a create/edit form needs, trimmed to what the caller may use. */
export async function getTicketFormOptions(ctx: OrgContext) {
  requireAnyPermission(ctx, ["tickets.create", "tickets.read", "tickets.read_own"]);
  const db = scopedDb(ctx.organization.id);
  const staff = can(ctx, "tickets.update");
  const [priorities, categories, customFields, teams, members] = await Promise.all([
    db.ticketPriority.findMany({
      select: { id: true, key: true, name: true, level: true, color: true, isDefault: true },
      orderBy: { level: "asc" },
    }),
    db.ticketCategory.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.customFieldDefinition.findMany({
      where: { archivedAt: null },
      select: { id: true, key: true, label: true, type: true, options: true, required: true, ticketTypes: true },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    }),
    staff
      ? db.team.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
    // The member directory is staff-only: requesters never enumerate the org.
    staff
      ? db.organizationMembership.findMany({
          where: { status: "ACTIVE" },
          select: { role: true, user: { select: { id: true, name: true, email: true } } },
          orderBy: { user: { name: "asc" } },
        })
      : Promise.resolve([]),
  ]);
  return {
    priorities,
    categories,
    customFields: customFields.map((f) => ({
      ...f,
      options: Array.isArray(f.options) ? f.options.filter((o): o is string => typeof o === "string") : [],
    })),
    teams,
    members: members.map((m) => ({
      ...m.user,
      role: m.role,
      assignable: roleHas(m.role, "tickets.update"),
      canReadAll: roleHas(m.role, "tickets.read"),
      canReadInternal: roleHas(m.role, "tickets.read_internal"),
    })),
  };
}

export type TicketFormOptions = Awaited<ReturnType<typeof getTicketFormOptions>>;

/** Full admin view of the configuration. */
export async function getTicketConfiguration(ctx: OrgContext) {
  requireAnyPermission(ctx, ["tickets.configure", "workflows.manage"]);
  const db = scopedDb(ctx.organization.id);
  const workflow = await db.workflow.findFirst({
    where: { isDefault: true },
    select: {
      id: true,
      name: true,
      statuses: {
        select: { id: true, key: true, name: true, category: true, position: true, isInitial: true },
        orderBy: { position: "asc" },
      },
      transitions: { select: { id: true, fromStatusId: true, toStatusId: true, requiresResolution: true } },
    },
  });
  const [priorities, categories, customFields] = await Promise.all([
    db.ticketPriority.findMany({ orderBy: { level: "asc" } }),
    db.ticketCategory.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, description: true, _count: { select: { tickets: true } } },
      orderBy: { name: "asc" },
    }),
    db.customFieldDefinition.findMany({
      where: { archivedAt: null },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    }),
  ]);
  return { workflow, priorities, categories, customFields };
}

// ── categories ───────────────────────────────────────────────────────────

export async function createCategory(ctx: OrgContext, raw: unknown) {
  requirePermission(ctx, "tickets.configure");
  const input = parseInput(createCategorySchema, raw);
  const db = scopedDb(ctx.organization.id);
  try {
    return await db.$transaction(async (tx) => {
      const c = await tx.ticketCategory.create({
        data: { organizationId: ctx.organization.id, name: input.name, description: input.description ?? null },
        select: { id: true, name: true },
      });
      await recordAudit(tx, ctx, {
        action: "ticket_config.updated",
        entityType: "ticket_category",
        entityId: c.id,
        metadata: { op: "create", name: c.name },
      });
      return c;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ValidationError("Some fields are invalid.", { name: ["A category with this name already exists."] });
    }
    throw err;
  }
}

export async function renameCategory(ctx: OrgContext, raw: unknown) {
  requirePermission(ctx, "tickets.configure");
  const input = parseInput(updateCategorySchema, raw);
  const db = scopedDb(ctx.organization.id);
  try {
    await db.$transaction(async (tx) => {
      const { count } = await tx.ticketCategory.updateMany({
        where: { id: input.categoryId, deletedAt: null },
        data: { name: input.name },
      });
      if (count === 0) throw new NotFoundError("Category not found.");
      await recordAudit(tx, ctx, {
        action: "ticket_config.updated",
        entityType: "ticket_category",
        entityId: input.categoryId,
        metadata: { op: "rename", name: input.name },
      });
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ValidationError("Some fields are invalid.", { name: ["A category with this name already exists."] });
    }
    throw err;
  }
}

/** Archived categories disappear from forms; existing tickets keep them. */
export async function archiveCategory(ctx: OrgContext, raw: unknown) {
  requirePermission(ctx, "tickets.configure");
  const input = parseInput(archiveCategorySchema, raw);
  const db = scopedDb(ctx.organization.id);
  await db.$transaction(async (tx) => {
    const cat = await tx.ticketCategory.findFirst({
      where: { id: input.categoryId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!cat) throw new NotFoundError("Category not found.");
    // Free the name for reuse while keeping the row for historical tickets.
    await tx.ticketCategory.updateMany({
      where: { id: cat.id },
      data: { deletedAt: new Date(), name: `${cat.name} (archived ${cat.id.slice(-6)})` },
    });
    await recordAudit(tx, ctx, {
      action: "ticket_config.updated",
      entityType: "ticket_category",
      entityId: cat.id,
      metadata: { op: "archive", name: cat.name },
    });
  });
}

// ── priorities ───────────────────────────────────────────────────────────

export async function updatePriority(ctx: OrgContext, raw: unknown) {
  requirePermission(ctx, "tickets.configure");
  const input = parseInput(updatePrioritySchema, raw);
  const db = scopedDb(ctx.organization.id);
  await db.$transaction(async (tx) => {
    const { count } = await tx.ticketPriority.updateMany({
      where: { id: input.priorityId },
      data: { name: input.name, color: input.color.toLowerCase() },
    });
    if (count === 0) throw new NotFoundError("Priority not found.");
    await recordAudit(tx, ctx, {
      action: "ticket_config.updated",
      entityType: "ticket_priority",
      entityId: input.priorityId,
      metadata: { op: "update", name: input.name, color: input.color },
    });
  });
}

export async function setDefaultPriority(ctx: OrgContext, raw: unknown) {
  requirePermission(ctx, "tickets.configure");
  const input = parseInput(setDefaultPrioritySchema, raw);
  const db = scopedDb(ctx.organization.id);
  await db.$transaction(async (tx) => {
    const p = await tx.ticketPriority.findFirst({ where: { id: input.priorityId }, select: { id: true, name: true } });
    if (!p) throw new NotFoundError("Priority not found.");
    // Order matters: the partial unique index allows at most one default.
    await tx.ticketPriority.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    await tx.ticketPriority.updateMany({ where: { id: p.id }, data: { isDefault: true } });
    await recordAudit(tx, ctx, {
      action: "ticket_config.updated",
      entityType: "ticket_priority",
      entityId: p.id,
      metadata: { op: "set_default", name: p.name },
    });
  });
}

// ── workflow ─────────────────────────────────────────────────────────────

async function defaultWorkflowId(tx: ScopedTx) {
  const wf = await tx.workflow.findFirst({ where: { isDefault: true }, select: { id: true } });
  if (!wf) throw new ValidationError("This organization has no default workflow configured.");
  return wf.id;
}

function statusKey(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "status"
  );
}

export async function addWorkflowStatus(ctx: OrgContext, raw: unknown) {
  requirePermission(ctx, "workflows.manage");
  const input = parseInput(addStatusSchema, raw);
  const db = scopedDb(ctx.organization.id);
  try {
    return await db.$transaction(async (tx) => {
      const workflowId = await defaultWorkflowId(tx);
      const last = await tx.workflowStatus.findFirst({
        where: { workflowId },
        orderBy: { position: "desc" },
        select: { position: true },
      });
      const status = await tx.workflowStatus.create({
        data: {
          organizationId: ctx.organization.id,
          workflowId,
          key: statusKey(input.name),
          name: input.name,
          category: input.category,
          position: (last?.position ?? -1) + 1,
        },
        select: { id: true, name: true, category: true },
      });
      await recordAudit(tx, ctx, {
        action: "workflow.updated",
        entityType: "workflow_status",
        entityId: status.id,
        metadata: { op: "add_status", name: status.name, category: status.category },
      });
      return status;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ValidationError("Some fields are invalid.", { name: ["A status with this name already exists."] });
    }
    throw err;
  }
}

export async function renameWorkflowStatus(ctx: OrgContext, raw: unknown) {
  requirePermission(ctx, "workflows.manage");
  const input = parseInput(renameStatusSchema, raw);
  const db = scopedDb(ctx.organization.id);
  await db.$transaction(async (tx) => {
    const s = await tx.workflowStatus.findFirst({ where: { id: input.statusId }, select: { id: true, name: true } });
    if (!s) throw new NotFoundError("Status not found.");
    // The key stays stable; only the display name changes.
    await tx.workflowStatus.updateMany({ where: { id: s.id }, data: { name: input.name } });
    await recordAudit(tx, ctx, {
      action: "workflow.updated",
      entityType: "workflow_status",
      entityId: s.id,
      metadata: { op: "rename_status", from: s.name, to: input.name },
    });
  });
}

/** Enable/disable an allowed status change, or toggle its "requires resolution" rule. */
export async function setWorkflowTransition(ctx: OrgContext, raw: unknown) {
  requirePermission(ctx, "workflows.manage");
  const input = parseInput(setTransitionSchema, raw);
  if (input.fromStatusId === input.toStatusId) {
    throw new ValidationError("A status can't transition to itself.");
  }
  const db = scopedDb(ctx.organization.id);
  await db.$transaction(async (tx) => {
    const workflowId = await defaultWorkflowId(tx);
    const statuses = await tx.workflowStatus.findMany({
      where: { workflowId, id: { in: [input.fromStatusId, input.toStatusId] } },
      select: { id: true, name: true },
    });
    if (statuses.length !== 2) throw new NotFoundError("Status not found.");
    const name = (id: string) => statuses.find((s) => s.id === id)!.name;

    if (input.enabled) {
      await tx.workflowTransition.upsert({
        where: {
          workflowId_fromStatusId_toStatusId: {
            workflowId,
            fromStatusId: input.fromStatusId,
            toStatusId: input.toStatusId,
          },
        },
        create: {
          organizationId: ctx.organization.id,
          workflowId,
          fromStatusId: input.fromStatusId,
          toStatusId: input.toStatusId,
          requiresResolution: input.requiresResolution,
        },
        update: { requiresResolution: input.requiresResolution },
      });
    } else {
      await tx.workflowTransition.deleteMany({
        where: { workflowId, fromStatusId: input.fromStatusId, toStatusId: input.toStatusId },
      });
    }
    await recordAudit(tx, ctx, {
      action: "workflow.updated",
      entityType: "workflow",
      entityId: workflowId,
      metadata: {
        op: input.enabled ? "enable_transition" : "disable_transition",
        from: name(input.fromStatusId),
        to: name(input.toStatusId),
        requiresResolution: input.enabled ? input.requiresResolution : undefined,
      },
    });
  });
}

// ── custom fields ────────────────────────────────────────────────────────

function fieldKey(label: string): string {
  const k = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return (/^[a-z]/.test(k) ? k : `f_${k}`).slice(0, 40) || "field";
}

export async function createCustomField(ctx: OrgContext, raw: unknown) {
  requirePermission(ctx, "tickets.configure");
  const input = parseInput(createCustomFieldSchema, raw);
  const db = scopedDb(ctx.organization.id);
  try {
    return await db.$transaction(async (tx) => {
      const count = await tx.customFieldDefinition.count();
      if (count >= 50) throw new ValidationError("An organization can have at most 50 custom fields.");
      const field = await tx.customFieldDefinition.create({
        data: {
          organizationId: ctx.organization.id,
          key: fieldKey(input.label),
          label: input.label,
          type: input.type,
          options: input.type === "SELECT" ? input.options : [],
          required: input.required,
          ticketTypes: input.ticketTypes,
          position: count,
        },
        select: { id: true, key: true, label: true },
      });
      await recordAudit(tx, ctx, {
        action: "ticket_config.updated",
        entityType: "custom_field",
        entityId: field.id,
        metadata: { op: "create", key: field.key, type: input.type, required: input.required },
      });
      return field;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ValidationError("Some fields are invalid.", { label: ["A field with this name already exists."] });
    }
    throw err;
  }
}

/**
 * Archived fields disappear from forms and validation. Values already stored
 * on tickets remain in the JSON until that ticket's custom fields are next
 * edited, when values without an active definition are dropped.
 */
export async function archiveCustomField(ctx: OrgContext, raw: unknown) {
  requirePermission(ctx, "tickets.configure");
  const input = parseInput(archiveCustomFieldSchema, raw);
  const db = scopedDb(ctx.organization.id);
  await db.$transaction(async (tx) => {
    const f = await tx.customFieldDefinition.findFirst({
      where: { id: input.fieldId, archivedAt: null },
      select: { id: true, key: true },
    });
    if (!f) throw new NotFoundError("Field not found.");
    // Rename the key so a new field can reuse it without inheriting old values.
    await tx.customFieldDefinition.updateMany({
      where: { id: f.id },
      data: { archivedAt: new Date(), key: `${f.key.slice(0, 30)}_x${f.id.slice(-6)}`.replace(/[^a-z0-9_]/g, "") },
    });
    await recordAudit(tx, ctx, {
      action: "ticket_config.updated",
      entityType: "custom_field",
      entityId: f.id,
      metadata: { op: "archive", key: f.key },
    });
  });
}
