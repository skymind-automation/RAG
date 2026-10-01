"use client";

import { Eye, EyeOff, Link2, Paperclip, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  addRelationAction,
  addWatcherAction,
  deleteAttachmentAction,
  removeRelationAction,
  removeWatcherAction,
} from "@/app/actions/tickets";
import { UserAvatar } from "@/components/common/user-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMutation } from "@/hooks/use-mutation";
import { ACCEPT_ATTRIBUTE } from "@/lib/attachments";
import { RELATION_TYPES } from "@/lib/validation/schemas";
import { AttachmentLink, type AttachmentView } from "./attachment-link";
import { TicketStatusBadge } from "./badges";
import { uploadAttachment } from "./upload";

function Panel({
  title,
  icon: Icon,
  action,
  children,
}: {
  title: string;
  icon: typeof Eye;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="rounded-lg border bg-card p-3">
      <div className="mb-2 flex items-center gap-2">
        <Icon className="size-3.5 text-muted-foreground" aria-hidden />
        <h2 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">{title}</h2>
        <div className="ml-auto">{action}</div>
      </div>
      {children}
    </section>
  );
}

// ── watchers ────────────────────────────────────────────────────────────

export function WatchersPanel({
  orgSlug,
  ticketId,
  watchers,
  currentUserId,
  candidates,
}: {
  orgSlug: string;
  ticketId: string;
  watchers: { id: string; name: string }[];
  currentUserId: string;
  /** Members who may be added (staff only); empty for requesters. */
  candidates: { id: string; name: string }[];
}) {
  const { run, pending } = useMutation();
  const watching = watchers.some((w) => w.id === currentUserId);
  const addable = candidates.filter((c) => !watchers.some((w) => w.id === c.id));
  return (
    <Panel
      title={`Watchers (${watchers.length})`}
      icon={Eye}
      action={
        <Button
          variant="ghost"
          size="xs"
          disabled={pending}
          onClick={() =>
            run(() => (watching ? removeWatcherAction : addWatcherAction)(orgSlug, { ticketId, userId: currentUserId }))
          }
        >
          {watching ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
          {watching ? "Unwatch" : "Watch"}
        </Button>
      }
    >
      <ul className="grid grid-cols-1 gap-1">
        {watchers.map((w) => (
          <li key={w.id} className="flex items-center gap-2 text-sm">
            <UserAvatar name={w.name} className="size-5" />
            <span className="truncate">{w.name}</span>
            {candidates.length > 0 && w.id !== currentUserId ? (
              <button
                type="button"
                className="ml-auto rounded text-muted-foreground hover:text-foreground"
                aria-label={`Remove ${w.name} from watchers`}
                onClick={() => run(() => removeWatcherAction(orgSlug, { ticketId, userId: w.id }))}
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {addable.length > 0 ? (
        <Select value="" onValueChange={(userId) => run(() => addWatcherAction(orgSlug, { ticketId, userId }))}>
          <SelectTrigger size="sm" className="mt-2 w-full" aria-label="Add watcher">
            <SelectValue placeholder="Add watcher…" />
          </SelectTrigger>
          <SelectContent>
            {addable.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </Panel>
  );
}

// ── related tickets ─────────────────────────────────────────────────────

const RELATION_LABEL: Record<(typeof RELATION_TYPES)[number], string> = {
  RELATES_TO: "Relates to",
  DUPLICATES: "Duplicates",
  BLOCKS: "Blocks",
  CAUSED_BY: "Caused by",
};

export interface RelatedView {
  relationId: string;
  label: string;
  ticket: { key: string; title: string; status: { name: string; category: string } };
}

export function RelatedPanel({
  orgSlug,
  ticketId,
  related,
  canEdit,
}: {
  orgSlug: string;
  ticketId: string;
  related: RelatedView[];
  canEdit: boolean;
}) {
  const { run, pending } = useMutation();
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState<(typeof RELATION_TYPES)[number]>("RELATES_TO");
  const [key, setKey] = useState("");
  const [error, setError] = useState<string>();
  if (!canEdit && related.length === 0) return null;
  return (
    <Panel
      title="Related tickets"
      icon={Link2}
      action={
        canEdit && !adding ? (
          <Button variant="ghost" size="xs" onClick={() => setAdding(true)}>
            <Plus aria-hidden /> Link
          </Button>
        ) : null
      }
    >
      {related.length === 0 && !adding ? <p className="text-sm text-muted-foreground">None</p> : null}
      <ul className="grid grid-cols-1 gap-1.5">
        {related.map((r) => (
          <li key={r.relationId} className="grid min-w-0 grid-cols-1 gap-0.5 text-sm">
            <span className="text-xs text-muted-foreground">{r.label}</span>
            <div className="flex items-center gap-2">
              <Link href={`/o/${orgSlug}/tickets/${r.ticket.key}`} className="min-w-0 truncate hover:underline">
                <span className="font-mono text-xs">{r.ticket.key}</span> {r.ticket.title}
              </Link>
              <TicketStatusBadge
                name={r.ticket.status.name}
                category={r.ticket.status.category as Parameters<typeof TicketStatusBadge>[0]["category"]}
              />
              {canEdit ? (
                <button
                  type="button"
                  className="ml-auto shrink-0 rounded text-muted-foreground hover:text-foreground"
                  aria-label={`Remove link to ${r.ticket.key}`}
                  onClick={() => run(() => removeRelationAction(orgSlug, { relationId: r.relationId }))}
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {adding ? (
        <form
          className="mt-2 grid gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(undefined);
            const r = await run(() => addRelationAction(orgSlug, { ticketId, targetKey: key, type }), {
              onError: (err) => setError(err.fieldErrors?.targetKey?.[0] ?? err.message),
            });
            if (r.ok) {
              setKey("");
              setAdding(false);
            }
          }}
        >
          <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
            <SelectTrigger size="sm" className="w-full" aria-label="Link type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RELATION_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {RELATION_LABEL[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Ticket key, e.g. IT-000012"
            aria-label="Ticket key"
            aria-invalid={!!error}
            className="h-7"
          />
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending || !key.trim()}>
              Add link
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </Panel>
  );
}

// ── attachments ─────────────────────────────────────────────────────────

export function AttachmentsPanel({
  orgSlug,
  ticketId,
  attachments,
  currentUserId,
  canManageAll,
  canUpload,
}: {
  orgSlug: string;
  ticketId: string;
  attachments: (AttachmentView & { uploadedBy: { id: string; name: string }; visibility: string })[];
  currentUserId: string;
  canManageAll: boolean;
  canUpload: boolean;
}) {
  const { run } = useMutation();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onFiles(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    for (const file of Array.from(list)) {
      try {
        await uploadAttachment(orgSlug, ticketId, file);
        toast.success(`Uploaded ${file.name}`);
      } catch (e) {
        toast.error(`${file.name}: ${(e as Error).message}`);
      }
    }
    setBusy(false);
    if (input.current) input.current.value = "";
    await run(async () => ({ ok: true as const, data: null }));
  }

  return (
    <Panel
      title={`Files (${attachments.length})`}
      icon={Paperclip}
      action={
        canUpload ? (
          <>
            <input
              ref={input}
              type="file"
              multiple
              accept={ACCEPT_ATTRIBUTE}
              className="sr-only"
              id="ticket-files"
              aria-label="Upload files"
              onChange={(e) => void onFiles(e.target.files)}
            />
            <Button variant="ghost" size="xs" disabled={busy} onClick={() => input.current?.click()}>
              <Plus aria-hidden /> {busy ? "Uploading…" : "Upload"}
            </Button>
          </>
        ) : null
      }
    >
      {attachments.length === 0 ? <p className="text-sm text-muted-foreground">No files</p> : null}
      <ul className="grid grid-cols-1 gap-1.5">
        {attachments.map((a) => (
          <li key={a.id} className="flex items-center gap-2" data-testid="attachment-row">
            <AttachmentLink orgSlug={orgSlug} attachment={a} className="min-w-0" />
            {a.visibility === "INTERNAL" ? (
              <span className="shrink-0 text-[0.65rem] text-amber-700">internal</span>
            ) : null}
            {canManageAll || a.uploadedBy.id === currentUserId ? (
              <button
                type="button"
                className="ml-auto shrink-0 rounded text-muted-foreground hover:text-destructive"
                aria-label={`Delete ${a.fileName}`}
                onClick={() =>
                  run(() => deleteAttachmentAction(orgSlug, { attachmentId: a.id }), { success: "File removed" })
                }
              >
                <Trash2 className="size-3.5" />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
