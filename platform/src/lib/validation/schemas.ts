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
  ticketNumberPadding: z.coerce.number().int().min(3).max(10).optional(),
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

/**
 * A due date is either a calendar date ("2026-10-05", meaning the end of that
 * day in the organization's time zone, resolved by the service) or an exact
 * ISO instant.
 */
export const dueDateSchema = z.union([
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-10-05."),
  z.coerce.date(),
]);

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
  dueAt: dueDateSchema.optional(),
  /** Validated against the organization's CustomFieldDefinitions server-side. */
  customFields: z.record(z.unknown()).default({}),
});
export type CreateTicketInput = z.input<typeof createTicketSchema>;

const id = z.string().min(1).max(64);
const expectedVersion = z.number().int().positive();

/** Partial update. `null` clears an optional field; omitted fields are untouched. */
export const updateTicketSchema = z.object({
  ticketId: id,
  expectedVersion,
  title: z.string().trim().min(3, "Use at least 3 characters.").max(200).optional(),
  description: z.string().max(20_000).optional(),
  type: z.enum(TICKET_TYPES).optional(),
  priorityKey: z.string().min(1).max(40).optional(),
  categoryId: id.nullable().optional(),
  teamId: id.nullable().optional(),
  dueAt: dueDateSchema.nullable().optional(),
  customFields: z.record(z.unknown()).optional(),
});
export type UpdateTicketInput = z.input<typeof updateTicketSchema>;

export const deleteTicketSchema = z.object({ ticketId: id, expectedVersion });

export const watcherSchema = z.object({ ticketId: id, userId: id });

export const RELATION_TYPES = ["RELATES_TO", "DUPLICATES", "BLOCKS", "CAUSED_BY"] as const;
export const addRelationSchema = z.object({
  ticketId: id,
  targetKey: z.string().trim().min(3).max(40),
  type: z.enum(RELATION_TYPES),
});
export const removeRelationSchema = z.object({ relationId: id });

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
  mentionUserIds: z.array(id).max(20).default([]),
  /** Previously uploaded attachments (by the same user, on the same ticket) to attach. */
  attachmentIds: z.array(id).max(10).default([]),
});

export const STATUS_CATEGORIES = ["NEW", "OPEN", "IN_PROGRESS", "PENDING", "RESOLVED", "CLOSED"] as const;

export const listTicketsSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  statusCategory: z.enum(STATUS_CATEGORIES).optional(),
  /** "open" = every category except RESOLVED and CLOSED. */
  state: z.enum(["open", "closed", "all"]).default("all"),
  /** A user id, "me", or "unassigned". */
  assigneeId: z.string().min(1).max(64).optional(),
  type: z.enum(TICKET_TYPES).optional(),
  priorityKey: z.string().min(1).max(40).optional(),
  teamId: id.optional(),
  categoryId: id.optional(),
  /** Matches key or title (case-insensitive). Full-text search arrives with Phase 5/6. */
  q: z.string().trim().max(100).optional(),
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

// ── Ticket configuration (admin) ───────────────────────────────────────────

export const categoryNameSchema = z.string().trim().min(2, "Use at least 2 characters.").max(60);
export const createCategorySchema = z.object({
  name: categoryNameSchema,
  description: z.string().trim().max(300).optional(),
});
export const updateCategorySchema = z.object({ categoryId: id, name: categoryNameSchema });
export const archiveCategorySchema = z.object({ categoryId: id });

export const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #dc2626.");
export const updatePrioritySchema = z.object({
  priorityId: id,
  name: z.string().trim().min(2).max(30),
  color: hexColorSchema,
});
export const setDefaultPrioritySchema = z.object({ priorityId: id });

export const addStatusSchema = z.object({
  name: z.string().trim().min(2).max(40),
  category: z.enum(STATUS_CATEGORIES),
});
export const renameStatusSchema = z.object({ statusId: id, name: z.string().trim().min(2).max(40) });
export const setTransitionSchema = z.object({
  fromStatusId: id,
  toStatusId: id,
  enabled: z.boolean(),
  requiresResolution: z.boolean().default(false),
});

export const CUSTOM_FIELD_TYPES = ["TEXT", "NUMBER", "SELECT", "DATE", "CHECKBOX"] as const;
export const createCustomFieldSchema = z
  .object({
    label: z.string().trim().min(2).max(60),
    type: z.enum(CUSTOM_FIELD_TYPES),
    options: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
    required: z.boolean().default(false),
    ticketTypes: z.array(z.enum(TICKET_TYPES)).default([]),
  })
  .refine((v) => v.type !== "SELECT" || v.options.length >= 2, {
    message: "A select field needs at least two options.",
    path: ["options"],
  })
  .refine((v) => new Set(v.options).size === v.options.length, {
    message: "Options must be unique.",
    path: ["options"],
  });
export type CreateCustomFieldInput = z.input<typeof createCustomFieldSchema>;
export const archiveCustomFieldSchema = z.object({ fieldId: id });

// ── Attachments ────────────────────────────────────────────────────────────

export const requestUploadSchema = z.object({
  ticketId: id,
  fileName: z.string().trim().min(1).max(200),
  contentType: z.string().trim().min(3).max(120),
  sizeBytes: z.number().int().positive(),
  /** Uploads for an internal note are internal from the first byte. */
  visibility: z.enum(["PUBLIC", "INTERNAL"]).default("PUBLIC"),
});
export const attachmentIdSchema = z.object({ attachmentId: id });

// ── Time tracking ──────────────────────────────────────────────────────────

export const startTimerSchema = z.object({
  ticketId: id,
  description: z.string().trim().max(500).default(""),
  billable: z.boolean().default(false),
  /** Stop the caller's running timer (if any) in the same transaction. */
  switchFromRunning: z.boolean().default(false),
});

export const logTimeSchema = z.object({
  ticketId: id,
  /** Whole minutes, 1 minute to 24 hours. */
  minutes: z.coerce
    .number()
    .int()
    .min(1, "Log at least 1 minute.")
    .max(24 * 60, "Log at most 24 hours per entry."),
  /** When the work started; defaults to now minus the duration. */
  startedAt: z.coerce.date().optional(),
  description: z.string().trim().max(500).default(""),
  billable: z.boolean().default(false),
});

export const timeEntryIdSchema = z.object({ timeEntryId: id });

// ── Boards ─────────────────────────────────────────────────────────────────

export const boardFilterSchema = z.object({
  teamId: id.optional(),
  /** A user id, "me", or "unassigned". */
  assigneeId: z.string().min(1).max(64).optional(),
  priorityKey: z.string().min(1).max(40).optional(),
  type: z.enum(TICKET_TYPES).optional(),
});

export const moveTicketSchema = z.object({
  ticketId: id,
  expectedVersion,
  toCategory: z.enum(["NEW", "OPEN", "IN_PROGRESS", "PENDING", "RESOLVED"]),
  resolution: z.string().trim().max(10_000).optional(),
});
