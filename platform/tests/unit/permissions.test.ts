import { describe, expect, it } from "vitest";
import {
  PERMISSIONS,
  ROLES,
  ROLE_PERMISSIONS,
  canGrantRole,
  canManageMember,
  roleHas,
  type Role,
} from "@/lib/permissions";

describe("role → permission map", () => {
  it("owner has every permission; admin has all but organization.delete", () => {
    for (const p of PERMISSIONS) expect(roleHas("OWNER", p)).toBe(true);
    expect(roleHas("ADMIN", "organization.delete")).toBe(false);
    expect(ROLE_PERMISSIONS.ADMIN.size).toBe(PERMISSIONS.length - 1);
  });

  it("requesters can only read their own tickets and never internal notes", () => {
    expect(roleHas("REQUESTER", "tickets.read")).toBe(false);
    expect(roleHas("REQUESTER", "tickets.read_own")).toBe(true);
    expect(roleHas("REQUESTER", "tickets.read_internal")).toBe(false);
    expect(roleHas("REQUESTER", "ai.view_audit")).toBe(false);
    expect(roleHas("REQUESTER", "reports.read")).toBe(false);
  });

  it("viewers are read-only", () => {
    const writes = PERMISSIONS.filter((p) => !/\.(read|read_own)$/.test(p));
    for (const p of writes) expect(roleHas("VIEWER", p), p).toBe(false);
  });

  it("every role maps only to known permissions", () => {
    for (const r of ROLES) for (const p of ROLE_PERMISSIONS[r]) expect(PERMISSIONS).toContain(p);
  });
});

describe("role grant rules", () => {
  const matrix: [Role, Role, boolean][] = [
    ["OWNER", "OWNER", true],
    ["ADMIN", "OWNER", false],
    ["ADMIN", "ADMIN", false],
    ["ADMIN", "MANAGER", true],
    ["MANAGER", "MANAGER", false],
    ["MANAGER", "AGENT", true],
    ["AGENT", "REQUESTER", true],
    ["VIEWER", "REQUESTER", true],
    ["REQUESTER", "VIEWER", false],
  ];
  it.each(matrix)("%s granting %s → %s", (actor, target, expected) => {
    expect(canGrantRole(actor, target)).toBe(expected);
    expect(canManageMember(actor, target)).toBe(expected);
  });
});
