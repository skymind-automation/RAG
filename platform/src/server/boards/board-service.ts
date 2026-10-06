import type { Prisma, StatusCategory } from "@prisma/client";
import { scopedDb } from "@/lib/db/tenant";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { parseInput } from "@/lib/validation/parse";
import { boardFilterSchema, moveTicketSchema } from "@/lib/validation/schemas";
import { requirePermission } from "@/server/auth/resolve";
import type { OrgContext } from "@/server/context";
import { readScope } from "@/server/tickets/ticket-access";
import { transitionTicket } from "@/server/tickets/ticket-service";

/**
 * Kanban boards. Columns are status *categories*, not individual statuses,
 * so every organization's board has the same shape whatever it names its
 * statuses (ADR-0007). Moving a card to a column means "take the first
 * allowed transition into that category"; the move goes through
 * transitionTicket(), so workflow rules, required resolutions, optimistic
 * concurrency and audit all apply exactly as on the ticket page.
 */

export const BOARD_COLUMNS = [
  "NEW",
  "OPEN",
  "IN_PROGRESS",
  "PENDING",
  "RESOLVED",
] as const satisfies readonly StatusCategory[];
export type BoardColumn = (typeof BOARD_COLUMNS)[number];
const PER_COLUMN = 50;

const cardSelect = {
  id: true,
  key: true,
  title: true,
  type: true,
  version: true,
  dueAt: true,
  updatedAt: true,
  status: { select: { id: true, name: true, category: true } },
  priority: { select: { key: true, name: true, level: true, color: true } },
  assignee: { select: { id: true, name: true } },
  team: { select: { id: true, name: true } },
} satisfies Prisma.TicketSelect;

export type BoardCard = Prisma.TicketGetPayload<{ select: typeof cardSelect }>;

export interface Board {
  columns: { category: BoardColumn; total: number; cards: BoardCard[] }[];
}

export async function getBoard(ctx: OrgContext, raw: unknown = {}): Promise<Board> {
  requirePermission(ctx, "tickets.read");
  const f = parseInput(boardFilterSchema, raw);
  const assignee = f.assigneeId === "me" ? ctx.user.id : f.assigneeId === "unassigned" ? null : f.assigneeId;
  const base: Prisma.TicketWhereInput = {
    AND: [
      readScope(ctx),
      f.teamId ? { teamId: f.teamId } : {},
      f.assigneeId !== undefined ? { assigneeId: assignee } : {},
      f.priorityKey ? { priority: { key: f.priorityKey } } : {},
      f.type ? { type: f.type } : {},
    ],
  };
  const db = scopedDb(ctx.organization.id);
  const columns = await Promise.all(
    BOARD_COLUMNS.map(async (category) => {
      const where = { AND: [base, { status: { category } }] };
      const [cards, total] = await Promise.all([
        db.ticket.findMany({
          where,
          select: cardSelect,
          orderBy: [{ priority: { level: "asc" } }, { updatedAt: "desc" }, { id: "asc" }],
          take: PER_COLUMN,
        }),
        db.ticket.count({ where }),
      ]);
      return { category, total, cards };
    }),
  );
  return { columns };
}

/** Move a card to a column via the workflow. */
export async function moveTicket(ctx: OrgContext, raw: unknown) {
  requirePermission(ctx, "tickets.transition");
  const input = parseInput(moveTicketSchema, raw);
  const db = scopedDb(ctx.organization.id);
  const ticket = await db.ticket.findFirst({
    where: { id: input.ticketId, deletedAt: null },
    select: { id: true, status: { select: { id: true, name: true, category: true } } },
  });
  if (!ticket) throw new NotFoundError("Ticket not found.");
  if (ticket.status.category === input.toCategory) {
    return { id: ticket.id, version: input.expectedVersion, status: ticket.status, moved: false };
  }
  const transition = await db.workflowTransition.findFirst({
    where: { fromStatusId: ticket.status.id, toStatus: { category: input.toCategory } },
    select: { toStatusId: true },
    orderBy: { toStatus: { position: "asc" } },
  });
  if (!transition) {
    throw new ValidationError(`This workflow doesn't allow moving from ${ticket.status.name} to that column.`, {
      toCategory: ["Not an allowed transition."],
    });
  }
  const result = await transitionTicket(ctx, {
    ticketId: ticket.id,
    toStatusId: transition.toStatusId,
    expectedVersion: input.expectedVersion,
    resolution: input.resolution,
  });
  return { ...result, moved: true };
}
