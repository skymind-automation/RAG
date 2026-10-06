import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { ConflictError, ValidationError } from "@/lib/errors";
import { resolveOrgContext } from "@/server/auth/resolve";
import type { OrgContext } from "@/server/context";
import { updateOrganization } from "@/server/organizations/organization-service";
import {
  addComment,
  assignTicket,
  availableTransitions,
  createTicket,
  getTicket,
  listTickets,
  transitionTicket,
  updateTicket,
} from "@/server/tickets/ticket-service";
import { authOf, joinAs, makeOrg, resetDb, statusByKey } from "./helpers";

describe("ticket domain", () => {
  let owner: OrgContext;
  beforeEach(async () => {
    await resetDb();
    owner = await makeOrg("Acme IT", "acme");
  });

  describe("numbering", () => {
    it("allocates gap-free, unique numbers under concurrency", async () => {
      const created = await Promise.all(
        Array.from({ length: 20 }, (_, i) => createTicket(owner, { type: "TASK", title: `Concurrent ${i}` })),
      );
      const keys = created.map((t) => t.key).sort();
      expect(new Set(keys).size).toBe(20);
      expect(keys[0]).toBe("IT-000001");
      expect(keys[19]).toBe("IT-000020");
    });

    it("starts a new sequence when the organization changes its prefix", async () => {
      await createTicket(owner, { type: "TASK", title: "Before rename" });
      await updateOrganization(owner, { name: "Acme", timezone: "UTC", ticketPrefix: "OPS" });
      const renamed = await resolveOrgContext(authOf(owner.user), "acme");
      const t = await createTicket(renamed, { type: "TASK", title: "After rename" });
      expect(t.key).toBe("OPS-000001");
      expect((await getTicket(renamed, "it-000001")).title).toBe("Before rename");
    });

    it("does not consume a number when creation fails", async () => {
      await expect(createTicket(owner, { type: "TASK", title: "bad", priorityKey: "nope" })).rejects.toBeInstanceOf(
        ValidationError,
      );
      expect((await createTicket(owner, { type: "TASK", title: "good" })).key).toBe("IT-000001");
    });
  });

  it("creates with defaults: initial status, default priority, requester as watcher", async () => {
    const agent = await joinAs(owner, "AGENT");
    const t = await createTicket(owner, { type: "INCIDENT", title: "Wi-Fi down", assigneeId: agent.user.id });
    expect(t.status.category).toBe("NEW");
    expect(t.priority.key).toBe("medium");
    const watchers = await prisma.ticketWatcher.findMany({ where: { ticketId: t.id } });
    expect(watchers.map((w) => w.userId).sort()).toEqual([owner.user.id, agent.user.id].sort());
  });

  describe("workflow transitions", () => {
    it("allows configured transitions and rejects others", async () => {
      const t = await createTicket(owner, { type: "INCIDENT", title: "Server down" });
      const targets = (await availableTransitions(owner, t.id)).map((x) => x.toStatus.name);
      expect(targets).toEqual(["Open", "In Progress", "Closed"]);
      await expect(
        transitionTicket(owner, {
          ticketId: t.id,
          toStatusId: await statusByKey(owner, "resolved"),
          expectedVersion: 1,
        }),
      ).rejects.toThrow(/isn't allowed/);
      const r = await transitionTicket(owner, {
        ticketId: t.id,
        toStatusId: await statusByKey(owner, "open"),
        expectedVersion: 1,
      });
      expect(r.version).toBe(2);
    });

    it("requires a resolution to resolve, and stamps lifecycle times", async () => {
      const t = await createTicket(owner, { type: "INCIDENT", title: "Server down" });
      await transitionTicket(owner, {
        ticketId: t.id,
        toStatusId: await statusByKey(owner, "open"),
        expectedVersion: 1,
      });
      const resolved = await statusByKey(owner, "resolved");
      await expect(
        transitionTicket(owner, { ticketId: t.id, toStatusId: resolved, expectedVersion: 2 }),
      ).rejects.toBeInstanceOf(ValidationError);
      await transitionTicket(owner, {
        ticketId: t.id,
        toStatusId: resolved,
        expectedVersion: 2,
        resolution: "Rebooted the switch",
      });
      const afterResolve = await getTicket(owner, t.id);
      expect(afterResolve.resolvedAt).toBeInstanceOf(Date);
      await transitionTicket(owner, {
        ticketId: t.id,
        toStatusId: await statusByKey(owner, "closed"),
        expectedVersion: 3,
      });
      const closed = await getTicket(owner, t.id);
      expect(closed.closedAt).toBeInstanceOf(Date);
      expect(closed.resolvedAt?.getTime()).toBe(afterResolve.resolvedAt?.getTime());
    });

    it("rejects stale writes (optimistic concurrency)", async () => {
      const t = await createTicket(owner, { type: "INCIDENT", title: "Race" });
      await transitionTicket(owner, {
        ticketId: t.id,
        toStatusId: await statusByKey(owner, "open"),
        expectedVersion: 1,
      });
      await expect(
        transitionTicket(owner, {
          ticketId: t.id,
          toStatusId: await statusByKey(owner, "in_progress"),
          expectedVersion: 1,
        }),
      ).rejects.toBeInstanceOf(ConflictError);
      await expect(
        assignTicket(owner, { ticketId: t.id, assigneeId: owner.user.id, expectedVersion: 1 }),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });

  it("records first response only for a public reply from someone other than the requester", async () => {
    const requester = await joinAs(owner, "REQUESTER");
    const t = await createTicket(requester, { type: "QUESTION", title: "How do I reset MFA?" });
    await addComment(requester, { ticketId: t.id, body: "Any update?" });
    await addComment(owner, { ticketId: t.id, body: "checking logs", visibility: "INTERNAL" });
    expect((await getTicket(owner, t.id)).firstRespondedAt).toBeNull();
    await addComment(owner, { ticketId: t.id, body: "Here's how…" });
    expect((await getTicket(owner, t.id)).firstRespondedAt).toBeInstanceOf(Date);
  });

  it("paginates with a stable cursor", async () => {
    for (let i = 0; i < 7; i++) await createTicket(owner, { type: "TASK", title: `Task ${i}` });
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await listTickets(owner, { limit: 3, cursor });
      seen.push(...page.items.map((t) => t.key));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
    expect(seen[0]).toBe("IT-000007");
  });
});

describe("due dates", () => {
  it("interprets a calendar date as the end of that day in the organization's zone", async () => {
    await resetDb();
    const owner = await makeOrg("Chicago IT", "chi");
    await prisma.organization.update({ where: { id: owner.organization.id }, data: { timezone: "America/Chicago" } });
    const ctx = await resolveOrgContext(authOf(owner.user), "chi");
    const t = await createTicket(ctx, { type: "TASK", title: "Due soon", dueAt: "2026-10-05" });
    expect(t.dueAt?.toISOString()).toBe("2026-10-06T04:59:59.999Z");
    await updateTicket(ctx, { ticketId: t.id, expectedVersion: 1, dueAt: "2026-12-24" }); // CST, UTC-6
    expect((await getTicket(ctx, t.id)).dueAt?.toISOString()).toBe("2026-12-25T05:59:59.999Z");
    await expect(updateTicket(ctx, { ticketId: t.id, expectedVersion: 2, dueAt: "2026-02-30" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});
