import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { recordAudit } from "@/server/audit/audit-service";
import type { OrgContext } from "@/server/context";
import { changeMemberRole, inviteMember } from "@/server/memberships/membership-service";
import { updateOrganization } from "@/server/organizations/organization-service";
import { createTicket, transitionTicket } from "@/server/tickets/ticket-service";
import { joinAs, makeOrg, resetDb, statusByKey } from "./helpers";

describe("audit log", () => {
  let owner: OrgContext;
  beforeEach(async () => {
    await resetDb();
    owner = await makeOrg("Acme IT", "acme");
  });

  async function actions(): Promise<string[]> {
    const rows = await prisma.auditLog.findMany({
      where: { organizationId: owner.organization.id },
      orderBy: { createdAt: "asc" },
      select: { action: true },
    });
    return rows.map((r) => r.action);
  }

  it("records business-critical actions with actor, tenant and request metadata", async () => {
    const agent = await joinAs(owner, "AGENT");
    await inviteMember(owner, { email: "new@example.test", role: "AGENT" });
    await changeMemberRole(owner, { membershipId: agent.membership.id, role: "MANAGER" });
    const t = await createTicket(owner, { type: "INCIDENT", title: "Outage" });
    await transitionTicket(owner, { ticketId: t.id, toStatusId: await statusByKey(owner, "open"), expectedVersion: 1 });
    await updateOrganization(owner, { name: "Acme IT Ops", timezone: "Europe/London", ticketPrefix: "OPS" });

    expect(await actions()).toEqual([
      "organization.created",
      "membership.invited",
      "membership.role_changed",
      "ticket.created",
      "ticket.status_changed",
      "organization.updated",
    ]);
    const roleChange = await prisma.auditLog.findFirstOrThrow({ where: { action: "membership.role_changed" } });
    expect(roleChange).toMatchObject({
      organizationId: owner.organization.id,
      actorId: owner.user.id,
      actorType: "USER",
      entityType: "membership",
      entityId: agent.membership.id,
      ipAddress: "203.0.113.7",
      userAgent: "vitest",
    });
    expect(roleChange.metadata).toMatchObject({ from: "AGENT", to: "MANAGER" });
    const orgUpdate = await prisma.auditLog.findFirstOrThrow({ where: { action: "organization.updated" } });
    expect(orgUpdate.metadata).toMatchObject({ changes: { ticketPrefix: { from: "IT", to: "OPS" } } });
  });

  it("does not record a change that rolled back", async () => {
    const before = (await actions()).length;
    await expect(
      transitionTicket(owner, { ticketId: "nope", toStatusId: "nope", expectedVersion: 1 }),
    ).rejects.toThrow();
    expect((await actions()).length).toBe(before);
  });

  it("redacts secret-looking metadata keys", async () => {
    await recordAudit(prisma, owner, {
      action: "organization.updated",
      entityType: "organization",
      metadata: { apiKey: "sk-live-123", nested: { password: "hunter2", ok: "kept" } },
    });
    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: "organization.updated" } });
    expect(JSON.stringify(row.metadata)).not.toContain("sk-live-123");
    expect(JSON.stringify(row.metadata)).not.toContain("hunter2");
    expect(row.metadata).toMatchObject({ nested: { ok: "kept" } });
  });

  it("is append-only: UPDATE and DELETE are rejected by the database", async () => {
    const row = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: owner.organization.id } });
    await expect(prisma.auditLog.update({ where: { id: row.id }, data: { action: "tampered" } })).rejects.toThrow(
      /append-only/,
    );
    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRaw`UPDATE audit_logs SET action = 'x'`).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRaw`DELETE FROM audit_logs`).rejects.toThrow(/append-only/);
  });
});
