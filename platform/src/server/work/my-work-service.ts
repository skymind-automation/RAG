import type { Prisma } from "@prisma/client";
import { scopedDb } from "@/lib/db/tenant";
import { ValidationError } from "@/lib/errors";
import { dayRange, weekRange } from "@/lib/time/zoned";
import { requireAnyPermission } from "@/server/auth/resolve";
import type { OrgContext } from "@/server/context";
import { readScope } from "@/server/tickets/ticket-access";
import { ticketListSelect } from "@/server/tickets/ticket-service";
import { myTimeBetween } from "@/server/time/time-service";

/**
 * My Work: the personal views an agent starts the day from.
 *
 *   assigned  open tickets assigned to me
 *   today     …due today (organization calendar)
 *   week      …due this ISO week (Mon–Sun, organization calendar)
 *   overdue   …due date already passed
 *   backlog   open, *unassigned* tickets in my teams (the pick-up queue);
 *             if I'm in no team, unassigned tickets with no team
 *   watching  open tickets I watch
 *
 * "Open" means any status category except RESOLVED and CLOSED. Day and week
 * boundaries come from lib/time/zoned, so they are correct across DST and
 * for zones far from UTC.
 */

export const MY_WORK_VIEWS = ["assigned", "today", "week", "overdue", "backlog", "watching"] as const;
export type MyWorkView = (typeof MY_WORK_VIEWS)[number];

const OPEN: Prisma.TicketWhereInput = { status: { category: { notIn: ["RESOLVED", "CLOSED"] } } };
const LIMIT = 100;

async function viewFilters(ctx: OrgContext, now: Date): Promise<Record<MyWorkView, Prisma.TicketWhereInput>> {
  const tz = ctx.organization.timezone;
  const today = dayRange(now, tz);
  const week = weekRange(now, tz);
  const me = ctx.user.id;
  const teams = await scopedDb(ctx.organization.id).teamMembership.findMany({
    where: { membershipId: ctx.membership.id },
    select: { teamId: true },
  });
  const teamIds = teams.map((t) => t.teamId);
  return {
    assigned: { assigneeId: me },
    today: { assigneeId: me, dueAt: { gte: today.start, lt: today.end } },
    week: { assigneeId: me, dueAt: { gte: week.start, lt: week.end } },
    overdue: { assigneeId: me, dueAt: { lt: now } },
    backlog: { assigneeId: null, ...(teamIds.length ? { teamId: { in: teamIds } } : { teamId: null }) },
    watching: { watchers: { some: { userId: me } } },
  };
}

function scoped(ctx: OrgContext, filter: Prisma.TicketWhereInput): Prisma.TicketWhereInput {
  return { AND: [readScope(ctx), OPEN, filter] };
}

/** Counts for every view, for the tab badges. One round trip per view, in parallel. */
export async function getMyWorkCounts(ctx: OrgContext, now = new Date()): Promise<Record<MyWorkView, number>> {
  requireAnyPermission(ctx, ["tickets.update"]);
  const filters = await viewFilters(ctx, now);
  const db = scopedDb(ctx.organization.id);
  const counts = await Promise.all(MY_WORK_VIEWS.map((v) => db.ticket.count({ where: scoped(ctx, filters[v]) })));
  return Object.fromEntries(MY_WORK_VIEWS.map((v, i) => [v, counts[i]!])) as Record<MyWorkView, number>;
}

export async function getMyWork(ctx: OrgContext, view: string, now = new Date()) {
  requireAnyPermission(ctx, ["tickets.update"]);
  if (!(MY_WORK_VIEWS as readonly string[]).includes(view)) {
    throw new ValidationError("Unknown view.", { view: ["Unknown view."] });
  }
  const filters = await viewFilters(ctx, now);
  const items = await scopedDb(ctx.organization.id).ticket.findMany({
    where: scoped(ctx, filters[view as MyWorkView]),
    select: ticketListSelect,
    // Most urgent first: earliest due date, then priority, then recency.
    orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { priority: { level: "asc" } }, { updatedAt: "desc" }],
    take: LIMIT,
  });
  return { items, truncated: items.length === LIMIT };
}

/** The caller's logged time today and this week (organization calendar). */
export async function getMyTimeSummary(ctx: OrgContext, now = new Date()) {
  const tz = ctx.organization.timezone;
  const today = dayRange(now, tz);
  const week = weekRange(now, tz);
  const [d, w] = await Promise.all([
    myTimeBetween(ctx, today.start, today.end),
    myTimeBetween(ctx, week.start, week.end),
  ]);
  return { today: d, week: w };
}
