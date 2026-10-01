import type { CustomFieldDefinition, TicketType } from "@prisma/client";
import { ValidationError } from "@/lib/errors";

/**
 * Validation for organization-defined ticket fields. Pure: takes the active
 * definitions and returns the normalised value map, or throws a
 * ValidationError keyed `customFields.<key>`.
 */

export type CustomFieldValue = string | number | boolean;
export type CustomFieldValues = Record<string, CustomFieldValue>;

export type CustomFieldDefinitionLike = Pick<
  CustomFieldDefinition,
  "key" | "label" | "type" | "options" | "required" | "ticketTypes"
>;

type Coerced = { ok: true; value: CustomFieldValue } | { ok: false; error: string };

const MAX_TEXT = 2000;

export function fieldAppliesTo(def: Pick<CustomFieldDefinition, "ticketTypes">, type: TicketType): boolean {
  return def.ticketTypes.length === 0 || def.ticketTypes.includes(type);
}

export function optionsOf(def: Pick<CustomFieldDefinition, "options">): string[] {
  return Array.isArray(def.options) ? def.options.filter((o): o is string => typeof o === "string") : [];
}

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

function coerce(def: CustomFieldDefinitionLike, raw: unknown): Coerced {
  switch (def.type) {
    case "TEXT":
      if (typeof raw !== "string") return { ok: false, error: "Enter text." };
      if (raw.length > MAX_TEXT) return { ok: false, error: `Use at most ${MAX_TEXT} characters.` };
      return { ok: true, value: raw.trim() };
    case "NUMBER": {
      const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, error: "Enter a number." };
    }
    case "SELECT":
      return typeof raw === "string" && optionsOf(def).includes(raw)
        ? { ok: true, value: raw }
        : { ok: false, error: "Choose one of the options." };
    case "DATE":
      return typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(raw))
        ? { ok: true, value: raw }
        : { ok: false, error: "Use a date like 2026-10-01." };
    case "CHECKBOX":
      if (typeof raw === "boolean") return { ok: true, value: raw };
      if (raw === "true" || raw === "false") return { ok: true, value: raw === "true" };
      return { ok: false, error: "Choose yes or no." };
  }
}

/**
 * @param existing current stored values (update) or {} (create)
 * @param incoming values supplied by the caller; null or "" clears a field
 */
export function validateCustomFields(
  definitions: CustomFieldDefinitionLike[],
  ticketType: TicketType,
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): CustomFieldValues {
  const byKey = new Map(definitions.map((d) => [d.key, d]));
  const errors: Record<string, string[]> = {};
  const result: CustomFieldValues = {};

  // Carry over stored values for fields that still exist and still apply.
  for (const [key, value] of Object.entries(existing)) {
    const def = byKey.get(key);
    if (def && fieldAppliesTo(def, ticketType) && ["string", "number", "boolean"].includes(typeof value)) {
      result[key] = value as CustomFieldValue;
    }
  }

  for (const [key, raw] of Object.entries(incoming)) {
    const def = byKey.get(key);
    if (!def || !fieldAppliesTo(def, ticketType)) {
      errors[`customFields.${key}`] = ["Unknown field."];
      continue;
    }
    if (isEmpty(raw)) {
      delete result[key];
      continue;
    }
    const c = coerce(def, raw);
    if (c.ok) result[key] = c.value;
    else errors[`customFields.${key}`] = [c.error];
  }

  for (const def of definitions) {
    const k = `customFields.${def.key}`;
    if (def.required && fieldAppliesTo(def, ticketType) && result[def.key] === undefined && !errors[k]) {
      errors[k] = [`${def.label} is required.`];
    }
  }

  if (Object.keys(errors).length > 0) throw new ValidationError("Some fields are invalid.", errors);
  return result;
}
