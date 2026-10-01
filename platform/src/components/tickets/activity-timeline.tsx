import { Lock } from "lucide-react";
import { Markdown } from "@/components/common/markdown";
import { UserAvatar } from "@/components/common/user-avatar";
import { cn } from "@/lib/utils";
import type { TimelineItem } from "@/server/tickets/timeline-service";
import { AttachmentLink } from "./attachment-link";

/** Server-rendered activity: comments as cards, events as compact lines. */
export function ActivityTimeline({
  orgSlug,
  items,
  timezone,
}: {
  orgSlug: string;
  items: TimelineItem[];
  timezone: string;
}) {
  const fmt = (d: Date) => d.toLocaleString("en-US", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" });
  if (items.length === 0) return <p className="text-sm text-muted-foreground">No activity yet.</p>;
  return (
    <ol className="grid grid-cols-1 gap-3" aria-label="Activity">
      {items.map((item) =>
        item.kind === "event" ? (
          <li
            key={item.id}
            className="flex items-baseline gap-2 pl-2 text-xs text-muted-foreground"
            data-testid="timeline-event"
          >
            <span className="size-1.5 shrink-0 translate-y-[-1px] rounded-full bg-border" aria-hidden />
            <span>
              <span className="font-medium text-foreground">{item.actor}</span> {item.text}
            </span>
            <time className="ml-auto shrink-0" dateTime={item.at.toISOString()}>
              {fmt(item.at)}
            </time>
          </li>
        ) : (
          <li
            key={item.id}
            data-testid="timeline-comment"
            data-visibility={item.visibility}
            className={cn(
              "rounded-lg border p-3",
              item.visibility === "INTERNAL"
                ? "border-amber-300 bg-amber-50/60 dark:border-amber-700 dark:bg-amber-950/30"
                : "bg-card",
            )}
          >
            <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
              <UserAvatar name={item.author.name} className="size-6" />
              <span className="font-medium">{item.author.name}</span>
              {item.visibility === "INTERNAL" ? (
                <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[0.7rem] font-medium text-amber-900 dark:bg-amber-900/50 dark:text-amber-200">
                  <Lock className="size-3" aria-hidden /> Internal note
                </span>
              ) : null}
              <time className="ml-auto text-xs text-muted-foreground" dateTime={item.at.toISOString()}>
                {fmt(item.at)}
              </time>
            </div>
            <Markdown>{item.body}</Markdown>
            {item.mentions.length > 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Mentioned: {item.mentions.map((m) => m.name).join(", ")}
              </p>
            ) : null}
            {item.attachments.length > 0 ? (
              <ul className="mt-2 grid grid-cols-1 gap-1">
                {item.attachments.map((a) => (
                  <li key={a.id}>
                    <AttachmentLink orgSlug={orgSlug} attachment={a} />
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ),
      )}
    </ol>
  );
}
