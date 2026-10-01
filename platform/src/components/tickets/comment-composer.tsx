"use client";

import { AtSign, Loader2, Lock, MessageSquare, Paperclip, X } from "lucide-react";
import { useRef, useState } from "react";
import { addCommentAction } from "@/app/actions/tickets";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useMutation } from "@/hooks/use-mutation";
import { ACCEPT_ATTRIBUTE, formatBytes } from "@/lib/attachments";
import { cn } from "@/lib/utils";
import { uploadAttachment } from "./upload";

export interface MentionCandidate {
  id: string;
  name: string;
  canReadAll: boolean;
  canReadInternal: boolean;
}

type Visibility = "PUBLIC" | "INTERNAL";

interface PendingFile {
  localId: string;
  name: string;
  size: number;
  attachmentId?: string;
  error?: string;
}

/**
 * Reply / internal-note composer. Mention candidates are filtered to people
 * who can actually read the comment (the server enforces the same rule).
 * Files upload immediately, with the comment's visibility, and are attached
 * when the comment is posted.
 */
export function CommentComposer({
  orgSlug,
  ticketId,
  requesterId,
  canInternal,
  mentionCandidates,
}: {
  orgSlug: string;
  ticketId: string;
  requesterId: string;
  canInternal: boolean;
  mentionCandidates: MentionCandidate[];
}) {
  const [visibility, setVisibility] = useState<Visibility>("PUBLIC");
  const [body, setBody] = useState("");
  const [mentions, setMentions] = useState<{ id: string; name: string }[]>([]);
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string>();
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const { run, pending } = useMutation();
  const internal = visibility === "INTERNAL";

  const eligible = mentionCandidates.filter(
    (m) =>
      !mentions.some((x) => x.id === m.id) && (internal ? m.canReadInternal : m.canReadAll || m.id === requesterId),
  );

  function switchTo(v: Visibility) {
    setVisibility(v);
    // Drop mentions the new audience couldn't see; already-uploaded files
    // adopt the comment's visibility when it is posted.
    setMentions((ms) =>
      ms.filter((m) => {
        const c = mentionCandidates.find((x) => x.id === m.id);
        return c && (v === "INTERNAL" ? c.canReadInternal : c.canReadAll || c.id === requesterId);
      }),
    );
  }

  async function addFiles(list: FileList | null) {
    if (!list) return;
    for (const file of Array.from(list)) {
      const localId = `${file.name}-${file.size}-${Math.random()}`;
      setFiles((f) => [...f, { localId, name: file.name, size: file.size }]);
      setUploading((n) => n + 1);
      try {
        const attachmentId = await uploadAttachment(orgSlug, ticketId, file, visibility);
        setFiles((f) => f.map((x) => (x.localId === localId ? { ...x, attachmentId } : x)));
      } catch (e) {
        setFiles((f) => f.map((x) => (x.localId === localId ? { ...x, error: (e as Error).message } : x)));
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (fileInput.current) fileInput.current.value = "";
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    const r = await run(
      () =>
        addCommentAction(orgSlug, {
          ticketId,
          body,
          visibility,
          mentionUserIds: mentions.map((m) => m.id),
          attachmentIds: files.filter((f) => f.attachmentId).map((f) => f.attachmentId!),
        }),
      {
        success: internal ? "Internal note added" : "Reply sent",
        onError: (err) => setError(err.fieldErrors ? Object.values(err.fieldErrors)[0]?.[0] : err.message),
      },
    );
    if (r.ok) {
      setBody("");
      setMentions([]);
      setFiles([]);
    }
  }

  return (
    <form
      onSubmit={submit}
      className={cn(
        "grid gap-2 rounded-lg border p-3 transition-colors",
        internal ? "border-amber-300 bg-amber-50/60 dark:border-amber-700 dark:bg-amber-950/30" : "bg-card",
      )}
      aria-label={internal ? "Add internal note" : "Reply"}
    >
      {canInternal ? (
        <div role="tablist" aria-label="Comment type" className="flex gap-1">
          {(
            [
              ["PUBLIC", "Reply", MessageSquare],
              ["INTERNAL", "Internal note", Lock],
            ] as const
          ).map(([v, label, Icon]) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={visibility === v}
              onClick={() => switchTo(v)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
                visibility === v
                  ? "bg-background shadow-sm ring-1 ring-border"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" aria-hidden />
              {label}
            </button>
          ))}
          {internal ? (
            <span className="ml-auto self-center text-xs text-amber-800 dark:text-amber-300">
              Only staff can see this
            </span>
          ) : null}
        </div>
      ) : null}

      <label htmlFor="comment-body" className="sr-only">
        {internal ? "Internal note" : "Reply"}
      </label>
      <Textarea
        id="comment-body"
        ref={textarea}
        rows={4}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={internal ? "Write an internal note (Markdown)…" : "Write a reply (Markdown)…"}
        className="bg-background"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
        }}
      />

      {mentions.length > 0 || files.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Mentions and files">
          {mentions.map((m) => (
            <li
              key={m.id}
              className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"
            >
              @{m.name}
              <button
                type="button"
                aria-label={`Remove mention of ${m.name}`}
                onClick={() => setMentions((ms) => ms.filter((x) => x.id !== m.id))}
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
          {files.map((f) => (
            <li
              key={f.localId}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
                f.error ? "border-destructive/40 text-destructive" : "bg-background",
              )}
              title={f.error}
            >
              {!f.attachmentId && !f.error ? (
                <Loader2 className="size-3 animate-spin" aria-label="Uploading" />
              ) : (
                <Paperclip className="size-3" aria-hidden />
              )}
              {f.name} <span className="text-muted-foreground">{formatBytes(f.size)}</span>
              {f.error ? <span className="sr-only">: {f.error}</span> : null}
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                onClick={() => setFiles((fs) => fs.filter((x) => x.localId !== f.localId))}
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {files.some((f) => f.error) ? (
        <p role="alert" className="text-xs text-destructive">
          {files.find((f) => f.error)?.error}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={ACCEPT_ATTRIBUTE}
          className="sr-only"
          id="comment-files"
          onChange={(e) => void addFiles(e.target.files)}
        />
        <Button type="button" variant="ghost" size="sm" onClick={() => fileInput.current?.click()}>
          <Paperclip aria-hidden /> Attach
        </Button>
        {mentionCandidates.length > 0 ? (
          <Select
            value=""
            onValueChange={(id) => {
              const m = mentionCandidates.find((x) => x.id === id);
              if (!m) return;
              setMentions((ms) => [...ms, { id: m.id, name: m.name }]);
              setBody((b) => `${b}${b && !b.endsWith(" ") ? " " : ""}@${m.name} `);
              textarea.current?.focus();
            }}
          >
            <SelectTrigger size="sm" className="w-36" aria-label="Mention someone">
              <AtSign className="size-3.5" aria-hidden />
              <SelectValue placeholder="Mention" />
            </SelectTrigger>
            <SelectContent>
              {eligible.length === 0 ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">No one else can see this</div>
              ) : (
                eligible.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        ) : null}
        <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">Ctrl/⌘ + Enter to send</span>
        <Button type="submit" disabled={pending || uploading > 0 || !body.trim()}>
          {uploading > 0 ? "Uploading…" : internal ? "Add note" : "Send reply"}
        </Button>
      </div>
    </form>
  );
}
