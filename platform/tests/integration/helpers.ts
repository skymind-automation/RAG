import type { OrgRole } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { __resetMemoryRateLimits } from "@/lib/security/rate-limit";
import { resolveOrgContext } from "@/server/auth/resolve";
import type { AuthContext, OrgContext } from "@/server/context";
import { createOrganization } from "@/server/organizations/organization-service";

let seq = 0;

export async function resetDb(): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  // TRUNCATE bypasses the audit row triggers by design (test-only reset).
  if (list) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  __resetMemoryRateLimits();
}

export function authOf(user: { id: string; email: string; name: string }): AuthContext {
  return {
    user: { id: user.id, email: user.email, name: user.name },
    request: { requestId: `test-${++seq}`, ipAddress: "203.0.113.7", userAgent: "vitest" },
  };
}

export async function makeUser(name: string, opts: { passwordHash?: string } = {}) {
  const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}.${++seq}@example.test`;
  return prisma.user.create({
    data: { email, name, passwordHash: opts.passwordHash ?? null },
    select: { id: true, email: true, name: true },
  });
}

/** Create an organization owned by a fresh user; returns the owner's context. */
export async function makeOrg(name: string, slug: string): Promise<OrgContext> {
  const owner = await makeUser(`${name} Owner`);
  const auth = authOf(owner);
  await createOrganization(auth, { name, slug });
  return resolveOrgContext(auth, slug);
}

/** Add a member with a role and return their context in that organization. */
export async function joinAs(org: OrgContext, role: OrgRole, name = role.toLowerCase()): Promise<OrgContext> {
  const user = await makeUser(`${org.organization.slug} ${name}`);
  await prisma.organizationMembership.create({
    data: { organizationId: org.organization.id, userId: user.id, role },
  });
  return resolveOrgContext(authOf(user), org.organization.slug);
}

export async function statusByKey(org: OrgContext, key: string): Promise<string> {
  const s = await prisma.workflowStatus.findFirstOrThrow({
    where: { organizationId: org.organization.id, key },
    select: { id: true },
  });
  return s.id;
}
