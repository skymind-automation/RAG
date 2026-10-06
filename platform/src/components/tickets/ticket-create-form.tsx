"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { createTicketAction } from "@/app/actions/tickets";
import { FormError } from "@/components/common/form-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { PublicError } from "@/lib/errors";
import { TICKET_TYPES } from "@/lib/validation/schemas";
import { CustomFieldInput, fieldsForType, type CustomFieldDef, type CustomFieldFormValue } from "./custom-field-input";
import { TICKET_TYPE_LABELS } from "./badges";

const NONE = "__none";

export interface CreateFormOptions {
  priorities: { key: string; name: string; isDefault: boolean }[];
  categories: { id: string; name: string }[];
  teams: { id: string; name: string }[];
  members: { id: string; name: string; email: string; assignable: boolean }[];
  customFields: CustomFieldDef[];
}

/**
 * One form for agents and requesters. Requesters get the portal subset
 * (type, title, description, priority, category, custom fields); routing
 * fields are only rendered for staff — and the server rejects them anyway.
 */
export function TicketCreateForm({
  orgSlug,
  options,
  staff,
  currentUserId,
}: {
  orgSlug: string;
  options: CreateFormOptions;
  staff: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const defaultPriority = options.priorities.find((p) => p.isDefault)?.key ?? options.priorities[0]?.key ?? "";
  const [type, setType] = useState<string>(staff ? "INCIDENT" : "SERVICE_REQUEST");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priorityKey, setPriorityKey] = useState(defaultPriority);
  const [categoryId, setCategoryId] = useState(NONE);
  const [teamId, setTeamId] = useState(NONE);
  const [assigneeId, setAssigneeId] = useState(NONE);
  const [requesterId, setRequesterId] = useState(currentUserId);
  const [dueAt, setDueAt] = useState("");
  const [custom, setCustom] = useState<Record<string, CustomFieldFormValue>>({});
  const [error, setError] = useState<PublicError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fields = useMemo(() => fieldsForType(options.customFields, type), [options.customFields, type]);
  const fe = (k: string) => error?.fieldErrors?.[k]?.[0];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const customFields = Object.fromEntries(
      fields.map((f) => [f.key, custom[f.key] ?? null]).filter(([, v]) => v !== null && v !== ""),
    );
    const result = await createTicketAction(orgSlug, {
      type,
      title,
      description,
      priorityKey,
      categoryId: categoryId === NONE ? undefined : categoryId,
      ...(staff
        ? {
            teamId: teamId === NONE ? undefined : teamId,
            assigneeId: assigneeId === NONE ? undefined : assigneeId,
            requesterId,
            dueAt: dueAt || undefined,
          }
        : {}),
      customFields,
    });
    setSubmitting(false);
    if (!result.ok) return setError(result.error);
    router.push(`/o/${orgSlug}/tickets/${result.data.key}`);
    router.refresh();
  }

  const unplaced =
    error &&
    (!error.fieldErrors ||
      Object.keys(error.fieldErrors).some(
        (k) => !["title", "description"].includes(k) && !k.startsWith("customFields."),
      ));

  return (
    <form onSubmit={submit} noValidate className="grid gap-4 lg:grid-cols-[1fr_18rem]">
      <Card>
        <CardContent className="grid gap-4">
          {unplaced ? (
            <FormError
              message={
                error.fieldErrors
                  ? Object.entries(error.fieldErrors)
                      .filter(([k]) => !["title", "description"].includes(k) && !k.startsWith("customFields."))
                      .map(([, v]) => v[0])
                      .join(" ")
                  : error.message
              }
            />
          ) : null}
          <div className="grid gap-1.5">
            <Label htmlFor="t-title">Title</Label>
            <Input
              id="t-title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              aria-invalid={!!fe("title")}
              aria-describedby={fe("title") ? "t-title-error" : undefined}
              placeholder={staff ? "Short summary" : "What do you need help with?"}
            />
            {fe("title") ? (
              <p id="t-title-error" className="text-xs text-destructive">
                {fe("title")}
              </p>
            ) : null}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="t-desc">Description</Label>
            <Textarea
              id="t-desc"
              rows={10}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              aria-describedby="t-desc-hint"
            />
            <p id="t-desc-hint" className="text-xs text-muted-foreground">
              Markdown supported. You can attach files after creating the ticket.
            </p>
          </div>
          {fields.length > 0 ? (
            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="mb-2 text-sm font-medium">Details</legend>
              {fields.map((f) => (
                <CustomFieldInput
                  key={f.key}
                  def={f}
                  value={custom[f.key]}
                  error={fe(`customFields.${f.key}`)}
                  onChange={(v) => setCustom((c) => ({ ...c, [f.key]: v }))}
                />
              ))}
            </fieldset>
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="t-type">Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger id="t-type" className="w-full">
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
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="t-priority">Priority</Label>
            <Select value={priorityKey} onValueChange={setPriorityKey}>
              <SelectTrigger id="t-priority" className="w-full">
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
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="t-category">Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger id="t-category" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>—</SelectItem>
                {options.categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {staff ? (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="t-requester">Requester</Label>
                <Select value={requesterId} onValueChange={setRequesterId}>
                  <SelectTrigger id="t-requester" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {options.members.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="t-team">Team</Label>
                <Select value={teamId} onValueChange={setTeamId}>
                  <SelectTrigger id="t-team" className="w-full">
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
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="t-assignee">Assignee</Label>
                <Select value={assigneeId} onValueChange={setAssigneeId}>
                  <SelectTrigger id="t-assignee" className="w-full">
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
                {fe("assigneeId") ? <p className="text-xs text-destructive">{fe("assigneeId")}</p> : null}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="t-due">Due date</Label>
                <Input id="t-due" type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
              </div>
            </>
          ) : null}
          <Button type="submit" disabled={submitting}>
            {submitting ? "Creating…" : staff ? "Create ticket" : "Submit request"}
          </Button>
        </CardContent>
      </Card>
    </form>
  );
}
