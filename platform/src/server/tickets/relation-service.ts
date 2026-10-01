import type { TicketRelationType } from "@prisma/client";
import { scopedDb } from "@/lib/db/tenant";
import { isUniqueViolation } from "@/lib/db/errors";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseInput } from "@/lib/validation/parse";
import { addRelationSchema, removeRelationSchema } from "@/lib/validation/schemas";
import { recordAudit } from "@/server/audit/audit-service";
import { requireAnyPermission, requirePermission } from "@/server/auth/resolve";
import type { OrgContext } from "@/server/context";
import { readScope } from "./ticket-access";

/**
 * Ticket relations within one organization. Stored directed
 * (source → target); each side displays the appropriate reading.
 */

export const RELATION_LABELS: Record<TicketRelationType, { outgoing: string; incoming: string }> = {
  RELATES_TO: { outgoing: "Relates to", incoming: "Relates to" },
  DUPLICATES: { outgoing: "Duplicates", incoming: "Duplicated by" },
  BLOCKS: { outgoing: "Blocks", incoming: "Blocked by" },
  CAUSED_BY: { outgoing: "Caused by", incoming: "Causes" },
};

export interface RelatedTicket {
  relationId: string;
  label: string;
  type: TicketRelationType;
  direction: "outgoing" | "incoming";
  ticket: { id: string; key: string; title: string; status: { name: string; category: string } };
}

export async function addRelation(ctx: OrgContext, raw: unknown) {
  requirePermission(ctx, "tickets.update");
  const input = parseInput(addRelationSchema, raw);
  const db = scopedDb(ctx.organization.id);
  try {
    return await db.$transaction(async (tx) => {
      const source = await tx.ticket.findFirst({
        where: { id: input.ticketId, deletedAt: null },
        select: { id: true, key: true },
      });
      if (!source) throw new NotFoundError("Ticket not found.");
      // Looked up through the scoped client: another tenant's key simply doesn't exist here.
      const target = await tx.ticket.findFirst({
        where: { key: input.targetKey.toUpperCase(), deletedAt: null },
        select: { id: true, key: true },
      });
      if (!target) throw new ValidationError("Some fields are invalid.", { targetKey: ["No ticket with that key."] });
      if (target.id === source.id) {
        throw new ValidationError("Some fields are invalid.", { targetKey: ["A ticket can't be linked to itself."] });
      }
      // "Relates to" is symmetric: don't store both directions.
      if (input.type === "RELATES_TO") {
        const reverse = await tx.ticketRelation.findFirst({
          where: { sourceTicketId: target.id, targetTicketId: source.id, type: "RELATES_TO" },
          select: { id: true },
        });
        if (reverse) throw new ConflictError("These tickets are already linked.");
      }
      const relation = await tx.ticketRelation.create({
        data: {
          organizationId: ctx.organization.id,
          sourceTicketId: source.id,
          targetTicketId: target.id,
          type: input.type,
          createdById: ctx.user.id,
        },
        select: { id: true },
      });
      await recordAudit(tx, ctx, {
        action: "ticket.relation_added",
        entityType: "ticket",
        entityId: source.id,
        metadata: { key: source.key, type: input.type, target: target.key },
      });
      return relation;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConflictError("These tickets are already linked.");
    throw err;
  }
}

export async function removeRelation(ctx: OrgContext, raw: unknown): Promise<void> {
  requirePermission(ctx, "tickets.update");
  const input = parseInput(removeRelationSchema, raw);
  const db = scopedDb(ctx.organization.id);
  await db.$transaction(async (tx) => {
    const rel = await tx.ticketRelation.findFirst({
      where: { id: input.relationId },
      select: { id: true, type: true, source: { select: { id: true, key: true } }, target: { select: { key: true } } },
    });
    if (!rel) throw new NotFoundError("Link not found.");
    await tx.ticketRelation.deleteMany({ where: { id: rel.id } });
    await recordAudit(tx, ctx, {
      action: "ticket.relation_removed",
      entityType: "ticket",
      entityId: rel.source.id,
      metadata: { key: rel.source.key, type: rel.type, target: rel.target.key },
    });
  });
}

/** Both directions, restricted to tickets the caller can read. */
export async function listRelations(ctx: OrgContext, ticketId: string): Promise<RelatedTicket[]> {
  requireAnyPermission(ctx, ["tickets.read", "tickets.read_own"]);
  const db = scopedDb(ctx.organization.id);
  const scope = readScope(ctx);
  const ticket = await db.ticket.findFirst({ where: { AND: [scope, { id: ticketId }] }, select: { id: true } });
  if (!ticket) throw new NotFoundError("Ticket not found.");
  const other = { id: true, key: true, title: true, status: { select: { name: true, category: true } } } as const;
  const [outgoing, incoming] = await Promise.all([
    db.ticketRelation.findMany({
      where: { sourceTicketId: ticket.id, target: scope },
      select: { id: true, type: true, target: { select: other } },
      orderBy: { createdAt: "asc" },
    }),
    db.ticketRelation.findMany({
      where: { targetTicketId: ticket.id, source: scope },
      select: { id: true, type: true, source: { select: other } },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  return [
    ...outgoing.map((r) => ({
      relationId: r.id,
      type: r.type,
      direction: "outgoing" as const,
      label: RELATION_LABELS[r.type].outgoing,
      ticket: r.target,
    })),
    ...incoming.map((r) => ({
      relationId: r.id,
      type: r.type,
      direction: "incoming" as const,
      label: RELATION_LABELS[r.type].incoming,
      ticket: r.source,
    })),
  ];
}
