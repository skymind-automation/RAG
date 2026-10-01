"use client";

import { Pencil } from "lucide-react";
import { useState } from "react";
import { assignTicketAction, updateTicketAction } from "@/app/actions/tickets";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { PublicError } from "@/lib/errors";
import { useMutation } from "@/hooks/use-mutation";
import { formatWallDate, wallDateOf } from "@/lib/time/zoned";
import { TICKET_TYPES } from "@/lib/validation/schemas";
import { PriorityBadge, TICKET_TYPE_LABELS } from "./badges";
import { CustomFieldInput, fieldsForType, type CustomFieldDef, type CustomFieldFormValue } from "./custom-field-input";

const NONE = "__none";

export interface PropertiesTicket {
  id: string;
  version: number;
  type: keyof typeof TICKET_TYPE_LABELS;
  priority: { key: string; name: string; level: number; color: string };
  category: { id: string; name: string } | null;
  team: { id: string; name: string } | null;
  assignee: { id: string; name: string } | null;
  requester: { id: string; name: string };
  createdBy: { id: string; name: string };
  source: string;
  dueAt: string | null;
  createdAt: string;
  resolvedAt: string | null;
  customFields: Record<string, string | number | boolean>;
}

export interface PropertiesOptions {
  priorities: { key: string; name: string }[];
  categories: { id: string; name: string }[];
  teams: { id: string; name: string }[];
  members: { id: string; name: string; assignable: boolean }[];
  customFields: CustomFieldDef[];
}

function Row({ label, children, htmlFor }: { label: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-2 py-1 text-sm">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="text-muted-foreground">
          {label}
        </label>
      ) : (
        <span className="text-muted-foreground">{label}</span>
      )}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function displayValue(def: CustomFieldDef, v: string | number | boolean | undefined): string {
  if (v === undefined || v === "") return "—";
  if (def.type === "CHECKBOX") return v ? "Yes" : "No";
  return String(v);
}

export function TicketProperties({
  orgSlug,
  ticket,
  options,
  can,
  timezone,
}: {
  orgSlug: string;
  ticket: PropertiesTicket;
  options: PropertiesOptions;
  can: { update: boolean; assign: boolean };
  timezone: string;
}) {
  const { run, pending } = useMutation();
  const update = (patch: Record<string, unknown>, success?: string) =>
    run(() => updateTicketAction(orgSlug, { ticketId: ticket.id, expectedVersion: ticket.version, ...patch }), {
      success,
    });
  const date = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString("en-US", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" }) : "—";
  const fields = fieldsForType(options.customFields, ticket.type);
  // Due dates are calendar days in the organization's zone, not UTC.
  const dueLocal = ticket.dueAt ? formatWallDate(wallDateOf(new Date(ticket.dueAt), timezone)) : "";

  return (
    <section
      aria-label="Ticket properties"
      className="grid min-w-0 divide-y rounded-lg border bg-card px-3 py-1"
      aria-busy={pending}
    >
      <div className="py-1">
        <Row label="Assignee" htmlFor="p-assignee">
          {can.assign ? (
            <Select
              value={ticket.assignee?.id ?? NONE}
              onValueChange={(v) =>
                run(() =>
                  assignTicketAction(orgSlug, {
                    ticketId: ticket.id,
                    assigneeId: v === NONE ? null : v,
                    expectedVersion: ticket.version,
                  }),
                )
              }
            >
              <SelectTrigger id="p-assignee" size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Unassigned</SelectItem>
                {options.members
                  .filter((m) => m.assignable)
                  .map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          ) : (
            <span>{ticket.assignee?.name ?? "Unassigned"}</span>
          )}
        </Row>
        <Row label="Priority" htmlFor="p-priority">
          {can.update ? (
            <Select value={ticket.priority.key} onValueChange={(v) => update({ priorityKey: v })}>
              <SelectTrigger id="p-priority" size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.priorities.map((p) => (
                  <SelectItem key={p.key} value={p.key}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <PriorityBadge {...ticket.priority} />
          )}
        </Row>
        <Row label="Type" htmlFor="p-type">
          {can.update ? (
            <Select value={ticket.type} onValueChange={(v) => update({ type: v })}>
              <SelectTrigger id="p-type" size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TICKET_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {TICKET_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span>{TICKET_TYPE_LABELS[ticket.type]}</span>
          )}
        </Row>
        <Row label="Category" htmlFor="p-category">
          {can.update ? (
            <Select
              value={ticket.category?.id ?? NONE}
              onValueChange={(v) => update({ categoryId: v === NONE ? null : v })}
            >
              <SelectTrigger id="p-category" size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>—</SelectItem>
                {/* Keep an archived category visible as the current value. */}
                {ticket.category && !options.categories.some((c) => c.id === ticket.category!.id) ? (
                  <SelectItem value={ticket.category.id} disabled>
                    {ticket.category.name}
                  </SelectItem>
                ) : null}
                {options.categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span>{ticket.category?.name ?? "—"}</span>
          )}
        </Row>
        {can.update ? (
          <Row label="Team" htmlFor="p-team">
            <Select value={ticket.team?.id ?? NONE} onValueChange={(v) => update({ teamId: v === NONE ? null : v })}>
              <SelectTrigger id="p-team" size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>—</SelectItem>
                {options.teams.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
        ) : ticket.team ? (
          <Row label="Team">{ticket.team.name}</Row>
        ) : null}
        <Row label="Due" htmlFor="p-due">
          {can.update ? (
            <Input
              id="p-due"
              type="date"
              className="h-7"
              defaultValue={dueLocal}
              onBlur={(e) => {
                const v = e.target.value;
                if (v !== dueLocal) void update({ dueAt: v || null });
              }}
            />
          ) : (
            <span>
              {ticket.dueAt
                ? new Date(ticket.dueAt).toLocaleDateString("en-US", { timeZone: timezone, dateStyle: "medium" })
                : "—"}
            </span>
          )}
        </Row>
      </div>

      <div className="py-1">
        <Row label="Requester">{ticket.requester.name}</Row>
        {ticket.createdBy.id !== ticket.requester.id ? <Row label="Filed by">{ticket.createdBy.name}</Row> : null}
        <Row label="Source">
          <span className="capitalize">{ticket.source.toLowerCase()}</span>
        </Row>
        <Row label="Created">
          <span className="text-xs">{date(ticket.createdAt)}</span>
        </Row>
        {ticket.resolvedAt ? (
          <Row label="Resolved">
            <span className="text-xs">{date(ticket.resolvedAt)}</span>
          </Row>
        ) : null}
      </div>

      {fields.length > 0 ? (
        <div className="py-1">
          <div className="flex items-center justify-between pt-1">
            <h3 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">Details</h3>
            {can.update ? <CustomFieldsEditor orgSlug={orgSlug} ticket={ticket} fields={fields} /> : null}
          </div>
          {fields.map((f) => (
            <Row key={f.key} label={f.label}>
              <span className="break-words">{displayValue(f, ticket.customFields[f.key])}</span>
            </Row>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function CustomFieldsEditor({
  orgSlug,
  ticket,
  fields,
}: {
  orgSlug: string;
  ticket: PropertiesTicket;
  fields: CustomFieldDef[];
}) {
  const [open, setOpen] = useState(false);
  const initial = () =>
    Object.fromEntries(
      fields.map((f) => {
        const v = ticket.customFields[f.key];
        return [f.key, typeof v === "boolean" ? v : v === undefined ? "" : String(v)];
      }),
    ) as Record<string, CustomFieldFormValue>;
  const [values, setValues] = useState<Record<string, CustomFieldFormValue>>(initial);
  const [error, setError] = useState<PublicError | null>(null);
  const { run, pending } = useMutation();

  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), o && (setValues(initial()), setError(null)))}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="xs">
          <Pencil aria-hidden /> Edit
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit details</DialogTitle>
        </DialogHeader>
        <form
          id="cf-form"
          className="grid gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await run(
              () =>
                updateTicketAction(orgSlug, {
                  ticketId: ticket.id,
                  expectedVersion: ticket.version,
                  customFields: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v === "" ? null : v])),
                }),
              { onError: setError },
            );
            if (r.ok) setOpen(false);
          }}
        >
          {fields.map((f) => (
            <CustomFieldInput
              key={f.key}
              def={f}
              value={values[f.key]}
              error={error?.fieldErrors?.[`customFields.${f.key}`]?.[0]}
              onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))}
            />
          ))}
        </form>
        <DialogFooter>
          <Button type="submit" form="cf-form" disabled={pending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
