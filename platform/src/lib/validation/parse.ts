import type { z } from "zod";
import { ValidationError } from "@/lib/errors";
import { flattenZodError } from "./schemas";

/** Validate untrusted input against a schema, throwing a typed ValidationError. */
export function parseInput<S extends z.ZodTypeAny>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError("Some fields are invalid.", flattenZodError(result.error));
  }
  return result.data;
}
