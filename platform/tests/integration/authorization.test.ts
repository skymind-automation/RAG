import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import {
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  TenantAccessError,
  ValidationError,
} from "@/lib/errors";
import { listAuditLogs } from "@/server/audit/audit-query";
import { resolveOrgContext, resolveSessionUser } from "@/server/auth/resolve";
import type { OrgContext } from "@/server/context";
import {
  acceptInvitation,
  changeMemberRole,
  inviteMember,
  listMembers,
  removeMember,
} from "@/server/memberships/membership-service";
import { updateOrganization } from "@/server/organizations/organization-service";
import { createTeam } from "@/server/teams/team-service";
import {
  addComment,
  createTicket,
  getTicket,
  listComments,
  listTickets,
  transitionTicket,
} from "@/server/tickets/ticket-service";
import { revokeAllSessions } from "@/server/users/user-service";
import { authOf, joinAs, makeOrg, makeUser, resetDb, statusByKey } from "./helpers";

describe("authorization", () => {
  let owner: OrgContext;

  beforeEach(async () => {
    await resetDb();
    owner = await makeOrg("Acme IT", "acme");
  });

  describe("viewer", () => {
    it("cannot perform administrative actions", async () => {
      const viewer = await joinAs(owner, "VIEWER");
      await expect(
        updateOrganization(viewer, { name: "Hacked", timezone: "UTC", ticketPrefix: "IT" }),
      ).rejects.toBeInstanceOf(AuthorizationError);
      await expect(inviteMember(viewer, { email: "x@example.test", role: "AGENT" })).rejects.toBeInstanceOf(
        AuthorizationError,
      );
      await expect(createTeam(viewer, { name: "Shadow team" })).rejects.toBeInstanceOf(AuthorizationError);
      await expect(listAuditLogs(viewer)).rejects.toBeInstanceOf(AuthorizationError);
      await expect(
        changeMemberRole(viewer, { membershipId: viewer.membership.id, role: "OWNER" }),
      ).rejects.toBeInstanceOf(AuthorizationError);
    });

    it("can read tickets but cannot change them or see internal notes", async () => {
      const viewer = await joinAs(owner, "VIEWER");
      const t = await createTicket(owner, { type: "INCIDENT", title: "Printer on fire" });
      await addComment(owner, { ticketId: t.id, body: "internal: vendor contract expired", visibility: "INTERNAL" });
      await addComment(owner, { ticketId: t.id, body: "We're on it", visibility: "PUBLIC" });
      expect((await getTicket(viewer, t.id)).key).toBe(t.key);
      const comments = await listComments(viewer, t.id);
      expect(comments.map((c) => c.visibility)).toEqual(["PUBLIC"]);
      const open = await statusByKey(owner, "open");
      await expect(
        transitionTicket(viewer, { ticketId: t.id, toStatusId: open, expectedVersion: 1 }),
      ).rejects.toBeInstanceOf(AuthorizationError);
    });
  });

  describe("requester (self-service)", () => {
    let requester: OrgContext;
    let other: OrgContext;
    beforeEach(async () => {
      requester = await joinAs(owner, "REQUESTER", "req-a");
      other = await joinAs(owner, "REQUESTER", "req-b");
    });

    it("sees only their own tickets", async () => {
      const mine = await createTicket(requester, { type: "SERVICE_REQUEST", title: "New laptop" });
      const theirs = await createTicket(other, { type: "SERVICE_REQUEST", title: "New monitor" });
      const agentTicket = await createTicket(owner, { type: "TASK", title: "Rotate certs" });
      expect((await listTickets(requester)).items.map((t) => t.id)).toEqual([mine.id]);
      await expect(getTicket(requester, theirs.id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(getTicket(requester, agentTicket.id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(addComment(requester, { ticketId: theirs.id, body: "hi" })).rejects.toBeInstanceOf(NotFoundError);
    });

    it("never receives internal notes, and cannot write them", async () => {
      const t = await createTicket(requester, { type: "INCIDENT", title: "Email down" });
      await addComment(owner, { ticketId: t.id, body: "internal: user is on the watchlist", visibility: "INTERNAL" });
      await addComment(owner, { ticketId: t.id, body: "Looking into it", visibility: "PUBLIC" });
      const comments = await listComments(requester, t.id);
      expect(comments).toHaveLength(1);
      expect(comments[0]!.body).toBe("Looking into it");
      await expect(
        addComment(requester, { ticketId: t.id, body: "sneaky", visibility: "INTERNAL" }),
      ).rejects.toBeInstanceOf(AuthorizationError);
    });

    it("cannot set routing fields or file on behalf of someone else", async () => {
      await expect(
        createTicket(requester, { type: "INCIDENT", title: "x!!", assigneeId: owner.user.id }),
      ).rejects.toBeInstanceOf(AuthorizationError);
      await expect(
        createTicket(requester, { type: "INCIDENT", title: "x!!", requesterId: other.user.id }),
      ).rejects.toBeInstanceOf(AuthorizationError);
      const t = await createTicket(requester, { type: "INCIDENT", title: "source forced", source: "API" });
      expect((await getTicket(owner, t.id)).source).toBe("PORTAL");
    });

    it("cannot be assigned tickets", async () => {
      await expect(
        createTicket(owner, { type: "INCIDENT", title: "assign to requester", assigneeId: requester.user.id }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  it("agent sees internal notes", async () => {
    const agent = await joinAs(owner, "AGENT");
    const t = await createTicket(owner, { type: "INCIDENT", title: "Disk full" });
    await addComment(owner, { ticketId: t.id, body: "internal", visibility: "INTERNAL" });
    expect((await listComments(agent, t.id)).map((c) => c.visibility)).toEqual(["INTERNAL"]);
  });

  describe("role escalation", () => {
    it("nobody below owner can grant a role at or above their own", async () => {
      const admin = await joinAs(owner, "ADMIN");
      const manager = await joinAs(owner, "MANAGER");
      await expect(inviteMember(admin, { email: "o@example.test", role: "OWNER" })).rejects.toBeInstanceOf(
        AuthorizationError,
      );
      await expect(inviteMember(admin, { email: "a@example.test", role: "ADMIN" })).rejects.toBeInstanceOf(
        AuthorizationError,
      );
      await expect(inviteMember(manager, { email: "m@example.test", role: "MANAGER" })).rejects.toBeInstanceOf(
        AuthorizationError,
      );
      await expect(inviteMember(manager, { email: "ag@example.test", role: "AGENT" })).resolves.toBeDefined();
      await expect(inviteMember(owner, { email: "o2@example.test", role: "OWNER" })).resolves.toBeDefined();
    });

    it("an admin cannot modify an owner or a peer admin, nor promote themselves", async () => {
      const admin = await joinAs(owner, "ADMIN");
      const admin2 = await joinAs(owner, "ADMIN", "admin2");
      await expect(
        changeMemberRole(admin, { membershipId: owner.membership.id, role: "VIEWER" }),
      ).rejects.toBeInstanceOf(AuthorizationError);
      await expect(
        changeMemberRole(admin, { membershipId: admin2.membership.id, role: "VIEWER" }),
      ).rejects.toBeInstanceOf(AuthorizationError);
      await expect(
        changeMemberRole(admin, { membershipId: admin.membership.id, role: "OWNER" }),
      ).rejects.toBeInstanceOf(AuthorizationError);
      await expect(removeMember(admin, { membershipId: owner.membership.id })).rejects.toBeInstanceOf(
        AuthorizationError,
      );
    });

    it("the last owner can be neither demoted nor removed", async () => {
      await expect(
        changeMemberRole(owner, { membershipId: owner.membership.id, role: "ADMIN" }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(removeMember(owner, { membershipId: owner.membership.id })).rejects.toBeInstanceOf(ValidationError);
      const second = await joinAs(owner, "OWNER", "owner2");
      await changeMemberRole(owner, { membershipId: owner.membership.id, role: "ADMIN" });
      const members = await listMembers(second);
      expect(members.find((m) => m.userId === owner.user.id)?.role).toBe("ADMIN");
    });

    it("role changes take effect on the very next request", async () => {
      const agent = await joinAs(owner, "AGENT");
      await changeMemberRole(owner, { membershipId: agent.membership.id, role: "VIEWER" });
      const fresh = await resolveOrgContext(authOf(agent.user), "acme");
      expect(fresh.role).toBe("VIEWER");
      expect(fresh.permissions.has("tickets.update")).toBe(false);
    });
  });

  describe("removed member", () => {
    it("loses access immediately", async () => {
      const agent = await joinAs(owner, "AGENT");
      await createTicket(agent, { type: "TASK", title: "Created before removal" });
      await removeMember(owner, { membershipId: agent.membership.id });
      await expect(resolveOrgContext(authOf(agent.user), "acme")).rejects.toBeInstanceOf(TenantAccessError);
      // The stale context they may still hold is useless for new lookups:
      expect((await listMembers(owner)).map((m) => m.userId)).not.toContain(agent.user.id);
      // History is preserved (FKs from their ticket still valid).
      expect(await prisma.ticket.count({ where: { createdById: agent.user.id } })).toBe(1);
    });

    it("can leave voluntarily, and can be re-invited", async () => {
      const agent = await joinAs(owner, "AGENT");
      await removeMember(agent, { membershipId: agent.membership.id });
      await expect(resolveOrgContext(authOf(agent.user), "acme")).rejects.toBeInstanceOf(TenantAccessError);
      const { token } = await inviteMember(owner, { email: agent.user.email, role: "VIEWER" });
      await acceptInvitation(authOf(agent.user), token);
      expect((await resolveOrgContext(authOf(agent.user), "acme")).role).toBe("VIEWER");
    });
  });

  describe("invitations", () => {
    it("are bound to the invited email, single-use and expiring", async () => {
      const invitee = await makeUser("Invitee");
      const stranger = await makeUser("Stranger");
      const { token, invitationId } = await inviteMember(owner, { email: invitee.email, role: "AGENT" });
      await expect(acceptInvitation(authOf(stranger), token)).rejects.toBeInstanceOf(AuthorizationError);
      await expect(acceptInvitation(authOf(invitee), "not-a-real-token")).rejects.toBeInstanceOf(NotFoundError);
      expect(await acceptInvitation(authOf(invitee), token)).toEqual({ slug: "acme" });
      await expect(acceptInvitation(authOf(invitee), token)).rejects.toBeInstanceOf(NotFoundError);
      const row = await prisma.invitation.findUniqueOrThrow({ where: { id: invitationId } });
      expect(row.tokenHash).not.toBe(token); // only the hash is stored

      const late = await makeUser("Late");
      const expired = await inviteMember(owner, { email: late.email, role: "AGENT" });
      await prisma.invitation.update({
        where: { id: expired.invitationId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await expect(acceptInvitation(authOf(late), expired.token)).rejects.toBeInstanceOf(NotFoundError);
    });

    it("re-inviting revokes the previous link", async () => {
      const invitee = await makeUser("Twice");
      const first = await inviteMember(owner, { email: invitee.email, role: "AGENT" });
      await inviteMember(owner, { email: invitee.email, role: "VIEWER" });
      await expect(acceptInvitation(authOf(invitee), first.token)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("sessions", () => {
    it("rejects a session whose version was bumped (sign out everywhere)", async () => {
      const user = await makeUser("Session User");
      await expect(resolveSessionUser({ userId: user.id, sessionVersion: 1 })).resolves.toMatchObject({ id: user.id });
      await revokeAllSessions(user.id);
      await expect(resolveSessionUser({ userId: user.id, sessionVersion: 1 })).rejects.toBeInstanceOf(
        AuthenticationError,
      );
    });

    it("rejects deactivated users and missing claims", async () => {
      const user = await makeUser("Deactivated");
      await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
      await expect(resolveSessionUser({ userId: user.id, sessionVersion: 1 })).rejects.toBeInstanceOf(
        AuthenticationError,
      );
      await expect(resolveSessionUser({ userId: undefined, sessionVersion: 1 })).rejects.toBeInstanceOf(
        AuthenticationError,
      );
    });

    it("rejects entry into a soft-deleted organization", async () => {
      await prisma.organization.update({ where: { id: owner.organization.id }, data: { deletedAt: new Date() } });
      await expect(resolveOrgContext(authOf(owner.user), "acme")).rejects.toBeInstanceOf(TenantAccessError);
    });
  });
});
