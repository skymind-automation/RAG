import type { Prisma, StatusCategory } from "@prisma/client";
import { scopedDb, type ScopedTx } from "@/lib/db/tenant";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { roleHas } from "@/lib/permissions";
import { parseInput } from "@/lib/validation/parse";
import {
  addCommentSchema,
  assignTicketSchema,
  createTicketSchema,
  listTicketsSchema,
  transitionTicketSchema,
} from "@/lib/validation/schemas";
import { recordAudit } from "@/server/audit/audit-service";
import { can, requireAnyPermission, requirePermission } from "@/server/auth/resolve";
import type { OrgContext } from "@/server/context";
import { allocateTicketNumber, formatTicketKey } from "./ticket-numbering";

/**
 * TicketService — the initial ticket domain (Phase 1 model, Phase 2 grows
 * the UI around it).
 *
 * Access model:
 *   tickets.read      → every ticket in the organization
 *   tickets.read_own  → only tickets where the caller is the requester
 * A ticket the caller may not read is reported as NotFound, never Forbidden,
 * so ticket existence is not disclosed.
 *
 * Internal notes: selected only when the caller holds tickets.read_internal.
 * The filter is in the query, not in the UI.
 */

const ticketListSelect = {
  id: true,
  key: true,
  type: true,
  title: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  dueAt: true,
  status: { select: { id: true, name: true, category: true } },
  priority: { select: { key: true, name: true, level: true, color: true } },
  requester: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true } },
  team: { select: { id: true, name: true } },
} satisfies Prisma.TicketSelect;

export type TicketListItem = Prisma.TicketGetPayload<{ select: typeof ticketListSelect }>;

/** Row-level read filter derived from permissions. */
function readScope(ctx: OrgContext): Prisma.TicketWhereInput {
  if (can(ctx, "tickets.read")) return { deletedAt: null };
  if (can(ctx, "tickets.read_own")) return { deletedAt: null, requesterId: ctx.user.id };
  throw new AuthorizationError();
}

/** An assignee must be an active member whose role can work tickets. */
async function assertAssignable(tx: ScopedTx, userId: string): Promise<void> {
  const m = await tx.organizationMembership.findFirst({
    where: { userId, status: "ACTIVE" },
    select: { role: true },
  });
  if (!m || !roleHas(m.role, "tickets.update")) {
    throw new ValidationError("Some fields are invalid.", { assigneeId: ["This person can't be assigned tickets."] });
  }
}

export async function createTicket(ctx: OrgContext, raw: unknown) {
  requirePermission(ctx, "tickets.create");
  const input = parseInput(createTicketSchema, raw);
  const isAgent = can(ctx, "tickets.update");
  const organizationId = ctx.organization.id;

  // Requesters file for themselves, through the portal, without routing fields.
  if (!isAgent && (input.assigneeId || input.teamId || (input.requesterId && input.requesterId !== ctx.user.id))) {
    throw new AuthorizationError("You can't set assignment fields on a request.");
  }
  const requesterId = isAgent ? (input.requesterId ?? ctx.user.id) : ctx.user.id;
  const source = isAgent ? input.source : "PORTAL";

  const db = scopedDb(organizationId);
  return db.$transaction(async (tx) => {
    const initial = await tx.workflowStatus.findFirst({
      where: { isInitial: true, workflow: { isDefault: true } },
      select: { id: true },
    });
    if (!initial) throw new ValidationError("This organization has no default workflow configured.");

    const priority = await tx.ticketPriority.findFirst({
      where: input.priorityKey ? { key: input.priorityKey } : { isDefault: true },
      select: { id: true },
    });
    if (!priority) throw new ValidationError("Some fields are invalid.", { priorityKey: ["Unknown priority."] });

    // Every referenced id is looked up through the scoped client: another
    // tenant's id resolves to nothing. The composite FKs are the backstop.
    if (input.categoryId) {
      const c = await tx.ticketCategory.findFirst({
        where: { id: input.categoryId, deletedAt: null },
        select: { id: true },
      });
      if (!c) throw new ValidationError("Some fields are invalid.", { categoryId: ["Unknown category."] });
    }
    if (input.teamId) {
      const t = await tx.team.findFirst({ where: { id: input.teamId, deletedAt: null }, select: { id: true } });
      if (!t) throw new ValidationError("Some fields are invalid.", { teamId: ["Unknown team."] });
    }
    if (requesterId !== ctx.user.id) {
      const r = await tx.organizationMembership.findFirst({
        where: { userId: requesterId, status: "ACTIVE" },
        select: { id: true },
      });
      if (!r) throw new ValidationError("Some fields are invalid.", { requesterId: ["Unknown requester."] });
    }
    if (input.assigneeId) await assertAssignable(tx, input.assigneeId);

    const prefix = ctx.organization.ticketPrefix;
    const number = await allocateTicketNumber(tx, organizationId, prefix);
    const key = formatTicketKey(prefix, number, ctx.organization.ticketNumberPadding);

    const ticket = await tx.ticket.create({
      data: {
        organizationId,
        number,
        key,
        type: input.type,
        title: input.title,
        description: input.description,
        statusId: initial.id,
        priorityId: priority.id,
        categoryId: input.categoryId ?? null,
        teamId: input.teamId ?? null,
        requesterId,
        assigneeId: input.assigneeId ?? null,
        createdById: ctx.user.id,
        source,
        dueAt: input.dueAt ?? null,
      },
      select: ticketListSelect,
    });

    const watcherIds = [...new Set([requesterId, input.assigneeId].filter((x): x is string => Boolean(x)))];
    await tx.ticketWatcher.createMany({
      data: watcherIds.map((userId) => ({ organizationId, ticketId: ticket.id, userId })),
      skipDuplicates: true,
    });

    await recordAudit(tx, ctx, {
      action: "ticket.created",
      entityType: "ticket",
      entityId: ticket.id,
      metadata: { key, type: input.type, source, assigneeId: input.assigneeId ?? null },
    });
    return ticket;
  });
}

export async function listTickets(ctx: OrgContext, raw: unknown = {}) {
  requireAnyPermission(ctx, ["tickets.read", "tickets.read_own"]);
  const input = parseInput(listTicketsSchema, raw);
  const where: Prisma.TicketWhereInput = {
    AND: [
      readScope(ctx),
      input.statusCategory ? { status: { category: input.statusCategory } } : {},
      input.assigneeId ? { assigneeId: input.assigneeId } : {},
      input.type ? { type: input.type } : {},
    ],
  };
  const rows = await scopedDb(ctx.organization.id).ticket.findMany({
    where,
    select: ticketListSelect,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > input.limit;
  const items = hasMore ? rows.slice(0, input.limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
}

export async function getTicket(ctx: OrgContext, ticketIdOrKey: string) {
  requireAnyPermission(ctx, ["tickets.read", "tickets.read_own"]);
  const ticket = await scopedDb(ctx.organization.id).ticket.findFirst({
    where: { AND: [readScope(ctx), { OR: [{ id: ticketIdOrKey }, { key: ticketIdOrKey.toUpperCase() }] }] },
    select: {
      ...ticketListSelect,
      description: true,
      resolution: true,
      source: true,
      customFields: true,
      resolvedAt: true,
      closedAt: true,
      firstRespondedAt: true,
      category: { select: { id: true, name: true } },
    },
  });
  if (!ticket) throw new NotFoundError("Ticket not found.");
  return ticket;
}

/** Statuses reachable from the ticket's current status under its workflow. */
export async function availableTransitions(ctx: OrgContext, ticketId: string) {
  requirePermission(ctx, "tickets.transition");
  const db = scopedDb(ctx.organization.id);
  const ticket = await db.ticket.findFirst({ where: { id: ticketId, deletedAt: null }, select: { statusId: true } });
  if (!ticket) throw new NotFoundError("Ticket not found.");
  return db.workflowTransition.findMany({
    where: { fromStatusId: ticket.statusId },
    select: { requiresResolution: true, toStatus: { select: { id: true, name: true, category: true } } },
    orderBy: { toStatus: { position: "asc" } },
  });
}

function lifecycleTimestamps(category: StatusCategory, now: Date) {
  return {
    resolvedAt: category === "RESOLVED" || category === "CLOSED" ? now : null,
    closedAt: category === "CLOSED" ? now : null,
  };
}

/**
 * The only way a ticket changes status. Validates the transition against
 * the organization's workflow, required fields, and optimistic concurrency.
 * (SLA effects hook in here in Phase 4.)
 */
export async function transitionTicket(ctx: OrgContext, raw: unknown) {
  requirePermission(ctx, "tickets.transition");
  const input = parseInput(transitionTicketSchema, raw);
  const db = scopedDb(ctx.organization.id);

  return db.$transaction(async (tx) => {
    const ticket = await tx.ticket.findFirst({
      where: { id: input.ticketId, deletedAt: null },
      select: {
        id: true,
        key: true,
        version: true,
        resolution: true,
        resolvedAt: true,
        status: { select: { id: true, workflowId: true, name: true } },
      },
    });
    if (!ticket) throw new NotFoundError("Ticket not found.");

    const transition = await tx.workflowTransition.findFirst({
      where: { workflowId: ticket.status.workflowId, fromStatusId: ticket.status.id, toStatusId: input.toStatusId },
      select: { requiresResolution: true, toStatus: { select: { id: true, name: true, category: true } } },
    });
    if (!transition) {
      throw new ValidationError("That status change isn't allowed by this workflow.", {
        toStatusId: ["Invalid transition."],
      });
    }

    const resolution = input.resolution ?? ticket.resolution;
    if (transition.requiresResolution && !resolution?.trim()) {
      throw new ValidationError("Add a resolution before resolving.", { resolution: ["A resolution is required."] });
    }

    const now = new Date();
    const stamps = lifecycleTimestamps(transition.toStatus.category, now);
    const { count } = await tx.ticket.updateMany({
      where: { id: ticket.id, version: input.expectedVersion },
      data: {
        statusId: transition.toStatus.id,
        resolution: resolution ?? null,
        // Keep the original resolution time when closing a resolved ticket.
        resolvedAt: stamps.resolvedAt ? (ticket.resolvedAt ?? stamps.resolvedAt) : null,
        closedAt: stamps.closedAt,
        version: { increment: 1 },
      },
    });
    if (count === 0) throw new ConflictError();

    await recordAudit(tx, ctx, {
      action: "ticket.status_changed",
      entityType: "ticket",
      entityId: ticket.id,
      metadata: { key: ticket.key, from: ticket.status.name, to: transition.toStatus.name },
    });
    return { id: ticket.id, version: input.expectedVersion + 1, status: transition.toStatus };
  });
}

export async function assignTicket(ctx: OrgContext, raw: unknown) {
  requirePermission(ctx, "tickets.assign");
  const input = parseInput(assignTicketSchema, raw);
  const db = scopedDb(ctx.organization.id);
  return db.$transaction(async (tx) => {
    const ticket = await tx.ticket.findFirst({
      where: { id: input.ticketId, deletedAt: null },
      select: { id: true, key: true, assigneeId: true },
    });
    if (!ticket) throw new NotFoundError("Ticket not found.");
    if (input.assigneeId) await assertAssignable(tx, input.assigneeId);

    const { count } = await tx.ticket.updateMany({
      where: { id: ticket.id, version: input.expectedVersion },
      data: { assigneeId: input.assigneeId, version: { increment: 1 } },
    });
    if (count === 0) throw new ConflictError();
    if (input.assigneeId) {
      await tx.ticketWatcher.createMany({
        data: [{ organizationId: ctx.organization.id, ticketId: ticket.id, userId: input.assigneeId }],
        skipDuplicates: true,
      });
    }
    await recordAudit(tx, ctx, {
      action: "ticket.assigned",
      entityType: "ticket",
      entityId: ticket.id,
      metadata: { key: ticket.key, from: ticket.assigneeId, to: input.assigneeId },
    });
    return { id: ticket.id, version: input.expectedVersion + 1 };
  });
}

export async function addComment(ctx: OrgContext, raw: unknown) {
  requirePermission(ctx, "tickets.comment");
  const input = parseInput(addCommentSchema, raw);
  if (input.visibility === "INTERNAL") requirePermission(ctx, "tickets.comment_internal");
  const db = scopedDb(ctx.organization.id);

  return db.$transaction(async (tx) => {
    const ticket = await tx.ticket.findFirst({
      where: { AND: [readScope(ctx), { id: input.ticketId }] },
      select: { id: true, key: true, requesterId: true, firstRespondedAt: true },
    });
    if (!ticket) throw new NotFoundError("Ticket not found.");

    const comment = await tx.comment.create({
      data: {
        organizationId: ctx.organization.id,
        ticketId: ticket.id,
        authorId: ctx.user.id,
        body: input.body,
        visibility: input.visibility,
      },
      select: { id: true, visibility: true, createdAt: true },
    });
    // First public reply by someone other than the requester = first response (SLA input).
    if (!ticket.firstRespondedAt && input.visibility === "PUBLIC" && ctx.user.id !== ticket.requesterId) {
      await tx.ticket.updateMany({ where: { id: ticket.id }, data: { firstRespondedAt: comment.createdAt } });
    }
    await recordAudit(tx, ctx, {
      action: "ticket.comment_added",
      entityType: "ticket",
      entityId: ticket.id,
      // Never the body: comments can hold sensitive content.
      metadata: { key: ticket.key, commentId: comment.id, visibility: comment.visibility },
    });
    return comment;
  });
}

export async function listComments(ctx: OrgContext, ticketId: string) {
  requireAnyPermission(ctx, ["tickets.read", "tickets.read_own"]);
  const db = scopedDb(ctx.organization.id);
  const ticket = await db.ticket.findFirst({
    where: { AND: [readScope(ctx), { id: ticketId }] },
    select: { id: true },
  });
  if (!ticket) throw new NotFoundError("Ticket not found.");
  return db.comment.findMany({
    where: {
      ticketId: ticket.id,
      deletedAt: null,
      ...(can(ctx, "tickets.read_internal") ? {} : { visibility: "PUBLIC" as const }),
    },
    select: {
      id: true,
      body: true,
      visibility: true,
      createdAt: true,
      editedAt: true,
      author: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}
