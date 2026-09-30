import { prisma } from "@/lib/db/client";
import { logger } from "@/lib/observability/logger";
import { dummyHash, verifyPassword } from "@/lib/security/password";
import { RATE_LIMITS, hitRateLimit } from "@/lib/security/rate-limit";
import { loginSchema } from "@/lib/validation/schemas";
import { recordGlobalAudit } from "@/server/audit/audit-service";
import type { RequestMeta } from "@/server/context";

export interface VerifiedCredentialsUser {
  id: string;
  email: string;
  name: string;
  sessionVersion: number;
}

/**
 * Verify email + password. Returns null for *every* failure (unknown email,
 * wrong password, deactivated account, rate limited) so the response never
 * reveals which one happened. Timing is kept uniform by verifying against a
 * dummy hash when the user doesn't exist.
 */
export async function verifyCredentials(raw: unknown, request: RequestMeta): Promise<VerifiedCredentialsUser | null> {
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { email, password } = parsed.data;

  const [byIp, byEmail] = await Promise.all([
    hitRateLimit(RATE_LIMITS.loginByIp, request.ipAddress ?? "unknown"),
    hitRateLimit(RATE_LIMITS.loginByEmail, email),
  ]);
  if (!byIp.allowed || !byEmail.allowed) {
    logger.warn("login rate limited", { operation: "auth.login", result: "denied", requestId: request.requestId });
    await recordGlobalAudit(prisma, {
      actorId: null,
      action: "user.login_failed",
      entityType: "user",
      metadata: { email, reason: "rate_limited" },
      request,
    });
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      passwordHash: true,
      isActive: true,
      deletedAt: true,
      sessionVersion: true,
    },
  });

  const ok = await verifyPassword(user?.passwordHash ?? (await dummyHash()), password);
  const usable = Boolean(user && user.passwordHash && user.isActive && !user.deletedAt);

  if (!ok || !usable || !user) {
    await recordGlobalAudit(prisma, {
      actorId: user?.id ?? null,
      action: "user.login_failed",
      entityType: "user",
      entityId: user?.id ?? null,
      metadata: { email, reason: !user ? "unknown_email" : !ok ? "bad_password" : "inactive" },
      request,
    });
    return null;
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await recordGlobalAudit(tx, {
      actorId: user.id,
      action: "user.login_succeeded",
      entityType: "user",
      entityId: user.id,
      request,
    });
  });

  return { id: user.id, email: user.email, name: user.name, sessionVersion: user.sessionVersion };
}
