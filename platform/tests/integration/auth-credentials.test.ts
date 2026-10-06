import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { ValidationError } from "@/lib/errors";
import { verifyCredentials } from "@/server/auth/credentials";
import type { RequestMeta } from "@/server/context";
import {
  createOrganization,
  listMyOrganizations,
  resolveLandingOrganization,
} from "@/server/organizations/organization-service";
import { registerUser } from "@/server/users/user-service";
import { authOf, resetDb } from "./helpers";

const req = (ip = "198.51.100.1"): RequestMeta => ({ requestId: "t-req-0001", ipAddress: ip, userAgent: "vitest" });
const PASSWORD = "correct horse battery staple";

describe("registration and login", () => {
  beforeEach(resetDb);

  it("registers with a hashed password, normalised email and an audit event", async () => {
    const user = await registerUser({ name: "Ada", email: "  Ada@Example.TEST ", password: PASSWORD }, req());
    expect(user.email).toBe("ada@example.test");
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row.passwordHash).not.toContain(PASSWORD);
    expect(await prisma.auditLog.count({ where: { action: "user.registered", actorId: user.id } })).toBe(1);
  });

  it("rejects duplicate emails and weak passwords with field errors", async () => {
    await registerUser({ name: "Ada", email: "ada@example.test", password: PASSWORD }, req());
    await expect(
      registerUser({ name: "Ada 2", email: "ADA@example.test", password: PASSWORD }, req()),
    ).rejects.toMatchObject({
      fieldErrors: { email: [expect.stringMatching(/already exists/)] },
    });
    await expect(
      registerUser({ name: "Bob", email: "bob@example.test", password: "short" }, req()),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("verifies credentials and returns the same null for every failure", async () => {
    const user = await registerUser({ name: "Ada", email: "ada@example.test", password: PASSWORD }, req());
    expect(await verifyCredentials({ email: "ADA@example.test", password: PASSWORD }, req())).toMatchObject({
      id: user.id,
      sessionVersion: 1,
    });
    expect(await verifyCredentials({ email: "ada@example.test", password: "wrong password!!" }, req())).toBeNull();
    expect(await verifyCredentials({ email: "nobody@example.test", password: PASSWORD }, req())).toBeNull();
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    expect(await verifyCredentials({ email: "ada@example.test", password: PASSWORD }, req())).toBeNull();
    const failures = await prisma.auditLog.findMany({
      where: { action: "user.login_failed" },
      select: { metadata: true },
    });
    expect(failures.map((f) => (f.metadata as { reason: string }).reason).sort()).toEqual([
      "bad_password",
      "inactive",
      "unknown_email",
    ]);
  });

  it("rate limits repeated attempts against one account", async () => {
    await registerUser({ name: "Ada", email: "ada@example.test", password: PASSWORD }, req());
    for (let i = 0; i < 8; i++) {
      await verifyCredentials({ email: "ada@example.test", password: "wrong password!!" }, req(`10.0.0.${i}`));
    }
    // Even the correct password is refused while limited.
    expect(await verifyCredentials({ email: "ada@example.test", password: PASSWORD }, req("10.0.1.1"))).toBeNull();
  });

  it("lands a user in their last active organization", async () => {
    const user = await registerUser({ name: "Ada", email: "ada@example.test", password: PASSWORD }, req());
    expect(await resolveLandingOrganization(user.id)).toBeNull();
    await createOrganization(authOf(user), { name: "First", slug: "first" });
    await createOrganization(authOf(user), { name: "Second", slug: "second" });
    expect((await listMyOrganizations(user.id)).map((o) => o.slug)).toEqual(["first", "second"]);
    expect(await resolveLandingOrganization(user.id)).toBe("second");
  });

  it("rejects reserved or duplicate organization slugs", async () => {
    const user = await registerUser({ name: "Ada", email: "ada@example.test", password: PASSWORD }, req());
    await expect(createOrganization(authOf(user), { name: "API", slug: "api" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await createOrganization(authOf(user), { name: "Acme", slug: "acme" });
    await expect(createOrganization(authOf(user), { name: "Acme 2", slug: "acme" })).rejects.toMatchObject({
      fieldErrors: { slug: ["That address is already taken."] },
    });
  });
});
