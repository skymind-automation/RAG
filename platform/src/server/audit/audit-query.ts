import { scopedDb } from "@/lib/db/tenant";
import { requirePermission } from "@/server/auth/resolve";
import type { OrgContext } from "@/server/context";

/** Read the organization's audit trail (cursor-paginated, newest first). */
export async function listAuditLogs(ctx: OrgContext, opts: { cursor?: string; limit?: number } = {}) {
  requirePermission(ctx, "audit.read");
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const rows = await scopedDb(ctx.organization.id).auditLog.findMany({
    select: {
      id: true,
      action: true,
      entityType: true,
      entityId: true,
      metadata: true,
      actorType: true,
      ipAddress: true,
      createdAt: true,
      actor: { select: { id: true, name: true, email: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
}
