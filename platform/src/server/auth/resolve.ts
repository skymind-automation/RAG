import { prisma } from "@/lib/db/client";
import { AuthenticationError, AuthorizationError, TenantAccessError } from "@/lib/errors";
import { permissionsFor, type Permission } from "@/lib/permissions";
import type { AuthContext, AuthUser, OrgContext, RequestMeta } from "@/server/context";

/**
 * Framework-independent context resolution. These functions take plain
 * values (no Next.js request APIs) so the exact logic that guards production
 * is what the integration tests exercise.
 */

export interface SessionClaims {
  userId: string | undefined | null;
  sessionVersion: number | undefined | null;
}

/**
 * Turn session claims into a live user, or fail. Deactivated, deleted and
 * version-bumped users are rejected even though their JWT is still validly
 * signed — this is what makes "sign out everywhere" and "deactivate user"
 * take effect immediately.
 */
export async function resolveSessionUser(claims: SessionClaims): Promise<AuthUser> {
  if (!claims.userId) throw new AuthenticationError();
  const user = await prisma.user.findUnique({
    where: { id: claims.userId },
    select: { id: true, email: true, name: true, isActive: true, deletedAt: true, sessionVersion: true },
  });
  if (!user || !user.isActive || user.deletedAt || user.sessionVersion !== claims.sessionVersion) {
    throw new AuthenticationError("Your session has ended. Please sign in again.");
  }
  return { id: user.id, email: user.email, name: user.name };
}

/**
 * Establish organization context: the organization exists, is not deleted,
 * and the user holds an ACTIVE membership in it. Anything else is a
 * TenantAccessError (rendered as 404 — outsiders learn nothing).
 *
 * The slug comes from the URL and is therefore untrusted; it only selects
 * which membership to *look for*. Authority comes from the membership row.
 */
export async function resolveOrgContext(auth: AuthContext, organizationSlug: string): Promise<OrgContext> {
  if (!organizationSlug || typeof organizationSlug !== "string") throw new TenantAccessError();
  const membership = await prisma.organizationMembership.findFirst({
    where: {
      userId: auth.user.id,
      status: "ACTIVE",
      organization: { slug: organizationSlug.toLowerCase(), deletedAt: null },
    },
    select: {
      id: true,
      role: true,
      organization: {
        select: { id: true, slug: true, name: true, timezone: true, ticketPrefix: true, ticketNumberPadding: true },
      },
    },
  });
  if (!membership) {
    throw new TenantAccessError("Organization not found.", { slug: organizationSlug, userId: auth.user.id });
  }
  return {
    ...auth,
    organization: membership.organization,
    membership: { id: membership.id, role: membership.role },
    role: membership.role,
    permissions: permissionsFor(membership.role),
  };
}

export function can(ctx: Pick<OrgContext, "permissions">, permission: Permission): boolean {
  return ctx.permissions.has(permission);
}

export function requirePermission(ctx: OrgContext, permission: Permission): void {
  if (!can(ctx, permission)) {
    throw new AuthorizationError(undefined, {
      permission,
      role: ctx.role,
      organizationId: ctx.organization.id,
      userId: ctx.user.id,
    });
  }
}

export function requireAnyPermission(ctx: OrgContext, permissions: Permission[]): void {
  if (!permissions.some((p) => can(ctx, p))) {
    throw new AuthorizationError(undefined, { permissions, role: ctx.role });
  }
}

export function makeAuthContext(user: AuthUser, request: RequestMeta): AuthContext {
  return { user, request };
}
