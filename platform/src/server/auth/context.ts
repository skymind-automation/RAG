import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AuthenticationError, TenantAccessError } from "@/lib/errors";
import type { AuthContext, OrgContext } from "@/server/context";
import { auth } from "./index";
import { requestMetaFromHeaders } from "./request-meta";
import { makeAuthContext, resolveOrgContext, resolveSessionUser } from "./resolve";

/**
 * The single entry point for establishing identity and tenancy in Next.js
 * code (pages, layouts, server actions, route handlers). Do not re-implement
 * these checks per endpoint.
 *
 *   requireAuth()                → AuthContext   (throws AuthenticationError)
 *   requireOrganization(slug)    → OrgContext    (throws TenantAccessError)
 *   requirePermission(ctx, perm) → void          (throws AuthorizationError)
 *
 * `requireMembership` is an alias of `requireOrganization`: establishing an
 * organization context *is* verifying an active membership.
 *
 * Results are memoised per request with React `cache`, so a layout and the
 * page beneath it share one database round trip.
 */

export const requireAuth = cache(async (): Promise<AuthContext> => {
  const session = await auth();
  const request = requestMetaFromHeaders(await headers());
  const user = await resolveSessionUser({
    userId: session?.user?.id,
    sessionVersion: session?.sessionVersion,
  });
  return makeAuthContext(user, request);
});

export const requireOrganization = cache(async (organizationSlug: string): Promise<OrgContext> => {
  const authCtx = await requireAuth();
  return resolveOrgContext(authCtx, organizationSlug);
});

export const requireMembership = requireOrganization;

export { requirePermission, can } from "./resolve";

/** For pages: redirect anonymous users to /login instead of throwing. */
export async function requireAuthPage(): Promise<AuthContext> {
  try {
    return await requireAuth();
  } catch (err) {
    if (err instanceof AuthenticationError) redirect("/login");
    throw err;
  }
}

/** For pages: anonymous → /login, non-member → 404. */
export async function requireOrganizationPage(organizationSlug: string): Promise<OrgContext> {
  try {
    return await requireOrganization(organizationSlug);
  } catch (err) {
    if (err instanceof AuthenticationError) redirect("/login");
    if (err instanceof TenantAccessError) notFound();
    throw err;
  }
}
