import "server-only";
import { unstable_rethrow } from "next/navigation";
import { prisma } from "@/lib/db/client";
import { AuthorizationError, isAppError, toPublicError, type PublicError } from "@/lib/errors";
import { logger } from "@/lib/observability/logger";
import { recordAudit } from "@/server/audit/audit-service";
import { requireAuth, requireOrganization } from "@/server/auth/context";
import type { AuthContext, OrgContext } from "@/server/context";

/**
 * Uniform execution for server actions and route handlers:
 *   * establishes identity / organization context (never from client input),
 *   * converts every failure into a PublicError (no stack traces, no SQL),
 *   * logs one structured line per operation with latency and outcome,
 *   * audits authorization denials.
 *
 * Actions return `ActionResult` rather than throwing, so the client can show
 * field errors without error boundaries.
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: PublicError };

async function execute<T>(
  operation: string,
  fields: { requestId?: string; organizationId?: string; userId?: string },
  fn: () => Promise<T>,
  onDenied?: (err: AuthorizationError) => Promise<void>,
): Promise<ActionResult<T>> {
  const started = performance.now();
  try {
    const data = await fn();
    logger.info("action", { ...fields, operation, result: "ok", latencyMs: Math.round(performance.now() - started) });
    return { ok: true, data };
  } catch (err) {
    unstable_rethrow(err); // let Next.js redirect()/notFound() through
    const latencyMs = Math.round(performance.now() - started);
    if (isAppError(err)) {
      const denied =
        err.code === "FORBIDDEN" || err.code === "TENANT_ACCESS_DENIED" || err.code === "AUTHENTICATION_REQUIRED";
      logger.warn("action failed", {
        ...fields,
        operation,
        latencyMs,
        result: denied ? "denied" : "error",
        errorCategory: err.code,
        details: err.details,
      });
      if (err instanceof AuthorizationError && onDenied) await onDenied(err).catch(() => undefined);
    } else {
      logger.error("action crashed", {
        ...fields,
        operation,
        latencyMs,
        result: "error",
        errorCategory: "INTERNAL_ERROR",
        error: err,
      });
    }
    return { ok: false, error: toPublicError(err) };
  }
}

/** For actions that need a signed-in user but no organization (e.g. creating one). */
export async function runAuthed<T>(operation: string, fn: (auth: AuthContext) => Promise<T>): Promise<ActionResult<T>> {
  const fields: { requestId?: string; userId?: string } = {};
  return execute(operation, fields, async () => {
    const auth = await requireAuth();
    Object.assign(fields, { requestId: auth.request.requestId, userId: auth.user.id });
    return fn(auth);
  });
}

/** For actions inside an organization. `organizationSlug` only selects; membership authorizes. */
export async function runInOrg<T>(
  organizationSlug: string,
  operation: string,
  fn: (ctx: OrgContext) => Promise<T>,
): Promise<ActionResult<T>> {
  let ctxRef: OrgContext | null = null;
  const fields: { requestId?: string; organizationId?: string; userId?: string } = {};
  return execute(
    operation,
    fields,
    async () => {
      const ctx = await requireOrganization(organizationSlug);
      ctxRef = ctx;
      Object.assign(fields, {
        requestId: ctx.request.requestId,
        organizationId: ctx.organization.id,
        userId: ctx.user.id,
      });
      return fn(ctx);
    },
    async (err) => {
      if (!ctxRef) return;
      await recordAudit(prisma, ctxRef, {
        action: "authorization.denied",
        entityType: "operation",
        entityId: operation,
        metadata: { permission: err.details?.permission ?? null },
      });
    },
  );
}
