import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import type { OrgContext } from "@/server/context";
import { addRelation, listRelations, removeRelation } from "@/server/tickets/relation-service";
import {
  addComment,
  assignTicket,
  createTicket,
  deleteTicket,
  getTicket,
  listTickets,
  transitionTicket,
  updateTicket,
} from "@/server/tickets/ticket-service";
import { getTicketTimeline } from "@/server/tickets/timeline-service";
import { addWatcher, removeWatcher } from "@/server/tickets/watcher-service";
import { joinAs, makeOrg, resetDb, statusByKey } from "./helpers";

describe("ticket collaboration", () => {
  let owner: OrgContext;
  let agent: OrgContext;
  let requester: OrgContext;
  let viewer: OrgContext;
  let other: OrgContext;

  beforeEach(async () => {
    await resetDb();
    owner = await makeOrg("Acme IT", "acme");
    agent = await joinAs(owner, "AGENT");
    requester = await joinAs(owner, "REQUESTER", "req");
    viewer = await joinAs(owner, "VIEWER");
    other = await makeOrg("Beta Corp", "beta");
  });

  describe("updateTicket / deleteTicket", () => {
    it("updates fields with optimistic concurrency and audits changed field names only", async () => {
      const t = await createTicket(owner, { type: "INCIDENT", title: "Printer jam", description: "secret details" });
      const r = await updateTicket(agent, {
        ticketId: t.id,
        expectedVersion: 1,
        title: "Printer jam on floor 3",
        priorityKey: "high",
      });
      expect(r.version).toBe(2);
      await expect(updateTicket(agent, { ticketId: t.id, expectedVersion: 1, title: "stale" })).rejects.toBeInstanceOf(
        ConflictError,
      );
      const updated = await getTicket(owner, t.id);
      expect(updated).toMatchObject({ title: "Printer jam on floor 3", priority: { key: "high" }, version: 2 });
      const audits = await prisma.auditLog.findMany({
        where: { entityId: t.id, action: { in: ["ticket.updated", "ticket.priority_changed"] } },
      });
      expect(audits.map((a) => a.action).sort()).toEqual(["ticket.priority_changed", "ticket.updated"]);
      expect(JSON.stringify(audits)).not.toContain("Printer jam on floor 3");
    });

    it("a no-op update does not bump the version", async () => {
      const t = await createTicket(owner, { type: "TASK", title: "Same" });
      expect((await updateTicket(agent, { ticketId: t.id, expectedVersion: 1, title: "Same" })).version).toBe(1);
    });

    it("rejects other tenants' categories/teams and requester edits", async () => {
      const t = await createTicket(owner, { type: "TASK", title: "Edit me" });
      const bCategory = await prisma.ticketCategory.findFirstOrThrow({
        where: { organizationId: other.organization.id },
      });
      await expect(
        updateTicket(agent, { ticketId: t.id, expectedVersion: 1, categoryId: bCategory.id }),
      ).rejects.toBeInstanceOf(ValidationError);
      const mine = await createTicket(requester, { type: "QUESTION", title: "My question" });
      await expect(
        updateTicket(requester, { ticketId: mine.id, expectedVersion: 1, title: "Changed" }),
      ).rejects.toBeInstanceOf(AuthorizationError);
      await expect(updateTicket(other, { ticketId: t.id, expectedVersion: 1, title: "x x x" })).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it("soft-deletes with permission; deleted tickets vanish from reads", async () => {
      const t = await createTicket(owner, { type: "TASK", title: "Delete me" });
      await expect(deleteTicket(agent, { ticketId: t.id, expectedVersion: 1 })).rejects.toBeInstanceOf(
        AuthorizationError,
      );
      await deleteTicket(owner, { ticketId: t.id, expectedVersion: 1 });
      await expect(getTicket(owner, t.id)).rejects.toBeInstanceOf(NotFoundError);
      expect((await listTickets(owner)).items).toHaveLength(0);
      expect(await prisma.ticket.count({ where: { id: t.id } })).toBe(1);
    });
  });

  describe("listTickets filters", () => {
    it("filters by state, assignee (me/unassigned), priority and search", async () => {
      const a = await createTicket(owner, {
        type: "INCIDENT",
        title: "VPN is down",
        priorityKey: "critical",
        assigneeId: agent.user.id,
      });
      const b = await createTicket(owner, { type: "TASK", title: "Order toner" });
      await transitionTicket(owner, {
        ticketId: b.id,
        toStatusId: await statusByKey(owner, "closed"),
        expectedVersion: 1,
      });
      const keys = async (f: Record<string, unknown>) => (await listTickets(agent, f)).items.map((t) => t.key);
      expect(await keys({ state: "open" })).toEqual([a.key]);
      expect(await keys({ state: "closed" })).toEqual([b.key]);
      expect(await keys({ assigneeId: "me" })).toEqual([a.key]);
      expect(await keys({ assigneeId: "unassigned" })).toEqual([b.key]);
      expect(await keys({ priorityKey: "critical" })).toEqual([a.key]);
      expect(await keys({ q: "vpn" })).toEqual([a.key]);
      expect(await keys({ q: b.key.toLowerCase() })).toEqual([b.key]);
    });
  });

  describe("watchers", () => {
    it("anyone who can read may watch; adding others needs tickets.update and readable tickets", async () => {
      const t = await createTicket(owner, { type: "INCIDENT", title: "Outage" });
      await addWatcher(viewer, { ticketId: t.id, userId: viewer.user.id });
      await expect(addWatcher(viewer, { ticketId: t.id, userId: agent.user.id })).rejects.toBeInstanceOf(
        AuthorizationError,
      );
      // A requester can't be made to watch someone else's ticket (they couldn't read it).
      await expect(addWatcher(agent, { ticketId: t.id, userId: requester.user.id })).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(addWatcher(agent, { ticketId: t.id, userId: other.user.id })).rejects.toBeInstanceOf(
        ValidationError,
      );
      await addWatcher(agent, { ticketId: t.id, userId: agent.user.id });
      expect((await getTicket(owner, t.id)).watchers.map((w) => w.id).sort()).toEqual(
        [owner.user.id, viewer.user.id, agent.user.id].sort(),
      );
      await removeWatcher(viewer, { ticketId: t.id, userId: viewer.user.id });
      await expect(removeWatcher(viewer, { ticketId: t.id, userId: agent.user.id })).rejects.toBeInstanceOf(
        AuthorizationError,
      );
    });
  });

  describe("relations", () => {
    it("links tickets by key within the tenant only", async () => {
      const a = await createTicket(owner, { type: "PROBLEM", title: "Root cause" });
      const b = await createTicket(owner, { type: "INCIDENT", title: "Symptom" });
      const foreign = await createTicket(other, { type: "INCIDENT", title: "Beta ticket" });
      expect(foreign.key).toBe("IT-000001"); // same key exists in both tenants…
      await addRelation(agent, { ticketId: b.id, targetKey: a.key, type: "CAUSED_BY" });
      const rels = await listRelations(agent, a.id);
      expect(rels).toEqual([
        expect.objectContaining({
          label: "Causes",
          direction: "incoming",
          ticket: expect.objectContaining({ key: b.key }),
        }),
      ]);
      // …but resolving a key only ever finds the caller's own ticket.
      const c = await createTicket(owner, { type: "TASK", title: "Third" });
      await addRelation(agent, { ticketId: c.id, targetKey: "it-000001", type: "RELATES_TO" });
      expect((await listRelations(agent, c.id))[0]!.ticket.id).toBe(a.id);
      await expect(
        addRelation(agent, { ticketId: a.id, targetKey: "IT-999999", type: "BLOCKS" }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(addRelation(other, { ticketId: a.id, targetKey: b.key, type: "BLOCKS" })).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it("rejects self-links and duplicates (including the symmetric reverse of 'relates to')", async () => {
      const a = await createTicket(owner, { type: "TASK", title: "A ticket" });
      const b = await createTicket(owner, { type: "TASK", title: "B ticket" });
      await expect(addRelation(agent, { ticketId: a.id, targetKey: a.key, type: "BLOCKS" })).rejects.toBeInstanceOf(
        ValidationError,
      );
      const rel = await addRelation(agent, { ticketId: a.id, targetKey: b.key, type: "RELATES_TO" });
      await expect(addRelation(agent, { ticketId: a.id, targetKey: b.key, type: "RELATES_TO" })).rejects.toBeInstanceOf(
        ConflictError,
      );
      await expect(addRelation(agent, { ticketId: b.id, targetKey: a.key, type: "RELATES_TO" })).rejects.toBeInstanceOf(
        ConflictError,
      );
      await removeRelation(agent, { relationId: rel.id });
      expect(await listRelations(agent, a.id)).toEqual([]);
    });

    it("requesters never see links to tickets they can't read", async () => {
      const mine = await createTicket(requester, { type: "INCIDENT", title: "My laptop" });
      const internal = await createTicket(owner, { type: "PROBLEM", title: "Fleet-wide driver bug" });
      await addRelation(agent, { ticketId: mine.id, targetKey: internal.key, type: "CAUSED_BY" });
      expect(await listRelations(requester, mine.id)).toEqual([]);
      await expect(
        addRelation(requester, { ticketId: mine.id, targetKey: internal.key, type: "BLOCKS" }),
      ).rejects.toBeInstanceOf(AuthorizationError);
    });
  });

  describe("mentions", () => {
    it("records valid mentions and rejects members who couldn't see the comment", async () => {
      const t = await createTicket(owner, { type: "INCIDENT", title: "Disk full" });
      const c = await addComment(owner, {
        ticketId: t.id,
        body: "@agent can you check?",
        mentionUserIds: [agent.user.id],
      });
      expect(await prisma.commentMention.count({ where: { commentId: c.id } })).toBe(1);
      // Viewers can read the ticket but not internal notes.
      await expect(
        addComment(owner, {
          ticketId: t.id,
          body: "internal",
          visibility: "INTERNAL",
          mentionUserIds: [viewer.user.id],
        }),
      ).rejects.toBeInstanceOf(ValidationError);
      // A requester can't read someone else's ticket.
      await expect(
        addComment(owner, { ticketId: t.id, body: "hey", mentionUserIds: [requester.user.id] }),
      ).rejects.toBeInstanceOf(ValidationError);
      // Another tenant's user is simply not a member.
      await expect(
        addComment(owner, { ticketId: t.id, body: "hey", mentionUserIds: [other.user.id] }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("allows mentioning the requester on their own ticket, but requesters can't mention", async () => {
      const t = await createTicket(requester, { type: "QUESTION", title: "VPN help" });
      await addComment(agent, { ticketId: t.id, body: "@req does this help?", mentionUserIds: [requester.user.id] });
      await expect(
        addComment(requester, { ticketId: t.id, body: "@agent", mentionUserIds: [agent.user.id] }),
      ).rejects.toBeInstanceOf(AuthorizationError);
    });
  });

  describe("timeline", () => {
    it("merges comments and events; requesters only see public comments, creation and status", async () => {
      const t = await createTicket(requester, { type: "INCIDENT", title: "Monitor dead" });
      await assignTicket(owner, { ticketId: t.id, assigneeId: agent.user.id, expectedVersion: 1 });
      await addComment(agent, { ticketId: t.id, body: "internal: RMA needed", visibility: "INTERNAL" });
      await addComment(agent, { ticketId: t.id, body: "Replacement on the way" });
      await transitionTicket(agent, {
        ticketId: t.id,
        toStatusId: await statusByKey(owner, "open"),
        expectedVersion: 2,
      });
      await updateTicket(agent, { ticketId: t.id, expectedVersion: 3, priorityKey: "high" });

      const staff = await getTicketTimeline(agent, t.id);
      const staffText = staff.map((i) => (i.kind === "event" ? i.text : i.body));
      expect(staffText).toEqual([
        "created the ticket",
        `assigned the ticket to ${agent.user.name}`,
        "internal: RMA needed",
        "Replacement on the way",
        "changed status from New to Open",
        "changed priority from Medium to High",
      ]);

      const portal = await getTicketTimeline(requester, t.id);
      expect(portal.map((i) => (i.kind === "event" ? i.text : i.body))).toEqual([
        "created the ticket",
        "Replacement on the way",
        "changed status from New to Open",
      ]);
      await expect(getTicketTimeline(other, t.id)).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
