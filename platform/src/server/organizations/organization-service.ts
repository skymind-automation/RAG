import type { OrgRole, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { scopedDb } from "@/lib/db/tenant";
import { isUniqueViolation } from "@/lib/db/errors";
import { ValidationError } from "@/lib/errors";
import { parseInput } from "@/lib/validation/parse";
import { createOrganizationSchema, updateOrganizationSchema } from "@/lib/validation/schemas";
import { recordAudit, recordGlobalAudit } from "@/server/audit/audit-service";
import { resolveOrgContext, requirePermission } from "@/server/auth/resolve";
import type { AuthContext, OrgContext } from "@/server/context";
import { provisionOrganizationDefaults } from "./defaults";

/**
 * OrganizationService.
 *
 * `organizations` is the tenant table itself, so reads and writes here key
 * on `ctx.organization.id` (from the verified context) rather than going
 * through the tenant-scoped client.
 */

export interface OrganizationSummary {
  id: string;
  slug: string;
  name: string;
  role: OrgRole;
}

export async function createOrganization(auth: AuthContext, raw: unknown): Promise<OrganizationSummary> {
  const input = parseInput(createOrganizationSchema, raw);
  try {
    return await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: { name: input.name, slug: input.slug, timezone: input.timezone },
      });
      await tx.organizationMembership.create({
        data: { organizationId: org.id, userId: auth.user.id, role: "OWNER" },
      });
      await provisionOrganizationDefaults(tx, org.id, org.ticketPrefix);
      await tx.user.update({ where: { id: auth.user.id }, data: { lastActiveOrganizationId: org.id } });
      await recordGlobalAudit(tx, {
        organizationId: org.id,
        actorId: auth.user.id,
        action: "organization.created",
        entityType: "organization",
        entityId: org.id,
        metadata: { name: org.name, slug: org.slug },
        request: auth.request,
      });
      return { id: org.id, slug: org.slug, name: org.name, role: "OWNER" as const };
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ValidationError("Some fields are invalid.", { slug: ["That address is already taken."] });
    }
    throw err;
  }
}

/** Organizations the user can currently enter (ACTIVE membership, org not deleted). */
export async function listMyOrganizations(userId: string): Promise<OrganizationSummary[]> {
  const rows = await prisma.organizationMembership.findMany({
    where: { userId, status: "ACTIVE", organization: { deletedAt: null } },
    select: { role: true, organization: { select: { id: true, slug: true, name: true } } },
    orderBy: { organization: { name: "asc" } },
  });
  return rows.map((r) => ({ ...r.organization, role: r.role }));
}

/**
 * Where to land after login: the last active organization if the user is
 * still a member, else their first organization, else null (→ onboarding).
 */
export async function resolveLandingOrganization(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { lastActiveOrganizationId: true } });
  const orgs = await listMyOrganizations(userId);
  const last = orgs.find((o) => o.id === user?.lastActiveOrganizationId);
  return (last ?? orgs[0])?.slug ?? null;
}

/**
 * Switch the active organization. Membership is verified exactly as for any
 * request (resolveOrgContext); the stored preference is a landing hint only.
 */
export async function switchOrganization(auth: AuthContext, slug: string): Promise<OrgContext> {
  const ctx = await resolveOrgContext(auth, slug);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: auth.user.id }, data: { lastActiveOrganizationId: ctx.organization.id } });
    await recordAudit(tx, ctx, {
      action: "organization.switched",
      entityType: "organization",
      entityId: ctx.organization.id,
    });
  });
  return ctx;
}

export async function getOrganizationSettings(ctx: OrgContext) {
  requirePermission(ctx, "organization.read");
  return prisma.organization.findUniqueOrThrow({
    where: { id: ctx.organization.id },
    select: {
      id: true,
      name: true,
      slug: true,
      timezone: true,
      ticketPrefix: true,
      ticketNumberPadding: true,
      createdAt: true,
    },
  });
}

export async function updateOrganization(ctx: OrgContext, raw: unknown) {
  requirePermission(ctx, "organization.update");
  const input = parseInput(updateOrganizationSchema, raw);
  return prisma.$transaction(async (tx) => {
    const before = await tx.organization.findUniqueOrThrow({
      where: { id: ctx.organization.id },
      select: { name: true, timezone: true, ticketPrefix: true, ticketNumberPadding: true },
    });
    const after = await tx.organization.update({
      where: { id: ctx.organization.id },
      data: input,
      select: { name: true, timezone: true, ticketPrefix: true, ticketNumberPadding: true },
    });
    // A new prefix starts its own sequence; existing keys are untouched, and
    // keys stay unique because the prefix is part of the key.
    await tx.ticketSequence.upsert({
      where: { organizationId_prefix: { organizationId: ctx.organization.id, prefix: after.ticketPrefix } },
      create: { organizationId: ctx.organization.id, prefix: after.ticketPrefix, nextValue: 1 },
      update: {},
    });
    const changes = Object.fromEntries(
      (Object.keys(after) as (keyof typeof after)[])
        .filter((k) => before[k] !== after[k])
        .map((k) => [k, { from: before[k], to: after[k] }]),
    );
    await recordAudit(tx, ctx, {
      action: "organization.updated",
      entityType: "organization",
      entityId: ctx.organization.id,
      metadata: { changes },
    });
    return after;
  });
}

export async function getOrganizationOverview(ctx: OrgContext) {
  requirePermission(ctx, "organization.read");
  const db = scopedDb(ctx.organization.id);
  const openFilter: Prisma.TicketWhereInput = {
    deletedAt: null,
    status: { category: { notIn: ["RESOLVED", "CLOSED"] } },
  };
  const [memberCount, teamCount, openTickets, pendingInvites] = await Promise.all([
    db.organizationMembership.count({ where: { status: "ACTIVE" } }),
    db.team.count({ where: { deletedAt: null } }),
    // Requesters only ever count their own tickets.
    db.ticket.count({
      where: ctx.permissions.has("tickets.read") ? openFilter : { ...openFilter, requesterId: ctx.user.id },
    }),
    ctx.permissions.has("members.invite")
      ? db.invitation.count({ where: { status: "PENDING", expiresAt: { gt: new Date() } } })
      : Promise.resolve(0),
  ]);
  return { memberCount, teamCount, openTickets, pendingInvites };
}
