import { scopedDb, type ScopedTx } from "@/lib/db/tenant";
import { isUniqueViolation } from "@/lib/db/errors";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseInput } from "@/lib/validation/parse";
import { logTimeSchema, startTimerSchema, timeEntryIdSchema } from "@/lib/validation/schemas";
import { recordAudit } from "@/server/audit/audit-service";
import { can, requireAnyPermission, requirePermission } from "@/server/auth/resolve";
import type { OrgContext } from "@/server/context";

/**
 * TimeService — timers and manual time entries on tickets.
 *
 * Invariants:
 *   * At most one running timer per user per organization. Enforced by a
 *     partial unique index, so two concurrent "start" clicks can't both win.
 *     Starting while one runs is a ConflictError unless the caller asks to
 *     switch, which stops the old timer in the same transaction.
 *   * Every entry is 0–24 h (CHECK). A timer left running longer is capped
 *     at 24 h when stopped and the audit record says so: a forgotten timer
 *     must not silently log three days of billable time.
 *   * Time entries are staff data: requesters never see them.
 *
 * Audited against the ticket, so they appear in the staff timeline.
 */

export const MAX_ENTRY_SECONDS = 24 * 60 * 60;

const entrySelect = {
  id: true,
  description: true,
  billable: true,
  source: true,
  startedAt: true,
  endedAt: true,
  durationSeconds: true,
  user: { select: { id: true, name: true } },
  ticket: { select: { id: true, key: true, title: true } },
} as const;

function canReadTime(ctx: OrgContext): boolean {
  return can(ctx, "time.track") || can(ctx, "reports.read");
}

async function findTicket(tx: ScopedTx, ticketId: string) {
  const ticket = await tx.ticket.findFirst({
    where: { id: ticketId, deletedAt: null },
    select: { id: true, key: true },
  });
  if (!ticket) throw new NotFoundError("Ticket not found.");
  return ticket;
}

async function closeTimer(
  tx: ScopedTx,
  ctx: OrgContext,
  running: { id: string; startedAt: Date; ticket: { id: string; key: string } },
  now: Date,
) {
  const elapsed = Math.max(0, Math.floor((now.getTime() - running.startedAt.getTime()) / 1000));
  const capped = elapsed > MAX_ENTRY_SECONDS;
  const durationSeconds = Math.min(elapsed, MAX_ENTRY_SECONDS);
  const endedAt = capped ? new Date(running.startedAt.getTime() + MAX_ENTRY_SECONDS * 1000) : now;
  const { count } = await tx.timeEntry.updateMany({
    where: { id: running.id, endedAt: null, deletedAt: null },
    data: { endedAt, durationSeconds },
  });
  if (count === 0) throw new ConflictError("This timer was already stopped.");
  await recordAudit(tx, ctx, {
    action: "time.timer_stopped",
    entityType: "ticket",
    entityId: running.ticket.id,
    metadata: { key: running.ticket.key, timeEntryId: running.id, durationSeconds, capped },
  });
  return { durationSeconds, capped };
}

/** The caller's running timer, if any. */
export async function getRunningTimer(ctx: OrgContext) {
  if (!can(ctx, "time.track")) return null;
  return scopedDb(ctx.organization.id).timeEntry.findFirst({
    where: { userId: ctx.user.id, endedAt: null, deletedAt: null },
    select: entrySelect,
  });
}

export async function startTimer(ctx: OrgContext, raw: unknown) {
  requirePermission(ctx, "time.track");
  const input = parseInput(startTimerSchema, raw);
  const db = scopedDb(ctx.organization.id);
  try {
    return await db.$transaction(async (tx) => {
      const ticket = await findTicket(tx, input.ticketId);
      const running = await tx.timeEntry.findFirst({
        where: { userId: ctx.user.id, endedAt: null, deletedAt: null },
        select: { id: true, startedAt: true, ticket: { select: { id: true, key: true } } },
      });
      const now = new Date();
      if (running) {
        if (!input.switchFromRunning) {
          throw new ConflictError(`You already have a timer running on ${running.ticket.key}. Stop it first.`, {
            runningTicket: running.ticket.key,
          });
        }
        await closeTimer(tx, ctx, running, now);
      }
      const entry = await tx.timeEntry.create({
        data: {
          organizationId: ctx.organization.id,
          ticketId: ticket.id,
          userId: ctx.user.id,
          description: input.description,
          billable: input.billable,
          source: "TIMER",
          startedAt: now,
        },
        select: entrySelect,
      });
      await recordAudit(tx, ctx, {
        action: "time.timer_started",
        entityType: "ticket",
        entityId: ticket.id,
        metadata: { key: ticket.key, timeEntryId: entry.id, billable: input.billable },
      });
      return entry;
    });
  } catch (err) {
    // Lost a race with a concurrent start: the partial unique index fired.
    if (isUniqueViolation(err)) throw new ConflictError("You already have a timer running. Stop it first.");
    throw err;
  }
}

export async function stopTimer(ctx: OrgContext) {
  requirePermission(ctx, "time.track");
  const db = scopedDb(ctx.organization.id);
  return db.$transaction(async (tx) => {
    const running = await tx.timeEntry.findFirst({
      where: { userId: ctx.user.id, endedAt: null, deletedAt: null },
      select: { id: true, startedAt: true, ticket: { select: { id: true, key: true } } },
    });
    if (!running) throw new NotFoundError("No timer is running.");
    return { timeEntryId: running.id, ...(await closeTimer(tx, ctx, running, new Date())) };
  });
}

/** Manual entry for time not captured by a timer. */
export async function logTime(ctx: OrgContext, raw: unknown) {
  requirePermission(ctx, "time.track");
  const input = parseInput(logTimeSchema, raw);
  const seconds = input.minutes * 60;
  const now = Date.now();
  const startedAt = input.startedAt ?? new Date(now - seconds * 1000);
  const endedAt = new Date(startedAt.getTime() + seconds * 1000);
  if (endedAt.getTime() > now + 60_000) {
    throw new ValidationError("Some fields are invalid.", { startedAt: ["Time can't be logged in the future."] });
  }
  if (startedAt.getTime() < now - 366 * 24 * 3600 * 1000) {
    throw new ValidationError("Some fields are invalid.", { startedAt: ["Entries older than a year can't be added."] });
  }
  const db = scopedDb(ctx.organization.id);
  return db.$transaction(async (tx) => {
    const ticket = await findTicket(tx, input.ticketId);
    const entry = await tx.timeEntry.create({
      data: {
        organizationId: ctx.organization.id,
        ticketId: ticket.id,
        userId: ctx.user.id,
        description: input.description,
        billable: input.billable,
        source: "MANUAL",
        startedAt,
        endedAt,
        durationSeconds: seconds,
      },
      select: entrySelect,
    });
    await recordAudit(tx, ctx, {
      action: "time.entry_logged",
      entityType: "ticket",
      entityId: ticket.id,
      metadata: { key: ticket.key, timeEntryId: entry.id, durationSeconds: seconds, billable: input.billable },
    });
    return entry;
  });
}

/** Own entries, or anyone's with time.manage. Soft delete. */
export async function deleteTimeEntry(ctx: OrgContext, raw: unknown): Promise<void> {
  requireAnyPermission(ctx, ["time.track", "time.manage"]);
  const { timeEntryId } = parseInput(timeEntryIdSchema, raw);
  const db = scopedDb(ctx.organization.id);
  await db.$transaction(async (tx) => {
    const entry = await tx.timeEntry.findFirst({
      where: { id: timeEntryId, deletedAt: null },
      select: { id: true, userId: true, durationSeconds: true, ticket: { select: { id: true, key: true } } },
    });
    if (!entry) throw new NotFoundError("Time entry not found.");
    if (entry.userId !== ctx.user.id && !can(ctx, "time.manage")) {
      throw new AuthorizationError("You can only remove your own time entries.");
    }
    await tx.timeEntry.updateMany({ where: { id: entry.id }, data: { deletedAt: new Date() } });
    await recordAudit(tx, ctx, {
      action: "time.entry_deleted",
      entityType: "ticket",
      entityId: entry.ticket.id,
      metadata: {
        key: entry.ticket.key,
        timeEntryId: entry.id,
        durationSeconds: entry.durationSeconds,
        ownerId: entry.userId,
      },
    });
  });
}

export interface TimeTotals {
  totalSeconds: number;
  billableSeconds: number;
}

function totalsOf(entries: { durationSeconds: number | null; billable: boolean }[]): TimeTotals {
  let totalSeconds = 0;
  let billableSeconds = 0;
  for (const e of entries) {
    const s = e.durationSeconds ?? 0;
    totalSeconds += s;
    if (e.billable) billableSeconds += s;
  }
  return { totalSeconds, billableSeconds };
}

/** Entries on a ticket (newest first) with totals of closed entries. Staff only. */
export async function listTicketTime(ctx: OrgContext, ticketId: string) {
  if (!canReadTime(ctx)) throw new AuthorizationError();
  const db = scopedDb(ctx.organization.id);
  const ticket = await db.ticket.findFirst({ where: { id: ticketId, deletedAt: null }, select: { id: true } });
  if (!ticket) throw new NotFoundError("Ticket not found.");
  const entries = await db.timeEntry.findMany({
    where: { ticketId: ticket.id, deletedAt: null },
    select: entrySelect,
    orderBy: { startedAt: "desc" },
  });
  return { entries, totals: totalsOf(entries) };
}

/** The caller's closed time in [from, to) — for My Work. */
export async function myTimeBetween(ctx: OrgContext, from: Date, to: Date): Promise<TimeTotals> {
  if (!can(ctx, "time.track")) return { totalSeconds: 0, billableSeconds: 0 };
  const entries = await scopedDb(ctx.organization.id).timeEntry.findMany({
    where: { userId: ctx.user.id, deletedAt: null, endedAt: { not: null }, startedAt: { gte: from, lt: to } },
    select: { durationSeconds: true, billable: true },
  });
  return totalsOf(entries);
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m.toString().padStart(2, "0")}m` : `${m}m`;
}
