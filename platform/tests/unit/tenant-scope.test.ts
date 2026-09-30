import { describe, expect, it } from "vitest";
import { scopeArgs } from "@/lib/db/tenant";
import { TenantAccessError } from "@/lib/errors";

const ORG = "org_a";

describe("scopeArgs", () => {
  it("adds organizationId to reads, counts and bulk writes", () => {
    for (const op of [
      "findMany",
      "findFirst",
      "findUnique",
      "count",
      "updateMany",
      "deleteMany",
      "aggregate",
      "groupBy",
    ]) {
      expect(scopeArgs("Ticket", op, { where: { id: "t1" } }, ORG).where).toEqual({ id: "t1", organizationId: ORG });
    }
    expect(scopeArgs("Ticket", "findMany", undefined, ORG).where).toEqual({ organizationId: ORG });
  });

  it("stamps creates and rejects foreign organization ids", () => {
    expect(scopeArgs("Team", "create", { data: { name: "x" } }, ORG).data).toEqual({ name: "x", organizationId: ORG });
    expect(
      scopeArgs("Team", "createMany", { data: [{ name: "x" }, { name: "y", organizationId: ORG }] }, ORG).data,
    ).toEqual([
      { name: "x", organizationId: ORG },
      { name: "y", organizationId: ORG },
    ]);
    expect(() => scopeArgs("Team", "create", { data: { name: "x", organizationId: "org_b" } }, ORG)).toThrow(
      TenantAccessError,
    );
    expect(() =>
      scopeArgs("Team", "create", { data: { name: "x", organization: { connect: { id: "org_b" } } } }, ORG),
    ).toThrow(TenantAccessError);
  });

  it("rejects moving rows between tenants and explicit foreign filters", () => {
    expect(() => scopeArgs("Ticket", "update", { where: { id: "t" }, data: { organizationId: "org_b" } }, ORG)).toThrow(
      TenantAccessError,
    );
    expect(() => scopeArgs("Ticket", "findMany", { where: { organizationId: "org_b" } }, ORG)).toThrow(
      TenantAccessError,
    );
    expect(() =>
      scopeArgs("Ticket", "upsert", { where: { id: "t" }, create: { organizationId: "org_b" }, update: {} }, ORG),
    ).toThrow(TenantAccessError);
  });

  it("refuses unknown operations instead of passing them through", () => {
    expect(() => scopeArgs("Ticket", "someFutureOp", {}, ORG)).toThrow(TenantAccessError);
  });
});
