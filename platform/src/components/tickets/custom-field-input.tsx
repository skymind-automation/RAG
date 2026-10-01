"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface CustomFieldDef {
  key: string;
  label: string;
  type: "TEXT" | "NUMBER" | "SELECT" | "DATE" | "CHECKBOX";
  options: string[];
  required: boolean;
  ticketTypes: string[];
}

export type CustomFieldFormValue = string | boolean;

export function fieldsForType(defs: CustomFieldDef[], type: string): CustomFieldDef[] {
  return defs.filter((d) => d.ticketTypes.length === 0 || d.ticketTypes.includes(type));
}

const NONE = "__none";

export function CustomFieldInput({
  def,
  value,
  onChange,
  error,
}: {
  def: CustomFieldDef;
  value: CustomFieldFormValue | undefined;
  onChange: (v: CustomFieldFormValue) => void;
  error?: string;
}) {
  const id = `cf-${def.key}`;
  const errId = `${id}-error`;
  const label = (
    <Label htmlFor={id}>
      {def.label}
      {def.required ? (
        <span className="text-destructive" aria-hidden>
          {" "}
          *
        </span>
      ) : null}
    </Label>
  );
  const describedBy = error ? errId : undefined;
  let control: React.ReactNode;
  switch (def.type) {
    case "CHECKBOX":
      return (
        <div className="grid gap-1">
          <div className="flex items-center gap-2">
            <Checkbox
              id={id}
              checked={value === true}
              onCheckedChange={(c) => onChange(c === true)}
              aria-describedby={describedBy}
            />
            {label}
          </div>
          {error ? (
            <p id={errId} className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      );
    case "SELECT":
      control = (
        <Select
          value={typeof value === "string" && value ? value : NONE}
          onValueChange={(v) => onChange(v === NONE ? "" : v)}
        >
          <SelectTrigger id={id} className="w-full" aria-invalid={!!error} aria-describedby={describedBy}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>—</SelectItem>
            {def.options.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
      break;
    default:
      control = (
        <Input
          id={id}
          type={def.type === "NUMBER" ? "number" : def.type === "DATE" ? "date" : "text"}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={describedBy}
        />
      );
  }
  return (
    <div className="grid gap-1.5">
      {label}
      {control}
      {error ? (
        <p id={errId} className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
