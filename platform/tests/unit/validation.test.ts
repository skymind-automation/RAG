import { describe, expect, it } from "vitest";
import { createOrganizationSchema, createTicketSchema, registerSchema } from "@/lib/validation/schemas";
import { formatTicketKey } from "@/server/tickets/ticket-numbering";

describe("schemas", () => {
  it("normalises email and enforces password length", () => {
    expect(registerSchema.parse({ name: "A", email: " A@B.CO ", password: "x".repeat(12) }).email).toBe("a@b.co");
    expect(registerSchema.safeParse({ name: "A", email: "a@b.co", password: "short" }).success).toBe(false);
  });

  it("validates organization slugs and time zones", () => {
    expect(createOrganizationSchema.safeParse({ name: "Acme", slug: "acme-it" }).success).toBe(true);
    for (const slug of ["api", "-acme", "acme-", "Acme IT", "a", "o"]) {
      expect(createOrganizationSchema.safeParse({ name: "Acme", slug }).success, slug).toBe(false);
    }
    expect(createOrganizationSchema.safeParse({ name: "Acme", slug: "acme", timezone: "Mars/Olympus" }).success).toBe(
      false,
    );
  });

  it("never accepts an organizationId from the client", () => {
    const parsed = createTicketSchema.parse({ type: "TASK", title: "abc", organizationId: "org_b" });
    expect(parsed).not.toHaveProperty("organizationId");
  });
});

describe("formatTicketKey", () => {
  it("pads per organization configuration", () => {
    expect(formatTicketKey("IT", 1, 6)).toBe("IT-000001");
    expect(formatTicketKey("REQ", 1234567, 6)).toBe("REQ-1234567");
  });
});
