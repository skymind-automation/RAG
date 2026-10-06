"use client";

import { Archive, Check, Plus, Star } from "lucide-react";
import { useState } from "react";
import {
  addWorkflowStatusAction,
  archiveCategoryAction,
  archiveCustomFieldAction,
  createCategoryAction,
  createCustomFieldAction,
  renameWorkflowStatusAction,
  setDefaultPriorityAction,
  setWorkflowTransitionAction,
  updatePriorityAction,
} from "@/app/actions/ticket-config";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { TICKET_TYPE_LABELS, TicketStatusBadge } from "@/components/tickets/badges";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMutation } from "@/hooks/use-mutation";
import type { PublicError } from "@/lib/errors";
import { CUSTOM_FIELD_TYPES, STATUS_CATEGORIES, TICKET_TYPES } from "@/lib/validation/schemas";

type Category = (typeof STATUS_CATEGORIES)[number];

export interface ConfigView {
  workflow: {
    statuses: { id: string; name: string; category: Category; isInitial: boolean }[];
    transitions: { fromStatusId: string; toStatusId: string; requiresResolution: boolean }[];
  } | null;
  priorities: { id: string; key: string; name: string; color: string; level: number; isDefault: boolean }[];
  categories: { id: string; name: string; ticketCount: number }[];
  customFields: {
    id: string;
    key: string;
    label: string;
    type: string;
    required: boolean;
    options: string[];
    ticketTypes: string[];
  }[];
}

function firstError(e: PublicError): string {
  return (e.fieldErrors && Object.values(e.fieldErrors)[0]?.[0]) || e.message;
}

export function TicketConfigAdmin({
  orgSlug,
  config,
  can,
}: {
  orgSlug: string;
  config: ConfigView;
  can: { configure: boolean; workflows: boolean };
}) {
  return (
    <Tabs defaultValue={can.configure ? "categories" : "workflow"} className="grid gap-4">
      <TabsList>
        {can.configure ? <TabsTrigger value="categories">Categories</TabsTrigger> : null}
        {can.configure ? <TabsTrigger value="priorities">Priorities</TabsTrigger> : null}
        {can.workflows ? <TabsTrigger value="workflow">Workflow</TabsTrigger> : null}
        {can.configure ? <TabsTrigger value="fields">Custom fields</TabsTrigger> : null}
      </TabsList>
      {can.configure ? (
        <TabsContent value="categories">
          <Categories orgSlug={orgSlug} categories={config.categories} />
        </TabsContent>
      ) : null}
      {can.configure ? (
        <TabsContent value="priorities">
          <Priorities orgSlug={orgSlug} priorities={config.priorities} />
        </TabsContent>
      ) : null}
      {can.workflows && config.workflow ? (
        <TabsContent value="workflow">
          <Workflow orgSlug={orgSlug} workflow={config.workflow} />
        </TabsContent>
      ) : null}
      {can.configure ? (
        <TabsContent value="fields">
          <CustomFields orgSlug={orgSlug} fields={config.customFields} />
        </TabsContent>
      ) : null}
    </Tabs>
  );
}

function Categories({ orgSlug, categories }: { orgSlug: string; categories: ConfigView["categories"] }) {
  const { run, pending } = useMutation();
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Categories</CardTitle>
        <CardDescription>Archiving hides a category from forms; tickets that use it keep it.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <ul className="divide-y rounded-md border">
          {categories.map((c) => (
            <li key={c.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <span className="flex-1">{c.name}</span>
              <span className="text-xs text-muted-foreground">{c.ticketCount} tickets</span>
              <ConfirmDialog
                trigger={
                  <Button variant="ghost" size="xs" aria-label={`Archive ${c.name}`}>
                    <Archive aria-hidden />
                  </Button>
                }
                title={`Archive "${c.name}"?`}
                description="It will no longer be offered on new or edited tickets."
                confirmLabel="Archive"
                onConfirm={async () => (await run(() => archiveCategoryAction(orgSlug, { categoryId: c.id }))).ok}
              />
            </li>
          ))}
        </ul>
        <form
          className="flex flex-wrap items-start gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(undefined);
            const r = await run(() => createCategoryAction(orgSlug, { name }), {
              onError: (er) => setError(firstError(er)),
            });
            if (r.ok) setName("");
          }}
        >
          <div className="grid gap-1">
            <Label htmlFor="new-category" className="sr-only">
              New category
            </Label>
            <Input
              id="new-category"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="New category"
              className="w-60"
              aria-invalid={!!error}
            />
            {error ? (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <Button type="submit" disabled={pending || !name.trim()}>
            <Plus aria-hidden /> Add
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Priorities({ orgSlug, priorities }: { orgSlug: string; priorities: ConfigView["priorities"] }) {
  const { run, pending } = useMutation();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Priorities</CardTitle>
        <CardDescription>
          Levels are fixed (1 = most urgent) so SLAs and sorting stay meaningful; names and colours are yours.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y rounded-md border">
          {priorities.map((p) => (
            <PriorityRow
              key={p.id}
              orgSlug={orgSlug}
              priority={p}
              pending={pending}
              onSave={(name, color) =>
                run(() => updatePriorityAction(orgSlug, { priorityId: p.id, name, color }), {
                  success: "Priority saved",
                })
              }
              onDefault={() =>
                run(() => setDefaultPriorityAction(orgSlug, { priorityId: p.id }), {
                  success: `${p.name} is now the default`,
                })
              }
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function PriorityRow({
  priority,
  pending,
  onSave,
  onDefault,
}: {
  orgSlug: string;
  priority: ConfigView["priorities"][number];
  pending: boolean;
  onSave: (name: string, color: string) => unknown;
  onDefault: () => unknown;
}) {
  const [name, setName] = useState(priority.name);
  const [color, setColor] = useState(priority.color);
  const dirty = name !== priority.name || color !== priority.color;
  return (
    <li className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
      <span className="w-6 text-xs text-muted-foreground tabular-nums">L{priority.level}</span>
      <input
        type="color"
        value={color}
        onChange={(e) => setColor(e.target.value)}
        aria-label={`Colour for ${priority.name}`}
        className="size-7 cursor-pointer rounded border bg-transparent"
      />
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label={`Name for level ${priority.level}`}
        className="h-7 w-40"
      />
      {dirty ? (
        <Button size="xs" disabled={pending} onClick={() => onSave(name, color)}>
          <Check aria-hidden /> Save
        </Button>
      ) : null}
      <span className="ml-auto">
        {priority.isDefault ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Star className="size-3 fill-current" aria-hidden /> Default
          </span>
        ) : (
          <Button variant="ghost" size="xs" disabled={pending} onClick={() => onDefault()}>
            Make default
          </Button>
        )}
      </span>
    </li>
  );
}

function Workflow({ orgSlug, workflow }: { orgSlug: string; workflow: NonNullable<ConfigView["workflow"]> }) {
  const { run, pending } = useMutation();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<Category>("PENDING");
  const [error, setError] = useState<string>();
  const t = (from: string, to: string) =>
    workflow.transitions.find((x) => x.fromStatusId === from && x.toStatusId === to);

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Statuses</CardTitle>
          <CardDescription>
            Each status maps to a fixed category that boards, SLAs and reports understand. Statuses can be renamed but
            not removed, because tickets reference them.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <ul className="divide-y rounded-md border">
            {workflow.statuses.map((s) => (
              <StatusRow
                key={s.id}
                status={s}
                pending={pending}
                onRename={(n) =>
                  run(() => renameWorkflowStatusAction(orgSlug, { statusId: s.id, name: n }), {
                    success: "Status renamed",
                  })
                }
              />
            ))}
          </ul>
          <form
            className="flex flex-wrap items-start gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              setError(undefined);
              const r = await run(() => addWorkflowStatusAction(orgSlug, { name, category }), {
                onError: (er) => setError(firstError(er)),
              });
              if (r.ok) setName("");
            }}
          >
            <div className="grid gap-1">
              <Label htmlFor="new-status" className="sr-only">
                New status name
              </Label>
              <Input
                id="new-status"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="New status, e.g. Awaiting vendor"
                className="w-60"
              />
              {error ? (
                <p role="alert" className="text-xs text-destructive">
                  {error}
                </p>
              ) : null}
            </div>
            <Select value={category} onValueChange={(v) => setCategory(v as Category)}>
              <SelectTrigger className="w-40" aria-label="Status category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c.replace("_", " ").toLowerCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit" disabled={pending || !name.trim()}>
              <Plus aria-hidden /> Add status
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Allowed transitions</CardTitle>
          <CardDescription>
            Rows are the current status, columns the next. Tick to allow; &ldquo;R&rdquo; requires a resolution before
            moving.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="text-xs">
            <caption className="sr-only">Workflow transition matrix</caption>
            <thead>
              <tr>
                <th scope="col" className="p-1 text-left font-medium text-muted-foreground">
                  From \ To
                </th>
                {workflow.statuses.map((s) => (
                  <th key={s.id} scope="col" className="p-1 font-medium whitespace-nowrap">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {workflow.statuses.map((from) => (
                <tr key={from.id} className="border-t">
                  <th scope="row" className="p-1 pr-3 text-left font-medium whitespace-nowrap">
                    {from.name}
                  </th>
                  {workflow.statuses.map((to) => {
                    if (from.id === to.id)
                      return (
                        <td key={to.id} className="p-1 text-center text-muted-foreground">
                          —
                        </td>
                      );
                    const cur = t(from.id, to.id);
                    return (
                      <td key={to.id} className="p-1 text-center">
                        <div className="inline-flex items-center gap-1">
                          <Checkbox
                            checked={Boolean(cur)}
                            disabled={pending}
                            aria-label={`Allow ${from.name} to ${to.name}`}
                            onCheckedChange={(c) =>
                              run(() =>
                                setWorkflowTransitionAction(orgSlug, {
                                  fromStatusId: from.id,
                                  toStatusId: to.id,
                                  enabled: c === true,
                                  requiresResolution: false,
                                }),
                              )
                            }
                          />
                          {cur ? (
                            <button
                              type="button"
                              disabled={pending}
                              aria-pressed={cur.requiresResolution}
                              aria-label={`Require resolution for ${from.name} to ${to.name}`}
                              className={
                                cur.requiresResolution
                                  ? "rounded bg-emerald-100 px-1 font-semibold text-emerald-800"
                                  : "rounded px-1 text-muted-foreground hover:bg-muted"
                              }
                              onClick={() =>
                                run(() =>
                                  setWorkflowTransitionAction(orgSlug, {
                                    fromStatusId: from.id,
                                    toStatusId: to.id,
                                    enabled: true,
                                    requiresResolution: !cur.requiresResolution,
                                  }),
                                )
                              }
                            >
                              R
                            </button>
                          ) : null}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function StatusRow({
  status,
  pending,
  onRename,
}: {
  status: NonNullable<ConfigView["workflow"]>["statuses"][number];
  pending: boolean;
  onRename: (n: string) => unknown;
}) {
  const [name, setName] = useState(status.name);
  return (
    <li className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
      <TicketStatusBadge name={status.name} category={status.category} />
      <span className="text-xs text-muted-foreground">
        {status.category.replace("_", " ").toLowerCase()}
        {status.isInitial ? " · initial" : ""}
      </span>
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label={`Rename ${status.name}`}
        className="ml-auto h-7 w-44"
      />
      {name !== status.name ? (
        <Button size="xs" disabled={pending} onClick={() => onRename(name)}>
          <Check aria-hidden /> Save
        </Button>
      ) : null}
    </li>
  );
}

function CustomFields({ orgSlug, fields }: { orgSlug: string; fields: ConfigView["customFields"] }) {
  const { run, pending } = useMutation();
  const [label, setLabel] = useState("");
  const [type, setType] = useState<(typeof CUSTOM_FIELD_TYPES)[number]>("TEXT");
  const [options, setOptions] = useState("");
  const [required, setRequired] = useState(false);
  const [types, setTypes] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Custom fields</CardTitle>
        <CardDescription>Extra structured details on tickets, validated on every save.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {fields.length === 0 ? (
          <p className="text-sm text-muted-foreground">No custom fields yet.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {fields.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <span className="font-medium">{f.label}</span>
                <code className="text-xs text-muted-foreground">{f.key}</code>
                <span className="text-xs text-muted-foreground">
                  {f.type.toLowerCase()}
                  {f.required ? " · required" : ""}
                  {f.ticketTypes.length
                    ? ` · ${f.ticketTypes.map((t) => TICKET_TYPE_LABELS[t as keyof typeof TICKET_TYPE_LABELS]).join(", ")}`
                    : " · all types"}
                  {f.options.length ? ` · ${f.options.join(" / ")}` : ""}
                </span>
                <span className="ml-auto">
                  <ConfirmDialog
                    trigger={
                      <Button variant="ghost" size="xs" aria-label={`Archive ${f.label}`}>
                        <Archive aria-hidden />
                      </Button>
                    }
                    title={`Archive "${f.label}"?`}
                    description="It disappears from forms and is no longer validated."
                    confirmLabel="Archive"
                    onConfirm={async () => (await run(() => archiveCustomFieldAction(orgSlug, { fieldId: f.id }))).ok}
                  />
                </span>
              </li>
            ))}
          </ul>
        )}
        <form
          className="grid max-w-xl gap-3 rounded-md border p-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(undefined);
            const r = await run(
              () =>
                createCustomFieldAction(orgSlug, {
                  label,
                  type,
                  required,
                  ticketTypes: types,
                  options:
                    type === "SELECT"
                      ? options
                          .split(",")
                          .map((o) => o.trim())
                          .filter(Boolean)
                      : [],
                }),
              { success: "Field added", onError: (er) => setError(firstError(er)) },
            );
            if (r.ok) {
              setLabel("");
              setOptions("");
              setRequired(false);
              setTypes([]);
            }
          }}
        >
          <h3 className="text-sm font-medium">Add a field</h3>
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <div className="grid gap-1">
              <Label htmlFor="cf-label">Label</Label>
              <Input id="cf-label" value={label} onChange={(e) => setLabel(e.target.value)} className="w-56" />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="cf-type">Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
                <SelectTrigger id="cf-type" className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CUSTOM_FIELD_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t.toLowerCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {type === "SELECT" ? (
            <div className="grid gap-1">
              <Label htmlFor="cf-options">Options (comma-separated)</Label>
              <Input
                id="cf-options"
                value={options}
                onChange={(e) => setOptions(e.target.value)}
                placeholder="Memphis, Dallas, Head office"
              />
            </div>
          ) : null}
          <fieldset className="grid gap-1">
            <legend className="text-sm font-medium">Applies to</legend>
            <p className="text-xs text-muted-foreground">Leave all unticked to apply to every type.</p>
            <div className="flex flex-wrap gap-3">
              {TICKET_TYPES.map((t) => (
                <label key={t} className="inline-flex items-center gap-1.5 text-sm">
                  <Checkbox
                    checked={types.includes(t)}
                    onCheckedChange={(c) => setTypes((ts) => (c ? [...ts, t] : ts.filter((x) => x !== t)))}
                  />
                  {TICKET_TYPE_LABELS[t]}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="inline-flex items-center gap-2 text-sm">
            <Checkbox checked={required} onCheckedChange={(c) => setRequired(c === true)} /> Required
          </label>
          <div>
            <Button type="submit" disabled={pending || !label.trim()}>
              <Plus aria-hidden /> Add field
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
