import { scopedDb } from "@/lib/db/tenant";
import { AuthorizationError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseInput } from "@/lib/validation/parse";
import { watcherSchema } from "@/lib/validation/schemas";
import { recordAudit } from "@/server/audit/audit-service";
import { can, requireAnyPermission } from "@/server/auth/resolve";
import type { OrgContext } from "@/server/context";
import { memberCanReadTicket, readScope } from "./ticket-access";

/**
 * Watchers receive notifications (Phase 4). Anyone who can read a ticket may
 * watch or unwatch it themselves; adding or removing *other* people requires
 * tickets.update, and only members who can read the ticket can be added.
 */

export async function addWatcher(ctx: OrgContext, raw: unknown): Promise<void> {
  requireAnyPermission(ctx, ["tickets.read", "tickets.read_own"]);
  const input = parseInput(watcherSchema, raw);
  const self = input.userId === ctx.user.id;
  if (!self && !can(ctx, "tickets.update")) throw new AuthorizationError("You can only watch tickets yourself.");
  const db = scopedDb(ctx.organization.id);

  await db.$transaction(async (tx) => {
    const ticket = await tx.ticket.findFirst({
      where: { AND: [readScope(ctx), { id: input.ticketId }] },
      select: { id: true, key: true, requesterId: true },
    });
    if (!ticket) throw new NotFoundError("Ticket not found.");
    const member = await tx.organizationMembership.findFirst({
      where: { userId: input.userId, status: "ACTIVE" },
      select: { role: true },
    });
    if (!member || !memberCanReadTicket(member.role, input.userId, ticket.requesterId)) {
      throw new ValidationError("Some fields are invalid.", { userId: ["This person can't see this ticket."] });
    }
    const { count } = await tx.ticketWatcher.createMany({
      data: [{ organizationId: ctx.organization.id, ticketId: ticket.id, userId: input.userId }],
      skipDuplicates: true,
    });
    if (count > 0) {
      await recordAudit(tx, ctx, {
        action: "ticket.watcher_added",
        entityType: "ticket",
        entityId: ticket.id,
        metadata: { key: ticket.key, userId: input.userId },
      });
    }
  });
}

export async function removeWatcher(ctx: OrgContext, raw: unknown): Promise<void> {
  requireAnyPermission(ctx, ["tickets.read", "tickets.read_own"]);
  const input = parseInput(watcherSchema, raw);
  const self = input.userId === ctx.user.id;
  if (!self && !can(ctx, "tickets.update")) throw new AuthorizationError("You can only unwatch tickets yourself.");
  const db = scopedDb(ctx.organization.id);

  await db.$transaction(async (tx) => {
    const ticket = await tx.ticket.findFirst({
      where: { AND: [readScope(ctx), { id: input.ticketId }] },
      select: { id: true, key: true },
    });
    if (!ticket) throw new NotFoundError("Ticket not found.");
    const { count } = await tx.ticketWatcher.deleteMany({ where: { ticketId: ticket.id, userId: input.userId } });
    if (count > 0) {
      await recordAudit(tx, ctx, {
        action: "ticket.watcher_removed",
        entityType: "ticket",
        entityId: ticket.id,
        metadata: { key: ticket.key, userId: input.userId },
      });
    }
  });
}
