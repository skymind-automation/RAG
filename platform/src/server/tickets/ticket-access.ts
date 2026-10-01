import type { OrgRole, Prisma } from "@prisma/client";
import type { ScopedTx } from "@/lib/db/tenant";
import { AuthorizationError, ValidationError } from "@/lib/errors";
import { roleHas } from "@/lib/permissions";
import { can } from "@/server/auth/resolve";
import type { OrgContext } from "@/server/context";

/**
 * Row-level ticket access shared by every ticket module.
 *
 *   tickets.read      → every ticket in the organization
 *   tickets.read_own  → only tickets where the caller is the requester
 *
 * Unreadable tickets are reported as NotFound by callers, never Forbidden.
 */
export function readScope(ctx: OrgContext): Prisma.TicketWhereInput {
  if (can(ctx, "tickets.read")) return { deletedAt: null };
  if (can(ctx, "tickets.read_own")) return { deletedAt: null, requesterId: ctx.user.id };
  throw new AuthorizationError();
}

export function canSeeInternal(ctx: OrgContext): boolean {
  return can(ctx, "tickets.read_internal");
}

/** Can a member with `role` read a specific ticket requested by `requesterId`? */
export function memberCanReadTicket(role: OrgRole, userId: string, requesterId: string): boolean {
  return roleHas(role, "tickets.read") || (roleHas(role, "tickets.read_own") && userId === requesterId);
}

/** An assignee must be an active member whose role can work tickets. */
export async function assertAssignable(tx: ScopedTx, userId: string): Promise<void> {
  const m = await tx.organizationMembership.findFirst({ where: { userId, status: "ACTIVE" }, select: { role: true } });
  if (!m || !roleHas(m.role, "tickets.update")) {
    throw new ValidationError("Some fields are invalid.", { assigneeId: ["This person can't be assigned tickets."] });
  }
}
