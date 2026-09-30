import { z } from "zod";
import { ROLES } from "@/lib/permissions";

/**
 * Shared request schemas. Used by forms (react-hook-form resolver) and
 * re-validated on the server — client validation is UX, server validation is
 * the contract. Note: no schema accepts an `organizationId`; the organization
 * always comes from the verified context.
 */

export const emailSchema = z
  .string()
  .trim()
  .min(3, "Enter your email address.")
  .max(254)
  .email("Enter a valid email address.")
  .transform((e) => e.toLowerCase());

export const passwordSchema = z.string().min(12, "Use at least 12 characters.").max(128, "Use at most 128 characters.");

export const personNameSchema = z.string().trim().min(1, "Enter your name.").max(100);

export const registerSchema = z.object({
  name: personNameSchema,
  email: emailSchema,
  password: passwordSchema,
});
export type RegisterInput = z.input<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  // Don't enforce the policy on login: old passwords must still work.
  password: z.string().min(1, "Enter your password.").max(128),
});
export type LoginInput = z.input<typeof loginSchema>;

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, "Use at least 2 characters.")
  .max(48, "Use at most 48 characters.")
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "Lowercase letters, numbers and hyphens only.");

export const RESERVED_SLUGS = new Set([
  "api",
  "app",
  "admin",
  "auth",
  "login",
  "logout",
  "register",
  "invite",
  "onboarding",
  "settings",
  "static",
  "public",
  "o",
  "org",
  "orgs",
  "new",
  "www",
  "help",
  "status",
]);

export const timezoneSchema = z
  .string()
  .trim()
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Choose a valid time zone.");

export const ticketPrefixSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9]{0,9}$/, "1–10 letters or digits, starting with a letter.");

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2, "Use at least 2 characters.").max(100),
  slug: slugSchema.refine((s) => !RESERVED_SLUGS.has(s), "That address is reserved."),
  timezone: timezoneSchema.default("UTC"),
});
export type CreateOrganizationInput = z.input<typeof createOrganizationSchema>;

export const updateOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(100),
  timezone: timezoneSchema,
  ticketPrefix: ticketPrefixSchema,
});
export type UpdateOrganizationInput = z.input<typeof updateOrganizationSchema>;

export const roleSchema = z.enum(ROLES);

export const inviteMemberSchema = z.object({
  email: emailSchema,
  role: roleSchema,
});
export type InviteMemberInput = z.input<typeof inviteMemberSchema>;

export const changeRoleSchema = z.object({
  membershipId: z.string().min(1),
  role: roleSchema,
});

export const membershipIdSchema = z.object({ membershipId: z.string().min(1) });

export const createTeamSchema = z.object({
  name: z.string().trim().min(2, "Use at least 2 characters.").max(80),
  description: z.string().trim().max(500).optional(),
});
export type CreateTeamInput = z.input<typeof createTeamSchema>;

export const teamMemberSchema = z.object({
  teamId: z.string().min(1),
  membershipId: z.string().min(1),
});

export const TICKET_TYPES = ["INCIDENT", "SERVICE_REQUEST", "PROBLEM", "CHANGE", "TASK", "QUESTION"] as const;

export const createTicketSchema = z.object({
  type: z.enum(TICKET_TYPES),
  title: z.string().trim().min(3, "Use at least 3 characters.").max(200),
  description: z.string().max(20_000).default(""),
  priorityKey: z.string().min(1).optional(),
  categoryId: z.string().min(1).optional(),
  teamId: z.string().min(1).optional(),
  assigneeId: z.string().min(1).optional(),
  /** Agents may file on behalf of a requester; requesters always file for themselves. */
  requesterId: z.string().min(1).optional(),
  source: z.enum(["AGENT", "PORTAL", "EMAIL", "API"]).default("AGENT"),
  dueAt: z.coerce.date().optional(),
});
export type CreateTicketInput = z.input<typeof createTicketSchema>;

export const transitionTicketSchema = z.object({
  ticketId: z.string().min(1),
  toStatusId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  resolution: z.string().trim().max(10_000).optional(),
});

export const assignTicketSchema = z.object({
  ticketId: z.string().min(1),
  assigneeId: z.string().min(1).nullable(),
  expectedVersion: z.number().int().positive(),
});

export const addCommentSchema = z.object({
  ticketId: z.string().min(1),
  body: z.string().trim().min(1, "Write something first.").max(20_000),
  visibility: z.enum(["PUBLIC", "INTERNAL"]).default("PUBLIC"),
});

export const listTicketsSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).default(25),
  statusCategory: z.enum(["NEW", "OPEN", "IN_PROGRESS", "PENDING", "RESOLVED", "CLOSED"]).optional(),
  assigneeId: z.string().min(1).optional(),
  type: z.enum(TICKET_TYPES).optional(),
});
export type ListTicketsInput = z.input<typeof listTicketsSchema>;

/** Parse or throw a ValidationError with per-field messages. */
export function flattenZodError(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}
