import type { OrgRole, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { scopedDb } from "@/lib/db/tenant";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { canGrantRole, canManageMember } from "@/lib/permissions";
import { RATE_LIMITS, enforceRateLimit } from "@/lib/security/rate-limit";
import { generateToken, hashToken } from "@/lib/security/tokens";
import { parseInput } from "@/lib/validation/parse";
import { changeRoleSchema, inviteMemberSchema, membershipIdSchema } from "@/lib/validation/schemas";
import { recordAudit } from "@/server/audit/audit-service";
import { requirePermission } from "@/server/auth/resolve";
import type { AuthContext, OrgContext } from "@/server/context";

/**
 * MembershipService — who belongs to an organization and in what role.
 *
 * Invariants enforced here (and tested in tests/integration/memberships):
 *   * Nobody grants a role at or above their own, except owners.
 *   * Nobody changes or removes a member at or above their own role, except owners.
 *   * An organization always keeps at least one active OWNER. Owner rows are
 *     locked FOR UPDATE while checking, so two owners demoting each other
 *     concurrently cannot both succeed.
 *   * Removal is a status change (REMOVED), effective on the member's very
 *     next request because every request re-reads membership status.
 */

export const INVITATION_TTL_DAYS = 7;

export interface MemberRow {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: OrgRole;
  joinedAt: Date;
  teams: { id: string; name: string }[];
}

export async function listMembers(ctx: OrgContext): Promise<MemberRow[]> {
  requirePermission(ctx, "members.read");
  const rows = await scopedDb(ctx.organization.id).organizationMembership.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      role: true,
      createdAt: true,
      user: { select: { id: true, name: true, email: true } },
      teams: { select: { team: { select: { id: true, name: true } } } },
    },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
  });
  return rows.map((r) => ({
    membershipId: r.id,
    userId: r.user.id,
    name: r.user.name,
    email: r.user.email,
    role: r.role,
    joinedAt: r.createdAt,
    teams: r.teams.map((t) => t.team),
  }));
}

export async function listPendingInvitations(ctx: OrgContext) {
  requirePermission(ctx, "members.invite");
  return scopedDb(ctx.organization.id).invitation.findMany({
    where: { status: "PENDING", expiresAt: { gt: new Date() } },
    select: {
      id: true,
      email: true,
      role: true,
      expiresAt: true,
      createdAt: true,
      invitedBy: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export interface InvitationResult {
  invitationId: string;
  /** Raw token — returned once to build the invite link; only its hash is stored. */
  token: string;
  expiresAt: Date;
}

export async function inviteMember(ctx: OrgContext, raw: unknown): Promise<InvitationResult> {
  requirePermission(ctx, "members.invite");
  const input = parseInput(inviteMemberSchema, raw);
  if (!canGrantRole(ctx.role, input.role)) {
    throw new AuthorizationError("You can't invite someone with that role.", {
      actorRole: ctx.role,
      target: input.role,
    });
  }
  await enforceRateLimit(RATE_LIMITS.inviteByOrg, ctx.organization.id);

  const db = scopedDb(ctx.organization.id);
  const existing = await db.organizationMembership.findFirst({
    where: { status: "ACTIVE", user: { email: input.email } },
    select: { id: true },
  });
  if (existing) {
    throw new ValidationError("Some fields are invalid.", { email: ["This person is already a member."] });
  }

  const token = generateToken();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);

  const invitation = await db.$transaction(async (tx) => {
    // One live invitation per email: re-inviting supersedes the old link.
    await tx.invitation.updateMany({
      where: { email: input.email, status: "PENDING" },
      data: { status: "REVOKED" },
    });
    const inv = await tx.invitation.create({
      data: {
        organizationId: ctx.organization.id,
        email: input.email,
        role: input.role,
        tokenHash: hashToken(token),
        invitedById: ctx.user.id,
        expiresAt,
      },
      select: { id: true },
    });
    await recordAudit(tx, ctx, {
      action: "membership.invited",
      entityType: "invitation",
      entityId: inv.id,
      metadata: { email: input.email, role: input.role },
    });
    return inv;
  });

  return { invitationId: invitation.id, token, expiresAt };
}

export async function revokeInvitation(ctx: OrgContext, invitationId: string): Promise<void> {
  requirePermission(ctx, "members.invite");
  const db = scopedDb(ctx.organization.id);
  await db.$transaction(async (tx) => {
    const { count } = await tx.invitation.updateMany({
      where: { id: invitationId, status: "PENDING" },
      data: { status: "REVOKED" },
    });
    if (count === 0) throw new NotFoundError("Invitation not found.");
    await recordAudit(tx, ctx, {
      action: "membership.invitation_revoked",
      entityType: "invitation",
      entityId: invitationId,
    });
  });
}

/** Public preview for the accept page — reveals only org name and role. */
export async function previewInvitation(token: string) {
  const inv = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      email: true,
      role: true,
      status: true,
      expiresAt: true,
      organization: { select: { name: true, deletedAt: true } },
    },
  });
  if (!inv || inv.status !== "PENDING" || inv.expiresAt <= new Date() || inv.organization.deletedAt) return null;
  return { organizationName: inv.organization.name, role: inv.role, email: inv.email };
}

/**
 * Accept an invitation. There is no organization context yet (the caller
 * isn't a member), so this is one of the few documented unscoped paths: the
 * token hash selects the invitation, and the organization id comes from the
 * invitation row, never from the request.
 *
 * The invitation is bound to an email address: a leaked link cannot be
 * redeemed by a different account.
 */
export async function acceptInvitation(auth: AuthContext, token: string): Promise<{ slug: string }> {
  const tokenHash = hashToken(token);
  return prisma.$transaction(async (tx) => {
    const inv = await tx.invitation.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        expiresAt: true,
        organizationId: true,
        organization: {
          select: {
            slug: true,
            name: true,
            timezone: true,
            ticketPrefix: true,
            ticketNumberPadding: true,
            deletedAt: true,
          },
        },
      },
    });
    if (!inv || inv.status !== "PENDING" || inv.expiresAt <= new Date() || inv.organization.deletedAt) {
      throw new NotFoundError("This invitation is invalid or has expired.");
    }
    if (inv.email !== auth.user.email) {
      throw new AuthorizationError("This invitation was sent to a different email address.");
    }

    const membership = await tx.organizationMembership.upsert({
      where: { organizationId_userId: { organizationId: inv.organizationId, userId: auth.user.id } },
      create: { organizationId: inv.organizationId, userId: auth.user.id, role: inv.role },
      // Re-joining after removal reactivates the historical row.
      update: { role: inv.role, status: "ACTIVE", removedAt: null },
      select: { id: true, role: true },
    });
    const claimed = await tx.invitation.updateMany({
      where: { id: inv.id, status: "PENDING" },
      data: { status: "ACCEPTED", acceptedAt: new Date() },
    });
    if (claimed.count !== 1) throw new ConflictError("This invitation was already used.");
    await tx.user.update({ where: { id: auth.user.id }, data: { lastActiveOrganizationId: inv.organizationId } });

    const ctx: OrgContext = {
      ...auth,
      organization: { id: inv.organizationId, ...inv.organization },
      membership: { id: membership.id, role: membership.role },
      role: membership.role,
      permissions: new Set(),
    };
    await recordAudit(tx, ctx, {
      action: "membership.invitation_accepted",
      entityType: "membership",
      entityId: membership.id,
      metadata: { invitationId: inv.id, role: inv.role },
    });
    return { slug: inv.organization.slug };
  });
}

/** Lock active owners and return how many there are. Must run inside a transaction. */
async function lockActiveOwners(tx: Prisma.TransactionClient, organizationId: string): Promise<number> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM organization_memberships
    WHERE "organizationId" = ${organizationId} AND role = 'OWNER' AND status = 'ACTIVE'
    FOR UPDATE`;
  return rows.length;
}

export async function changeMemberRole(ctx: OrgContext, raw: unknown): Promise<void> {
  requirePermission(ctx, "members.update");
  const input = parseInput(changeRoleSchema, raw);
  const organizationId = ctx.organization.id;

  await prisma.$transaction(async (tx) => {
    const ownerCount = await lockActiveOwners(tx, organizationId);
    // Explicit organizationId: this unscoped tx is required for FOR UPDATE.
    const target = await tx.organizationMembership.findFirst({
      where: { id: input.membershipId, organizationId, status: "ACTIVE" },
      select: { id: true, role: true, userId: true },
    });
    if (!target) throw new NotFoundError("Member not found.");
    if (target.role === input.role) return;
    if (!canManageMember(ctx.role, target.role) || !canGrantRole(ctx.role, input.role)) {
      throw new AuthorizationError("You can't change this member's role.");
    }
    if (target.role === "OWNER" && ownerCount <= 1) {
      throw new ValidationError("An organization needs at least one owner. Promote someone else first.");
    }
    await tx.organizationMembership.update({ where: { id: target.id }, data: { role: input.role } });
    await recordAudit(tx, ctx, {
      action: "membership.role_changed",
      entityType: "membership",
      entityId: target.id,
      metadata: { userId: target.userId, from: target.role, to: input.role },
    });
  });
}

/**
 * Remove a member (or leave, when the member is the caller). The row is kept
 * with status REMOVED for history and FK integrity; team memberships are
 * dropped.
 */
export async function removeMember(ctx: OrgContext, raw: unknown): Promise<void> {
  const { membershipId } = parseInput(membershipIdSchema, raw);
  const organizationId = ctx.organization.id;
  const isSelf = membershipId === ctx.membership.id;
  if (!isSelf) requirePermission(ctx, "members.remove");

  await prisma.$transaction(async (tx) => {
    const ownerCount = await lockActiveOwners(tx, organizationId);
    const target = await tx.organizationMembership.findFirst({
      where: { id: membershipId, organizationId, status: "ACTIVE" },
      select: { id: true, role: true, userId: true },
    });
    if (!target) throw new NotFoundError("Member not found.");
    if (!isSelf && !canManageMember(ctx.role, target.role)) {
      throw new AuthorizationError("You can't remove this member.");
    }
    if (target.role === "OWNER" && ownerCount <= 1) {
      throw new ValidationError("An organization needs at least one owner. Transfer ownership first.");
    }
    await tx.organizationMembership.update({
      where: { id: target.id },
      data: { status: "REMOVED", removedAt: new Date() },
    });
    await tx.teamMembership.deleteMany({ where: { organizationId, membershipId: target.id } });
    await recordAudit(tx, ctx, {
      action: isSelf ? "membership.left" : "membership.removed",
      entityType: "membership",
      entityId: target.id,
      metadata: { userId: target.userId, role: target.role },
    });
  });
}
