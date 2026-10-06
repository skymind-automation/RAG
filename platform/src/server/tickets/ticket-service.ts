import type { Prisma, StatusCategory } from "@prisma/client";
import { scopedDb, type ScopedTx } from "@/lib/db/tenant";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { roleHas } from "@/lib/permissions";
import { endOfWallDay, parseWallDate } from "@/lib/time/zoned";
import { parseInput } from "@/lib/validation/parse";
import {
  addCommentSchema,
  assignTicketSchema,
  createTicketSchema,
  deleteTicketSchema,
  listTicketsSchema,
  transitionTicketSchema,
  updateTicketSchema,
} from "@/lib/validation/schemas";
import { recordAudit } from "@/server/audit/audit-service";
import { can, requireAnyPermission, requirePermission } from "@/server/auth/resolve";
import type { OrgContext } from "@/server/context";
import { validateCustomFields } from "./custom-fields";
import { assertAssignable, memberCanReadTicket, readScope } from "./ticket-access";
import { allocateTicketNumber, formatTicketKey } from "./ticket-numbering";

/**
 * TicketService — ticket lifecycle.
 *
 * Access model (see ticket-access.ts): tickets.read sees every ticket,
 * tickets.read_own only the caller's requests. Unreadable tickets are
 * NotFound, never Forbidden. Internal notes and internal attachments are
 * filtered in queries for anyone without tickets.read_internal.
 *
 * Every mutation runs in a transaction on the tenant-scoped client, checks
 * `version` (optimistic concurrency) where the client edits fields, and
 * writes its audit row in the same transaction.
 */

export const ticketListSelect = {
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

/** Calendar dates mean "end of that day" in the organization's zone. */
function resolveDueAt(value: string | Date | null | undefined, timeZone: string): Date | null | undefined {
  if (value === undefined || value === null || value instanceof Date) return value;
  const wall = parseWallDate(value);
  if (!wall) throw new ValidationError("Some fields are invalid.", { dueAt: ["Use a date like 2026-10-05."] });
  return endOfWallDay(wall, timeZone);
}

async function activeCustomFieldDefinitions(tx: ScopedTx) {
  return tx.customFieldDefinition.findMany({
    where: { archivedAt: null },
    select: { key: true, label: true, type: true, options: true, required: true, ticketTypes: true },
  });
}

async function findCategory(tx: ScopedTx, categoryId: string): Promise<void> {
  const c = await tx.ticketCategory.findFirst({ where: { id: categoryId, deletedAt: null }, select: { id: true } });
  if (!c) throw new ValidationError("Some fields are invalid.", { categoryId: ["Unknown category."] });
}

async function findTeam(tx: ScopedTx, teamId: string): Promise<void> {
  const t = await tx.team.findFirst({ where: { id: teamId, deletedAt: null }, select: { id: true } });
  if (!t) throw new ValidationError("Some fields are invalid.", { teamId: ["Unknown team."] });
}

async function findPriority(tx: ScopedTx, key: string | undefined) {
  const priority = await tx.ticketPriority.findFirst({
    where: key ? { key } : { isDefault: true },
    select: { id: true, key: true, name: true },
  });
  if (!priority) throw new ValidationError("Some fields are invalid.", { priorityKey: ["Unknown priority."] });
  return priority;
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

    const priority = await findPriority(tx, input.priorityKey);
    // Every referenced id is looked up through the scoped client: another
    // tenant's id resolves to nothing. The composite FKs are the backstop.
    if (input.categoryId) await findCategory(tx, input.categoryId);
    if (input.teamId) await findTeam(tx, input.teamId);
    if (requesterId !== ctx.user.id) {
      const r = await tx.organizationMembership.findFirst({
        where: { userId: requesterId, status: "ACTIVE" },
        select: { id: true },
      });
      if (!r) throw new ValidationError("Some fields are invalid.", { requesterId: ["Unknown requester."] });
    }
    if (input.assigneeId) await assertAssignable(tx, input.assigneeId);
    const customFields = validateCustomFields(
      await activeCustomFieldDefinitions(tx),
      input.type,
      {},
      input.customFields,
    );

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
        dueAt: resolveDueAt(input.dueAt, ctx.organization.timezone) ?? null,
        customFields,
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
      metadata: { key, type: input.type, source, priority: priority.name, assigneeId: input.assigneeId ?? null },
    });
    return ticket;
  });
}

export async function listTickets(ctx: OrgContext, raw: unknown = {}) {
  requireAnyPermission(ctx, ["tickets.read", "tickets.read_own"]);
  const input = parseInput(listTicketsSchema, raw);
  const assignee =
    input.assigneeId === "me" ? ctx.user.id : input.assigneeId === "unassigned" ? null : input.assigneeId;
  const q = input.q?.trim();
  const where: Prisma.TicketWhereInput = {
    AND: [
      readScope(ctx),
      input.statusCategory ? { status: { category: input.statusCategory } } : {},
      input.state === "open" ? { status: { category: { notIn: ["RESOLVED", "CLOSED"] } } } : {},
      input.state === "closed" ? { status: { category: { in: ["RESOLVED", "CLOSED"] } } } : {},
      input.assigneeId !== undefined ? { assigneeId: assignee } : {},
      input.type ? { type: input.type } : {},
      input.priorityKey ? { priority: { key: input.priorityKey } } : {},
      input.teamId ? { teamId: input.teamId } : {},
      input.categoryId ? { categoryId: input.categoryId } : {},
      q
        ? {
            OR: [{ key: { contains: q.toUpperCase() } }, { title: { contains: q, mode: "insensitive" as const } }],
          }
        : {},
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
      createdBy: { select: { id: true, name: true } },
      watchers: { select: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!ticket) throw new NotFoundError("Ticket not found.");
  return { ...ticket, watchers: ticket.watchers.map((w) => w.user) };
}

export type TicketDetail = Awaited<ReturnType<typeof getTicket>>;

/**
 * Partial field update (title, description, type, priority, category, team,
 * due date, custom fields). Status and assignment have their own operations
 * because they carry workflow and routing rules.
 */
export async function updateTicket(ctx: OrgContext, raw: unknown) {
  requirePermission(ctx, "tickets.update");
  const input = parseInput(updateTicketSchema, raw);
  const db = scopedDb(ctx.organization.id);

  return db.$transaction(async (tx) => {
    const ticket = await tx.ticket.findFirst({
      where: { id: input.ticketId, deletedAt: null },
      select: {
        id: true,
        key: true,
        type: true,
        title: true,
        description: true,
        categoryId: true,
        teamId: true,
        dueAt: true,
        customFields: true,
        priority: { select: { id: true, key: true, name: true } },
      },
    });
    if (!ticket) throw new NotFoundError("Ticket not found.");

    const data: Prisma.TicketUncheckedUpdateManyInput = {};
    const changed: string[] = [];
    if (input.title !== undefined && input.title !== ticket.title) {
      data.title = input.title;
      changed.push("title");
    }
    if (input.description !== undefined && input.description !== ticket.description) {
      data.description = input.description;
      changed.push("description");
    }
    const nextType = input.type ?? ticket.type;
    if (nextType !== ticket.type) {
      data.type = nextType;
      changed.push("type");
    }
    let priorityChange: { from: string; to: string } | null = null;
    if (input.priorityKey !== undefined && input.priorityKey !== ticket.priority.key) {
      const p = await findPriority(tx, input.priorityKey);
      data.priorityId = p.id;
      priorityChange = { from: ticket.priority.name, to: p.name };
    }
    if (input.categoryId !== undefined && input.categoryId !== ticket.categoryId) {
      if (input.categoryId) await findCategory(tx, input.categoryId);
      data.categoryId = input.categoryId;
      changed.push("category");
    }
    if (input.teamId !== undefined && input.teamId !== ticket.teamId) {
      if (input.teamId) await findTeam(tx, input.teamId);
      data.teamId = input.teamId;
      changed.push("team");
    }
    const dueAt = resolveDueAt(input.dueAt, ctx.organization.timezone);
    if (dueAt !== undefined && dueAt?.getTime() !== ticket.dueAt?.getTime()) {
      data.dueAt = dueAt;
      changed.push("due date");
    }
    // Re-validate custom fields when they change *or* the type changes
    // (required/applicable fields differ per type).
    if (input.customFields !== undefined || data.type) {
      const existing = (ticket.customFields ?? {}) as Record<string, unknown>;
      const next = validateCustomFields(
        await activeCustomFieldDefinitions(tx),
        nextType,
        existing,
        input.customFields ?? {},
      );
      if (JSON.stringify(next) !== JSON.stringify(existing)) {
        data.customFields = next;
        changed.push("custom fields");
      }
    }

    if (changed.length === 0 && !priorityChange) return { id: ticket.id, version: input.expectedVersion };

    const { count } = await tx.ticket.updateMany({
      where: { id: ticket.id, version: input.expectedVersion },
      data: { ...data, version: { increment: 1 } },
    });
    if (count === 0) throw new ConflictError();

    if (priorityChange) {
      await recordAudit(tx, ctx, {
        action: "ticket.priority_changed",
        entityType: "ticket",
        entityId: ticket.id,
        metadata: { key: ticket.key, ...priorityChange },
      });
    }
    if (changed.length > 0) {
      await recordAudit(tx, ctx, {
        action: "ticket.updated",
        entityType: "ticket",
        entityId: ticket.id,
        // Field names only; content (title/description) can be sensitive.
        metadata: { key: ticket.key, fields: changed },
      });
    }
    return { id: ticket.id, version: input.expectedVersion + 1 };
  });
}

/** Soft delete. The row, its history and its audit trail are retained. */
export async function deleteTicket(ctx: OrgContext, raw: unknown): Promise<void> {
  requirePermission(ctx, "tickets.delete");
  const input = parseInput(deleteTicketSchema, raw);
  const db = scopedDb(ctx.organization.id);
  await db.$transaction(async (tx) => {
    const ticket = await tx.ticket.findFirst({
      where: { id: input.ticketId, deletedAt: null },
      select: { id: true, key: true },
    });
    if (!ticket) throw new NotFoundError("Ticket not found.");
    const { count } = await tx.ticket.updateMany({
      where: { id: ticket.id, version: input.expectedVersion },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    });
    if (count === 0) throw new ConflictError();
    await recordAudit(tx, ctx, {
      action: "ticket.deleted",
      entityType: "ticket",
      entityId: ticket.id,
      metadata: { key: ticket.key },
    });
  });
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

/**
 * Add a public reply or internal note, optionally @mentioning members and
 * attaching files the caller already uploaded to this ticket.
 *
 * Mentions are validated so a comment can't be used to notify (and later
 * expose content to) someone who couldn't read it: internal notes may only
 * mention members who can read internal notes; public replies only members
 * who can read this ticket.
 */
export async function addComment(ctx: OrgContext, raw: unknown) {
  requirePermission(ctx, "tickets.comment");
  const input = parseInput(addCommentSchema, raw);
  if (input.visibility === "INTERNAL") requirePermission(ctx, "tickets.comment_internal");
  const organizationId = ctx.organization.id;
  const db = scopedDb(organizationId);

  return db.$transaction(async (tx) => {
    const ticket = await tx.ticket.findFirst({
      where: { AND: [readScope(ctx), { id: input.ticketId }] },
      select: { id: true, key: true, requesterId: true, firstRespondedAt: true },
    });
    if (!ticket) throw new NotFoundError("Ticket not found.");

    const mentionIds = [...new Set(input.mentionUserIds)];
    if (mentionIds.length > 0) {
      if (!can(ctx, "tickets.read")) {
        throw new AuthorizationError("You can't mention people on a request.");
      }
      const members = await tx.organizationMembership.findMany({
        where: { userId: { in: mentionIds }, status: "ACTIVE" },
        select: { userId: true, role: true },
      });
      const allowed = new Set(
        members
          .filter((m) =>
            input.visibility === "INTERNAL"
              ? roleHas(m.role, "tickets.read_internal")
              : memberCanReadTicket(m.role, m.userId, ticket.requesterId),
          )
          .map((m) => m.userId),
      );
      if (mentionIds.some((uid) => !allowed.has(uid))) {
        throw new ValidationError("Some fields are invalid.", {
          mentionUserIds: ["You can only mention members who can see this comment."],
        });
      }
    }

    const attachmentIds = [...new Set(input.attachmentIds)];
    if (attachmentIds.length > 0) {
      const usable = await tx.attachment.count({
        where: {
          id: { in: attachmentIds },
          ticketId: ticket.id,
          uploadedById: ctx.user.id,
          commentId: null,
          deletedAt: null,
          status: { in: ["AVAILABLE", "PENDING_SCAN"] },
        },
      });
      if (usable !== attachmentIds.length) {
        throw new ValidationError("Some fields are invalid.", {
          attachmentIds: ["One or more files are missing or still uploading."],
        });
      }
    }

    const comment = await tx.comment.create({
      data: {
        organizationId,
        ticketId: ticket.id,
        authorId: ctx.user.id,
        body: input.body,
        visibility: input.visibility,
      },
      select: { id: true, visibility: true, createdAt: true },
    });
    if (mentionIds.length > 0) {
      await tx.commentMention.createMany({
        data: mentionIds.map((userId) => ({ organizationId, commentId: comment.id, userId })),
      });
    }
    if (attachmentIds.length > 0) {
      // Files inherit the comment's visibility: attached to an internal note → internal.
      await tx.attachment.updateMany({
        where: { id: { in: attachmentIds } },
        data: { commentId: comment.id, visibility: input.visibility },
      });
    }
    // First public reply by someone other than the requester = first response (SLA input).
    if (!ticket.firstRespondedAt && input.visibility === "PUBLIC" && ctx.user.id !== ticket.requesterId) {
      await tx.ticket.updateMany({ where: { id: ticket.id }, data: { firstRespondedAt: comment.createdAt } });
    }
    await recordAudit(tx, ctx, {
      action: "ticket.comment_added",
      entityType: "ticket",
      entityId: ticket.id,
      // Never the body: comments can hold sensitive content.
      metadata: {
        key: ticket.key,
        commentId: comment.id,
        visibility: comment.visibility,
        mentions: mentionIds.length,
        attachments: attachmentIds.length,
      },
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
