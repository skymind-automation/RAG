import { scopedDb } from "@/lib/db/tenant";
import { isUniqueViolation } from "@/lib/db/errors";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { parseInput } from "@/lib/validation/parse";
import { createTeamSchema, teamMemberSchema } from "@/lib/validation/schemas";
import { recordAudit } from "@/server/audit/audit-service";
import { requirePermission } from "@/server/auth/resolve";
import type { OrgContext } from "@/server/context";

/** TeamService — groups of members used for routing and boards. */

export async function listTeams(ctx: OrgContext) {
  requirePermission(ctx, "teams.read");
  const teams = await scopedDb(ctx.organization.id).team.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      name: true,
      description: true,
      members: {
        where: { membership: { status: "ACTIVE" } },
        select: { membership: { select: { id: true, role: true, user: { select: { id: true, name: true } } } } },
      },
    },
    orderBy: { name: "asc" },
  });
  return teams.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    members: t.members.map((m) => ({ membershipId: m.membership.id, role: m.membership.role, ...m.membership.user })),
  }));
}

export async function createTeam(ctx: OrgContext, raw: unknown) {
  requirePermission(ctx, "teams.manage");
  const input = parseInput(createTeamSchema, raw);
  const db = scopedDb(ctx.organization.id);
  try {
    return await db.$transaction(async (tx) => {
      const team = await tx.team.create({
        data: { organizationId: ctx.organization.id, name: input.name, description: input.description ?? null },
        select: { id: true, name: true },
      });
      await recordAudit(tx, ctx, {
        action: "team.created",
        entityType: "team",
        entityId: team.id,
        metadata: { name: team.name },
      });
      return team;
    });
  } catch (err) {
    if (isUniqueViolation(err))
      throw new ValidationError("Some fields are invalid.", { name: ["A team with this name already exists."] });
    throw err;
  }
}

export async function addTeamMember(ctx: OrgContext, raw: unknown): Promise<void> {
  requirePermission(ctx, "teams.manage");
  const input = parseInput(teamMemberSchema, raw);
  const db = scopedDb(ctx.organization.id);
  await db.$transaction(async (tx) => {
    // Both lookups are tenant-scoped: an id from another organization is simply "not found".
    const [team, membership] = await Promise.all([
      tx.team.findFirst({ where: { id: input.teamId, deletedAt: null }, select: { id: true } }),
      tx.organizationMembership.findFirst({
        where: { id: input.membershipId, status: "ACTIVE" },
        select: { id: true },
      }),
    ]);
    if (!team || !membership) throw new NotFoundError("Team or member not found.");
    await tx.teamMembership.upsert({
      where: { teamId_membershipId: { teamId: team.id, membershipId: membership.id } },
      create: { organizationId: ctx.organization.id, teamId: team.id, membershipId: membership.id },
      update: {},
    });
    await recordAudit(tx, ctx, {
      action: "team.member_added",
      entityType: "team",
      entityId: team.id,
      metadata: { membershipId: membership.id },
    });
  });
}

export async function removeTeamMember(ctx: OrgContext, raw: unknown): Promise<void> {
  requirePermission(ctx, "teams.manage");
  const input = parseInput(teamMemberSchema, raw);
  const db = scopedDb(ctx.organization.id);
  await db.$transaction(async (tx) => {
    const { count } = await tx.teamMembership.deleteMany({
      where: { teamId: input.teamId, membershipId: input.membershipId },
    });
    if (count === 0) throw new NotFoundError("Team member not found.");
    await recordAudit(tx, ctx, {
      action: "team.member_removed",
      entityType: "team",
      entityId: input.teamId,
      metadata: { membershipId: input.membershipId },
    });
  });
}
