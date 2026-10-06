import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import type { OrgContext } from "@/server/context";
import { createTicket } from "@/server/tickets/ticket-service";
import { getTicketTimeline } from "@/server/tickets/timeline-service";
import {
  deleteTimeEntry,
  getRunningTimer,
  listTicketTime,
  logTime,
  startTimer,
  stopTimer,
} from "@/server/time/time-service";
import { joinAs, makeOrg, resetDb } from "./helpers";

describe("time tracking", () => {
  let owner: OrgContext;
  let agent: OrgContext;
  let manager: OrgContext;
  let requester: OrgContext;
  let viewer: OrgContext;
  let other: OrgContext;
  let t1: string;
  let t2: string;

  beforeEach(async () => {
    await resetDb();
    owner = await makeOrg("Acme IT", "acme");
    agent = await joinAs(owner, "AGENT");
    manager = await joinAs(owner, "MANAGER");
    requester = await joinAs(owner, "REQUESTER", "req");
    viewer = await joinAs(owner, "VIEWER");
    other = await makeOrg("Beta Corp", "beta");
    t1 = (await createTicket(owner, { type: "INCIDENT", title: "Server down" })).id;
    t2 = (await createTicket(owner, { type: "TASK", title: "Patch servers" })).id;
  });

  it("starts and stops a timer, recording the duration", async () => {
    const started = await startTimer(agent, { ticketId: t1, description: "investigating", billable: true });
    expect((await getRunningTimer(agent))?.id).toBe(started.id);
    // Pretend it started 25 minutes ago.
    await prisma.timeEntry.update({
      where: { id: started.id },
      data: { startedAt: new Date(Date.now() - 25 * 60_000) },
    });
    const stopped = await stopTimer(agent);
    expect(stopped.durationSeconds).toBeGreaterThanOrEqual(25 * 60);
    expect(stopped.capped).toBe(false);
    expect(await getRunningTimer(agent)).toBeNull();
    const { totals } = await listTicketTime(agent, t1);
    expect(totals.billableSeconds).toBe(totals.totalSeconds);
    await expect(stopTimer(agent)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("prevents overlapping timers, but can switch atomically", async () => {
    await startTimer(agent, { ticketId: t1 });
    await expect(startTimer(agent, { ticketId: t2 })).rejects.toBeInstanceOf(ConflictError);
    const switched = await startTimer(agent, { ticketId: t2, switchFromRunning: true });
    expect(switched.ticket.id).toBe(t2);
    const open = await prisma.timeEntry.findMany({ where: { userId: agent.user.id, endedAt: null } });
    expect(open.map((e) => e.ticketId)).toEqual([t2]);
    // Other users' timers are independent.
    await startTimer(manager, { ticketId: t2 });
  });

  it("the database refuses a second running timer even under a race", async () => {
    const results = await Promise.allSettled([
      startTimer(agent, { ticketId: t1 }),
      startTimer(agent, { ticketId: t2 }),
      startTimer(agent, { ticketId: t1 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      results
        .filter((r) => r.status === "rejected")
        .every((r) => (r as PromiseRejectedResult).reason instanceof ConflictError),
    ).toBe(true);
    await expect(
      prisma.timeEntry.create({
        data: {
          organizationId: owner.organization.id,
          ticketId: t1,
          userId: agent.user.id,
          source: "TIMER",
          startedAt: new Date(),
        },
      }),
    ).rejects.toThrow(/time_entries_one_running_timer|Unique constraint/);
  });

  it("caps a forgotten timer at 24 hours", async () => {
    const s = await startTimer(agent, { ticketId: t1 });
    await prisma.timeEntry.update({
      where: { id: s.id },
      data: { startedAt: new Date(Date.now() - 3 * 24 * 3600_000) },
    });
    const stopped = await stopTimer(agent);
    expect(stopped).toMatchObject({ durationSeconds: 86400, capped: true });
  });

  it("validates manual entries", async () => {
    const e = await logTime(agent, { ticketId: t1, minutes: 90, description: "on-site visit", billable: true });
    expect(e.durationSeconds).toBe(5400);
    await expect(logTime(agent, { ticketId: t1, minutes: 0 })).rejects.toBeInstanceOf(ValidationError);
    await expect(logTime(agent, { ticketId: t1, minutes: 24 * 60 + 1 })).rejects.toBeInstanceOf(ValidationError);
    await expect(
      logTime(agent, { ticketId: t1, minutes: 30, startedAt: new Date(Date.now() + 3600_000) }),
    ).rejects.toMatchObject({ fieldErrors: { startedAt: [expect.stringMatching(/future/)] } });
    await expect(
      prisma.timeEntry.create({
        data: {
          organizationId: owner.organization.id,
          ticketId: t1,
          userId: agent.user.id,
          source: "MANUAL",
          startedAt: new Date(),
        },
      }),
    ).rejects.toThrow(/time_entries_manual_closed_chk/);
  });

  it("only staff track time; requesters never see it; viewers may read it", async () => {
    await expect(startTimer(requester, { ticketId: t1 })).rejects.toBeInstanceOf(AuthorizationError);
    await expect(logTime(viewer, { ticketId: t1, minutes: 5 })).rejects.toBeInstanceOf(AuthorizationError);
    await logTime(agent, { ticketId: t1, minutes: 15 });
    await expect(listTicketTime(requester, t1)).rejects.toBeInstanceOf(AuthorizationError);
    expect((await listTicketTime(viewer, t1)).totals.totalSeconds).toBe(900);
    expect(await getRunningTimer(requester)).toBeNull();
    // Time events are staff-only in the timeline.
    const req = (await createTicket(requester, { type: "QUESTION", title: "Billing question" })).id;
    await logTime(agent, { ticketId: req, minutes: 10 });
    const portal = await getTicketTimeline(requester, req);
    expect(portal.some((i) => i.kind === "event" && i.text.includes("logged"))).toBe(false);
    const staff = await getTicketTimeline(agent, req);
    expect(staff.some((i) => i.kind === "event" && i.text === "logged 10m")).toBe(true);
  });

  it("only the owner (or time.manage) can delete an entry", async () => {
    const e = await logTime(agent, { ticketId: t1, minutes: 30 });
    const agent2 = await joinAs(owner, "AGENT", "agent2");
    await expect(deleteTimeEntry(agent2, { timeEntryId: e.id })).rejects.toBeInstanceOf(AuthorizationError);
    await deleteTimeEntry(manager, { timeEntryId: e.id });
    expect((await listTicketTime(agent, t1)).entries).toHaveLength(0);
    // Deleting a running timer frees the slot.
    await startTimer(agent, { ticketId: t1 });
    const running = (await getRunningTimer(agent))!;
    await deleteTimeEntry(agent, { timeEntryId: running.id });
    await startTimer(agent, { ticketId: t2 });
  });

  it("is tenant isolated", async () => {
    const e = await logTime(agent, { ticketId: t1, minutes: 20 });
    await expect(startTimer(other, { ticketId: t1 })).rejects.toBeInstanceOf(NotFoundError);
    await expect(logTime(other, { ticketId: t1, minutes: 5 })).rejects.toBeInstanceOf(NotFoundError);
    await expect(listTicketTime(other, t1)).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteTimeEntry(other, { timeEntryId: e.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      prisma.timeEntry.create({
        data: {
          organizationId: other.organization.id,
          ticketId: t1,
          userId: other.user.id,
          source: "MANUAL",
          startedAt: new Date(),
          endedAt: new Date(),
          durationSeconds: 0,
        },
      }),
    ).rejects.toThrow(/Foreign key constraint/i);
  });
});
