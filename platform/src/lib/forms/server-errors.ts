import type { FieldValues, Path, UseFormReturn } from "react-hook-form";
import type { PublicError } from "@/lib/errors";

/**
 * Map a server-side PublicError onto a react-hook-form instance: per-field
 * messages go to their fields, everything else to the form root.
 */
export function applyServerErrors<T extends FieldValues>(form: UseFormReturn<T>, error: PublicError): void {
  const fields = error.fieldErrors ?? {};
  let placed = false;
  for (const [name, messages] of Object.entries(fields)) {
    if (name in form.getValues()) {
      form.setError(name as Path<T>, { type: "server", message: messages[0] });
      placed = true;
    }
  }
  if (!placed) form.setError("root", { type: "server", message: error.message });
}
