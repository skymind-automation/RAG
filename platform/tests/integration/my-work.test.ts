import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { AuthorizationError } from "@/lib/errors";
import { resolveOrgContext } from "@/server/auth/resolve";
import type { OrgContext } from "@/server/context";
import { addTeamMember, createTeam } from "@/server/teams/team-service";
import { createTicket, transitionTicket } from "@/server/tickets/ticket-service";
import { addWatcher } from "@/server/tickets/watcher-service";
import { getMyTimeSummary, getMyWork, getMyWorkCounts } from "@/server/work/my-work-service";
import { authOf, joinAs, makeOrg, resetDb, statusByKey } from "./helpers";

// Wednesday 7 Oct 2026, 10:00 in Chicago (15:00 UTC).
const NOW = new Date("2026-10-07T15:00:00Z");

describe("my work", () => {
  let owner: OrgContext;
  let agent: OrgContext;

  beforeEach(async () => {
    await resetDb();
    const o = await makeOrg("Chicago IT", "chi");
    await prisma.organization.update({ where: { id: o.organization.id }, data: { timezone: "America/Chicago" } });
    owner = await resolveOrgContext(authOf(o.user), "chi");
    const a = await joinAs(owner, "AGENT");
    agent = await resolveOrgContext(authOf(a.user), "chi");
  });

  async function mine(title: string, dueAt?: string) {
    return createTicket(owner, { type: "TASK", title, assigneeId: agent.user.id, dueAt });
  }

  it("buckets tickets by the organization's calendar", async () => {
    await mine("due today", "2026-10-07");
    await mine("due friday", "2026-10-09");
    await mine("due next week", "2026-10-13");
    await mine("overdue", "2026-10-05");
    await mine("no due date");
    const done = await mine("closed overdue", "2026-10-01");
    await transitionTicket(owner, {
      ticketId: done.id,
      toStatusId: await statusByKey(owner, "closed"),
      expectedVersion: 1,
    });
    await createTicket(owner, { type: "TASK", title: "someone else's", dueAt: "2026-10-07" });

    const titles = async (v: string) => (await getMyWork(agent, v, NOW)).items.map((t) => t.title);
    expect(await titles("today")).toEqual(["due today"]);
    expect(await titles("week")).toEqual(["overdue", "due today", "due friday"]);
    expect(await titles("overdue")).toEqual(["overdue"]);
    expect(await titles("assigned")).toEqual(["overdue", "due today", "due friday", "due next week", "no due date"]);
    expect(await getMyWorkCounts(agent, NOW)).toMatchObject({ assigned: 5, today: 1, week: 3, overdue: 1 });
  });

  it("a ticket due today is not overdue until the day ends in Chicago", async () => {
    await mine("due today", "2026-10-07");
    const lateEvening = new Date("2026-10-08T04:30:00Z"); // 23:30 CDT on the 7th
    expect((await getMyWork(agent, "overdue", lateEvening)).items).toHaveLength(0);
    const afterMidnight = new Date("2026-10-08T05:30:00Z"); // 00:30 CDT on the 8th
    expect((await getMyWork(agent, "overdue", afterMidnight)).items).toHaveLength(1);
  });

  it("backlog is unassigned work in my teams; watching is what I follow", async () => {
    const team = await createTeam(owner, { name: "Service Desk" });
    await addTeamMember(owner, { teamId: team.id, membershipId: agent.membership.id });
    const otherTeam = await createTeam(owner, { name: "Network" });
    await createTicket(owner, { type: "INCIDENT", title: "desk queue", teamId: team.id });
    await createTicket(owner, { type: "INCIDENT", title: "network queue", teamId: otherTeam.id });
    await createTicket(owner, {
      type: "INCIDENT",
      title: "assigned in desk",
      teamId: team.id,
      assigneeId: owner.user.id,
    });
    const watched = await createTicket(owner, { type: "PROBLEM", title: "root cause" });
    await addWatcher(agent, { ticketId: watched.id, userId: agent.user.id });
    expect((await getMyWork(agent, "backlog", NOW)).items.map((t) => t.title)).toEqual(["desk queue"]);
    expect((await getMyWork(agent, "watching", NOW)).items.map((t) => t.title)).toEqual(["root cause"]);
  });

  it("summarises my logged time for today and this week", async () => {
    const t = await mine("work item");
    // NOW is a fixed future date, so entries are inserted directly (logTime
    // rightly refuses future time against the real clock).
    const entry = (startedAt: string, minutes: number, billable = false) =>
      prisma.timeEntry.create({
        data: {
          organizationId: agent.organization.id,
          ticketId: t.id,
          userId: agent.user.id,
          source: "MANUAL",
          billable,
          startedAt: new Date(startedAt),
          endedAt: new Date(new Date(startedAt).getTime() + minutes * 60_000),
          durationSeconds: minutes * 60,
        },
      });
    await entry("2026-10-07T14:00:00Z", 60, true);
    await entry("2026-10-05T15:00:00Z", 30);
    await entry("2026-10-02T15:00:00Z", 45); // last week
    const s = await getMyTimeSummary(agent, NOW);
    expect(s.today).toEqual({ totalSeconds: 3600, billableSeconds: 3600 });
    expect(s.week).toEqual({ totalSeconds: 5400, billableSeconds: 3600 });
  });

  it("is for staff only and tenant-isolated", async () => {
    const requester = await joinAs(owner, "REQUESTER", "req");
    await expect(getMyWork(requester, "assigned", NOW)).rejects.toBeInstanceOf(AuthorizationError);
    const other = await makeOrg("Beta", "beta");
    await createTicket(other, { type: "TASK", title: "beta task", assigneeId: other.user.id, dueAt: "2026-10-07" });
    expect((await getMyWork(agent, "assigned", NOW)).items).toHaveLength(0);
  });
});
