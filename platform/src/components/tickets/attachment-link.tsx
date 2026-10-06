"use client";

import { Download, FileText, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { getDownloadUrlAction } from "@/app/actions/tickets";
import { formatBytes } from "@/lib/attachments";
import { cn } from "@/lib/utils";

export interface AttachmentView {
  id: string;
  fileName: string;
  sizeBytes: number;
  status: string;
}

/** Fetches a fresh 60-second URL on click; nothing long-lived is ever in the DOM. */
export function AttachmentLink({
  orgSlug,
  attachment,
  className,
}: {
  orgSlug: string;
  attachment: AttachmentView;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  if (attachment.status !== "AVAILABLE") {
    const quarantined = attachment.status === "QUARANTINED";
    return (
      <span className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
        {quarantined ? (
          <ShieldAlert className="size-3.5 text-destructive" aria-hidden />
        ) : (
          <FileText className="size-3.5" aria-hidden />
        )}
        {attachment.fileName} — {quarantined ? "blocked by malware scan" : "scanning…"}
      </span>
    );
  }
  return (
    <button
      type="button"
      disabled={busy}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded text-left text-xs text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        className,
      )}
      onClick={async () => {
        setBusy(true);
        const r = await getDownloadUrlAction(orgSlug, { attachmentId: attachment.id });
        setBusy(false);
        if (!r.ok) return toast.error(r.error.message);
        window.location.assign(r.data.url);
      }}
    >
      <Download className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{attachment.fileName}</span>
      <span className="shrink-0 text-muted-foreground">({formatBytes(attachment.sizeBytes)})</span>
    </button>
  );
}
