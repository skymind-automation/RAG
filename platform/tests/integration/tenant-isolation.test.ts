import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { scopedDb } from "@/lib/db/tenant";
import { NotFoundError, TenantAccessError, ValidationError } from "@/lib/errors";
import { listAuditLogs } from "@/server/audit/audit-query";
import { resolveOrgContext } from "@/server/auth/resolve";
import type { OrgContext } from "@/server/context";
import { listMembers } from "@/server/memberships/membership-service";
import { addTeamMember, createTeam, listTeams } from "@/server/teams/team-service";
import {
  addComment,
  assignTicket,
  createTicket,
  getTicket,
  listComments,
  listTickets,
} from "@/server/tickets/ticket-service";
import { authOf, joinAs, makeOrg, resetDb } from "./helpers";

/**
 * The core promise of the platform: Organization A can never read, search,
 * reference or modify Organization B's data — through services, through the
 * scoped client, or even through the raw client (database constraints).
 */
describe("tenant isolation", () => {
  let a: OrgContext;
  let b: OrgContext;
  let bTicket: { id: string; key: string };

  beforeEach(async () => {
    await resetDb();
    a = await makeOrg("Acme IT", "acme");
    b = await makeOrg("Beta Corp", "beta");
    // Deliberately identical content in both tenants.
    await createTicket(a, { type: "INCIDENT", title: "VPN drops every 10 minutes" });
    bTicket = await createTicket(b, { type: "INCIDENT", title: "VPN drops every 10 minutes" });
  });

  it("numbers tickets per organization — both tenants have IT-000001", async () => {
    const aList = await listTickets(a);
    const bList = await listTickets(b);
    expect(aList.items.map((t) => t.key)).toEqual(["IT-000001"]);
    expect(bList.items.map((t) => t.key)).toEqual(["IT-000001"]);
    expect(aList.items[0]!.id).not.toBe(bList.items[0]!.id);
  });

  it("Organization A cannot read Organization B's ticket by id", async () => {
    await expect(getTicket(a, bTicket.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("Organization A cannot read Organization B's comments", async () => {
    await addComment(b, { ticketId: bTicket.id, body: "B-only secret", visibility: "INTERNAL" });
    await expect(listComments(a, bTicket.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("Organization A cannot comment on or assign Organization B's ticket", async () => {
    await expect(addComment(a, { ticketId: bTicket.id, body: "hi" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      assignTicket(a, { ticketId: bTicket.id, assigneeId: a.user.id, expectedVersion: 1 }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("list endpoints only return the caller's tenant", async () => {
    await createTeam(b, { name: "B Network Team" });
    expect((await listTeams(a)).map((t) => t.name)).toEqual([]);
    const aMembers = await listMembers(a);
    expect(aMembers.map((m) => m.userId)).toEqual([a.user.id]);
    const aAudit = await listAuditLogs(a);
    expect(aAudit.items.length).toBeGreaterThan(0);
    const bIds = new Set((await listAuditLogs(b)).items.map((x) => x.id));
    expect(aAudit.items.some((x) => bIds.has(x.id))).toBe(false);
  });

  it("a user who is not a member cannot establish context in another organization", async () => {
    await expect(resolveOrgContext(authOf(a.user), "beta")).rejects.toBeInstanceOf(TenantAccessError);
    await expect(resolveOrgContext(authOf(a.user), "does-not-exist")).rejects.toBeInstanceOf(TenantAccessError);
  });

  it("rejects references to another tenant's category, team, requester or assignee", async () => {
    const bCategory = await prisma.ticketCategory.findFirstOrThrow({ where: { organizationId: b.organization.id } });
    const bTeam = await createTeam(b, { name: "B Team" });
    const base = { type: "INCIDENT" as const, title: "cross tenant refs" };
    await expect(createTicket(a, { ...base, categoryId: bCategory.id })).rejects.toBeInstanceOf(ValidationError);
    await expect(createTicket(a, { ...base, teamId: bTeam.id })).rejects.toBeInstanceOf(ValidationError);
    await expect(createTicket(a, { ...base, requesterId: b.user.id })).rejects.toBeInstanceOf(ValidationError);
    await expect(createTicket(a, { ...base, assigneeId: b.user.id })).rejects.toBeInstanceOf(ValidationError);
  });

  it("cannot add another tenant's member to a team", async () => {
    const team = await createTeam(a, { name: "A Team" });
    await expect(addTeamMember(a, { teamId: team.id, membershipId: b.membership.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  describe("scoped client (layer 2)", () => {
    it("injects the organization filter even when the caller forgets it", async () => {
      const rows = await scopedDb(a.organization.id).ticket.findMany({ select: { organizationId: true } });
      expect(rows.length).toBe(1);
      expect(rows.every((r) => r.organizationId === a.organization.id)).toBe(true);
      expect(await scopedDb(a.organization.id).ticket.findFirst({ where: { id: bTicket.id } })).toBeNull();
      expect(await scopedDb(a.organization.id).ticket.count()).toBe(1);
    });

    it("applies to findUnique and update by primary key", async () => {
      const db = scopedDb(a.organization.id);
      expect(await db.ticket.findUnique({ where: { id: bTicket.id } })).toBeNull();
      await expect(db.ticket.update({ where: { id: bTicket.id }, data: { title: "pwned" } })).rejects.toThrow();
      const { count } = await db.ticket.updateMany({ where: { id: bTicket.id }, data: { title: "pwned" } });
      expect(count).toBe(0);
      const { count: deleted } = await db.ticket.deleteMany({ where: { id: bTicket.id } });
      expect(deleted).toBe(0);
      const still = await prisma.ticket.findUniqueOrThrow({ where: { id: bTicket.id } });
      expect(still.title).toBe("VPN drops every 10 minutes");
    });

    it("throws when a query explicitly names another organization", async () => {
      const db = scopedDb(a.organization.id);
      await expect(db.ticket.findMany({ where: { organizationId: b.organization.id } })).rejects.toBeInstanceOf(
        TenantAccessError,
      );
      await expect(
        db.team.create({ data: { organizationId: b.organization.id, name: "smuggled" } }),
      ).rejects.toBeInstanceOf(TenantAccessError);
      await expect(
        db.team.updateMany({ where: {}, data: { organizationId: b.organization.id } }),
      ).rejects.toBeInstanceOf(TenantAccessError);
    });

    it("stays scoped inside interactive transactions", async () => {
      const count = await scopedDb(a.organization.id).$transaction((tx) => tx.ticket.count());
      expect(count).toBe(1);
    });

    it("fails closed without an organization id", () => {
      expect(() => scopedDb("")).toThrow(TenantAccessError);
    });
  });

  describe("database constraints (layer 3)", () => {
    it("rejects a ticket in A that points at B's category even via the raw client", async () => {
      const bCategory = await prisma.ticketCategory.findFirstOrThrow({ where: { organizationId: b.organization.id } });
      await expect(
        prisma.ticket.update({
          where: { id: (await listTickets(a)).items[0]!.id },
          data: { categoryId: bCategory.id },
        }),
      ).rejects.toThrow(/Foreign key constraint/i);
    });

    it("rejects a comment in A attached to B's ticket", async () => {
      await expect(
        prisma.comment.create({
          data: { organizationId: a.organization.id, ticketId: bTicket.id, authorId: a.user.id, body: "x" },
        }),
      ).rejects.toThrow(/Foreign key constraint/i);
    });

    it("rejects assigning a ticket to a user who was never a member of the tenant", async () => {
      const aTicketId = (await listTickets(a)).items[0]!.id;
      await expect(prisma.ticket.update({ where: { id: aTicketId }, data: { assigneeId: b.user.id } })).rejects.toThrow(
        /Foreign key constraint/i,
      );
    });

    it("rejects a team membership that spans tenants", async () => {
      const aTeam = await createTeam(a, { name: "A Team" });
      await expect(
        prisma.teamMembership.create({
          data: { organizationId: a.organization.id, teamId: aTeam.id, membershipId: b.membership.id },
        }),
      ).rejects.toThrow(/Foreign key constraint/i);
    });
  });

  it("a member of both organizations sees each tenant's data only in its own context", async () => {
    const dual = await joinAs(a, "AGENT", "dual");
    await prisma.organizationMembership.create({
      data: { organizationId: b.organization.id, userId: dual.user.id, role: "VIEWER" },
    });
    const inB = await resolveOrgContext(authOf(dual.user), "beta");
    expect(dual.role).toBe("AGENT");
    expect(inB.role).toBe("VIEWER");
    const inA = await listTickets(dual);
    const inBList = await listTickets(inB);
    expect(inA.items.map((t) => t.id)).not.toContain(bTicket.id);
    expect(inBList.items.map((t) => t.id)).toEqual([bTicket.id]);
  });
});
