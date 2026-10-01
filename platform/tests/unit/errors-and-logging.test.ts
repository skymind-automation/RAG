import { describe, expect, it } from "vitest";
import {
  AuthorizationError,
  InternalError,
  RateLimitError,
  TenantAccessError,
  ValidationError,
  toPublicError,
} from "@/lib/errors";
import { REDACTED, redact } from "@/lib/observability/logger";
import { sanitizeAuditMetadata } from "@/server/audit/audit-service";

describe("toPublicError", () => {
  it("never leaks internal errors", () => {
    const leaked = toPublicError(
      new Error('duplicate key value violates unique constraint "users_email_key" at /srv/app.js:12'),
    );
    expect(leaked).toEqual({ code: "INTERNAL_ERROR", message: new InternalError().publicMessage });
  });

  it("keeps internal details of AppErrors out of the public shape", () => {
    const e = new AuthorizationError(undefined, { permission: "members.remove", organizationId: "org_secret" });
    expect(JSON.stringify(toPublicError(e))).not.toContain("org_secret");
    expect(toPublicError(new TenantAccessError())).toEqual({
      code: "TENANT_ACCESS_DENIED",
      message: "Organization not found.",
    });
  });

  it("includes field errors and retry hints", () => {
    expect(toPublicError(new ValidationError("bad", { email: ["nope"] }))).toMatchObject({
      fieldErrors: { email: ["nope"] },
    });
    expect(toPublicError(new RateLimitError(30))).toMatchObject({ code: "RATE_LIMITED", retryAfterSeconds: 30 });
  });
});

describe("redaction", () => {
  it("redacts sensitive keys at any depth", () => {
    const out = redact({
      user: "a",
      password: "p",
      nested: { apiKey: "k", sessionToken: "t", list: [{ secret: "s" }] },
    });
    expect(out).toEqual({
      user: "a",
      password: REDACTED,
      nested: { apiKey: REDACTED, sessionToken: REDACTED, list: [{ secret: REDACTED }] },
    });
  });

  it("audit metadata is redacted, truncated and size-capped", () => {
    expect(sanitizeAuditMetadata({ authorization: "Bearer x", note: "y".repeat(5000) })).toMatchObject({
      authorization: REDACTED,
    });
    expect(
      String((sanitizeAuditMetadata({ note: "y".repeat(5000) }) as { note: string }).note).length,
    ).toBeLessThanOrEqual(1001);
    const huge = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, "v".repeat(900)]));
    expect(sanitizeAuditMetadata(huge)).toMatchObject({ truncated: true });
  });
});
