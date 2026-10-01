import type { Prisma, StatusCategory } from "@prisma/client";

/**
 * Configuration every new organization starts with. Organizations can
 * change all of it later; nothing in the product depends on these literal
 * values — only on the status *categories* and priority *levels*.
 */

export const DEFAULT_WORKFLOW_NAME = "Standard";

export const DEFAULT_STATUSES: ReadonlyArray<{
  key: string;
  name: string;
  category: StatusCategory;
  isInitial?: boolean;
}> = [
  { key: "new", name: "New", category: "NEW", isInitial: true },
  { key: "open", name: "Open", category: "OPEN" },
  { key: "in_progress", name: "In Progress", category: "IN_PROGRESS" },
  { key: "pending", name: "Pending", category: "PENDING" },
  { key: "resolved", name: "Resolved", category: "RESOLVED" },
  { key: "closed", name: "Closed", category: "CLOSED" },
];

/** [from, to, requiresResolution] */
export const DEFAULT_TRANSITIONS: ReadonlyArray<readonly [string, string, boolean]> = [
  ["new", "open", false],
  ["new", "in_progress", false],
  ["new", "closed", false],
  ["open", "in_progress", false],
  ["open", "pending", false],
  ["open", "resolved", true],
  ["in_progress", "pending", false],
  ["in_progress", "open", false],
  ["in_progress", "resolved", true],
  ["pending", "in_progress", false],
  ["pending", "open", false],
  ["pending", "resolved", true],
  ["resolved", "closed", false],
  ["resolved", "open", false],
  ["closed", "open", false],
];

export const DEFAULT_PRIORITIES = [
  { key: "critical", name: "Critical", level: 1, color: "#dc2626" },
  { key: "high", name: "High", level: 2, color: "#ea580c" },
  { key: "medium", name: "Medium", level: 3, color: "#ca8a04", isDefault: true },
  { key: "low", name: "Low", level: 4, color: "#64748b" },
] as const;

export const DEFAULT_CATEGORIES = ["Hardware", "Software", "Network", "Access & Accounts", "Other"] as const;

/**
 * Provision defaults inside the organization-creating transaction. Takes the
 * raw transaction client because the organization id is being minted here;
 * every row is explicitly stamped with that id.
 */
export async function provisionOrganizationDefaults(
  tx: Prisma.TransactionClient,
  organizationId: string,
  ticketPrefix: string,
): Promise<void> {
  const workflow = await tx.workflow.create({
    data: { organizationId, name: DEFAULT_WORKFLOW_NAME, isDefault: true },
  });

  const statusIdByKey = new Map<string, string>();
  for (const [position, s] of DEFAULT_STATUSES.entries()) {
    const status = await tx.workflowStatus.create({
      data: {
        organizationId,
        workflowId: workflow.id,
        key: s.key,
        name: s.name,
        category: s.category,
        position,
        isInitial: s.isInitial ?? false,
      },
    });
    statusIdByKey.set(s.key, status.id);
  }

  await tx.workflowTransition.createMany({
    data: DEFAULT_TRANSITIONS.map(([from, to, requiresResolution]) => ({
      organizationId,
      workflowId: workflow.id,
      fromStatusId: statusIdByKey.get(from)!,
      toStatusId: statusIdByKey.get(to)!,
      requiresResolution,
    })),
  });

  await tx.ticketPriority.createMany({
    data: DEFAULT_PRIORITIES.map((p) => ({ organizationId, ...p, isDefault: "isDefault" in p && p.isDefault })),
  });

  await tx.ticketCategory.createMany({
    data: DEFAULT_CATEGORIES.map((name) => ({ organizationId, name })),
  });

  await tx.ticketSequence.create({ data: { organizationId, prefix: ticketPrefix, nextValue: 1 } });
}
