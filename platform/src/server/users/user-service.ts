import { prisma } from "@/lib/db/client";
import { isUniqueViolation } from "@/lib/db/errors";
import { ValidationError } from "@/lib/errors";
import { hashPassword } from "@/lib/security/password";
import { RATE_LIMITS, enforceRateLimit } from "@/lib/security/rate-limit";
import { parseInput } from "@/lib/validation/parse";
import { registerSchema } from "@/lib/validation/schemas";
import { recordGlobalAudit } from "@/server/audit/audit-service";
import type { AuthUser, RequestMeta } from "@/server/context";

/**
 * UserService — global identity (users are not tenant-owned; memberships
 * are). Uses the unscoped client by design.
 */

export async function registerUser(raw: unknown, request: RequestMeta): Promise<AuthUser> {
  await enforceRateLimit(RATE_LIMITS.registerByIp, request.ipAddress ?? "unknown");
  const input = parseInput(registerSchema, raw);
  const passwordHash = await hashPassword(input.password);

  try {
    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email: input.email, name: input.name, passwordHash },
        select: { id: true, email: true, name: true },
      });
      await recordGlobalAudit(tx, {
        actorId: user.id,
        action: "user.registered",
        entityType: "user",
        entityId: user.id,
        request,
      });
      return user;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      // Registration necessarily reveals that an email is taken; rate
      // limiting above bounds enumeration through this path.
      throw new ValidationError("Some fields are invalid.", {
        email: ["An account with this email already exists. Try signing in."],
      });
    }
    throw err;
  }
}

/** Invalidate every session for a user (password change, compromise, deactivation). */
export async function revokeAllSessions(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } });
}
