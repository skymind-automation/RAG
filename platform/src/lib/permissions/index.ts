/**
 * Permissions are the unit of authorization; roles are only named bundles of
 * permissions. Code checks `can(ctx, "tickets.assign")`, never
 * `role === "ADMIN"`, so adding a role (or, later, per-organization custom
 * roles stored in the database — see ADR-0005) never touches call sites.
 *
 * This module is pure and shared by server and client. The client may use it
 * to *hide* controls; only the server's checks *grant* anything.
 */

export const ROLES = ["OWNER", "ADMIN", "MANAGER", "AGENT", "REQUESTER", "VIEWER"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "organization.read",
  "organization.update",
  "organization.delete",

  "members.read",
  "members.invite",
  "members.update",
  "members.remove",

  "teams.read",
  "teams.manage",

  "tickets.create",
  /** Read every ticket in the organization. */
  "tickets.read",
  /** Read only tickets the caller requested (self-service portal). */
  "tickets.read_own",
  "tickets.update",
  "tickets.delete",
  "tickets.assign",
  "tickets.transition",
  "tickets.comment",
  "tickets.comment_internal",
  "tickets.read_internal",

  /** Categories, priorities, custom fields, numbering. */
  "tickets.configure",
  "workflows.manage",
  "reports.read",
  "sla.manage",
  "automation.manage",

  "knowledge.read",
  "knowledge.write",
  "knowledge.publish",

  "ai.use",
  "ai.configure",
  "ai.view_audit",

  "audit.read",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL = new Set<Permission>(PERMISSIONS);

const AGENT_PERMISSIONS: Permission[] = [
  "organization.read",
  "members.read",
  "teams.read",
  "tickets.create",
  "tickets.read",
  "tickets.update",
  "tickets.assign",
  "tickets.transition",
  "tickets.comment",
  "tickets.comment_internal",
  "tickets.read_internal",
  "knowledge.read",
  "knowledge.write",
  "ai.use",
];

export const ROLE_PERMISSIONS: Readonly<Record<Role, ReadonlySet<Permission>>> = {
  OWNER: ALL,
  ADMIN: new Set([...ALL].filter((p) => p !== "organization.delete")),
  MANAGER: new Set<Permission>([
    ...AGENT_PERMISSIONS,
    "members.invite",
    "teams.manage",
    "tickets.delete",
    "reports.read",
    "knowledge.publish",
    "ai.view_audit",
  ]),
  AGENT: new Set(AGENT_PERMISSIONS),
  REQUESTER: new Set<Permission>([
    "organization.read",
    "tickets.create",
    "tickets.read_own",
    "tickets.comment",
    "knowledge.read",
  ]),
  // Read-only internal stakeholder (auditor, leadership). Deliberately no
  // internal notes and no AI: least privilege until an org opts in.
  VIEWER: new Set<Permission>([
    "organization.read",
    "members.read",
    "teams.read",
    "tickets.read",
    "reports.read",
    "knowledge.read",
  ]),
};

export function permissionsFor(role: Role): ReadonlySet<Permission> {
  return ROLE_PERMISSIONS[role];
}

export function roleHas(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

/** Higher rank = more authority. Used for "who may manage whom". */
export const ROLE_RANK: Readonly<Record<Role, number>> = {
  OWNER: 100,
  ADMIN: 80,
  MANAGER: 60,
  AGENT: 40,
  VIEWER: 20,
  REQUESTER: 10,
};

/**
 * May `actor` grant `target` role (via invite or role change)?
 * Owners may grant anything, including OWNER. Everyone else may only grant
 * roles strictly below their own — no one can mint a peer or a superior.
 */
export function canGrantRole(actor: Role, target: Role): boolean {
  if (actor === "OWNER") return true;
  return ROLE_RANK[target] < ROLE_RANK[actor];
}

/**
 * May `actor` change or remove a member who currently holds `subject`?
 * Same rule: only owners act on peers; others act strictly downward.
 */
export function canManageMember(actor: Role, subject: Role): boolean {
  if (actor === "OWNER") return true;
  return ROLE_RANK[subject] < ROLE_RANK[actor];
}

export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MANAGER: "Manager",
  AGENT: "Agent",
  REQUESTER: "Requester",
  VIEWER: "Viewer",
};

export const ROLE_DESCRIPTIONS: Readonly<Record<Role, string>> = {
  OWNER: "Full control, including ownership and deleting the organization.",
  ADMIN: "Manages members, configuration, workflows, SLAs and AI settings.",
  MANAGER: "Leads teams: all agent work plus inviting, reporting and publishing.",
  AGENT: "Works tickets: triage, assignment, replies and internal notes.",
  REQUESTER: "Submits and follows their own requests through the portal.",
  VIEWER: "Read-only access to tickets and reports. No internal notes.",
};
