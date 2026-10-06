import type { AttachmentStatus, CommentVisibility } from "@prisma/client";
import { scopedDb } from "@/lib/db/tenant";
import { NotFoundError } from "@/lib/errors";
import { requireAnyPermission } from "@/server/auth/resolve";
import type { OrgContext } from "@/server/context";
import { RELATION_LABELS } from "./relation-service";
import { canSeeInternal, readScope } from "./ticket-access";

/**
 * Activity timeline: comments and audited ticket events, merged in time
 * order. Built from the audit log (the source of truth for "what happened"),
 * rendered as human sentences on the server so the client never interprets
 * raw audit metadata.
 *
 * Requesters see public comments plus creation and status changes only;
 * routing, internal notes, internal files and staff-only events are never
 * sent to them.
 */

const REQUESTER_VISIBLE_EVENTS = new Set(["ticket.created", "ticket.status_changed"]);
const HIDDEN_EVENTS = new Set(["ticket.comment_added", "attachment.downloaded", "attachment.upload_requested"]);

export interface TimelineAttachment {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  status: AttachmentStatus;
}

export type TimelineItem =
  | {
      kind: "comment";
      id: string;
      at: Date;
      author: { id: string; name: string };
      body: string;
      visibility: CommentVisibility;
      mentions: { id: string; name: string }[];
      attachments: TimelineAttachment[];
    }
  | { kind: "event"; id: string; at: Date; actor: string; text: string; action: string };

type Meta = Record<string, unknown>;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function minutes(v: unknown): string {
  const s = typeof v === "number" ? v : 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function describe(action: string, m: Meta, names: Map<string, string>): string | null {
  const who = (id: unknown) => (typeof id === "string" ? (names.get(id) ?? "a former member") : "nobody");
  switch (action) {
    case "ticket.created":
      return "created the ticket";
    case "ticket.status_changed":
      return `changed status from ${str(m.from)} to ${str(m.to)}`;
    case "ticket.assigned":
      return m.to ? `assigned the ticket to ${who(m.to)}` : "unassigned the ticket";
    case "ticket.priority_changed":
      return `changed priority from ${str(m.from)} to ${str(m.to)}`;
    case "ticket.updated":
      return `updated ${Array.isArray(m.fields) ? m.fields.join(", ") : "the ticket"}`;
    case "ticket.relation_added": {
      const t = str(m.type) as keyof typeof RELATION_LABELS;
      return `linked ${str(m.target)} (${RELATION_LABELS[t]?.outgoing.toLowerCase() ?? "related"})`;
    }
    case "ticket.relation_removed":
      return `removed the link to ${str(m.target)}`;
    case "ticket.watcher_added":
      return `added ${who(m.userId)} as a watcher`;
    case "ticket.watcher_removed":
      return `removed ${who(m.userId)} as a watcher`;
    case "attachment.uploaded":
      return `attached ${str(m.fileName)}`;
    case "attachment.deleted":
      return `removed the file ${str(m.fileName)}`;
    case "attachment.quarantined":
      return `had ${str(m.fileName)} quarantined by the malware scanner`;
    case "time.timer_started":
      return "started a timer";
    case "time.timer_stopped":
      return `stopped a timer after ${minutes(m.durationSeconds)}${m.capped ? " (capped at 24h)" : ""}`;
    case "time.entry_logged":
      return `logged ${minutes(m.durationSeconds)}${m.billable ? " (billable)" : ""}`;
    case "time.entry_deleted":
      return `removed a time entry of ${minutes(m.durationSeconds)}`;
    case "ticket.deleted":
      return "deleted the ticket";
    default:
      return null;
  }
}

export async function getTicketTimeline(ctx: OrgContext, ticketId: string): Promise<TimelineItem[]> {
  requireAnyPermission(ctx, ["tickets.read", "tickets.read_own"]);
  const db = scopedDb(ctx.organization.id);
  const ticket = await db.ticket.findFirst({
    where: { AND: [readScope(ctx), { id: ticketId }] },
    select: { id: true },
  });
  if (!ticket) throw new NotFoundError("Ticket not found.");
  const internal = canSeeInternal(ctx);

  const [comments, events] = await Promise.all([
    db.comment.findMany({
      where: { ticketId: ticket.id, deletedAt: null, ...(internal ? {} : { visibility: "PUBLIC" as const }) },
      select: {
        id: true,
        body: true,
        visibility: true,
        createdAt: true,
        author: { select: { id: true, name: true } },
        mentions: { select: { user: { select: { id: true, name: true } } } },
        attachments: {
          where: {
            deletedAt: null,
            status: { in: ["AVAILABLE", "PENDING_SCAN", "QUARANTINED"] },
            ...(internal ? {} : { visibility: "PUBLIC" as const }),
          },
          select: { id: true, fileName: true, contentType: true, sizeBytes: true, status: true },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    db.auditLog.findMany({
      where: { entityType: "ticket", entityId: ticket.id },
      select: { id: true, action: true, metadata: true, createdAt: true, actor: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const visibleEvents = events.filter(
    (e) => !HIDDEN_EVENTS.has(e.action) && (internal || REQUESTER_VISIBLE_EVENTS.has(e.action)),
  );

  // Resolve user ids referenced in event metadata (assignment, watchers) to names.
  const ids = new Set<string>();
  for (const e of visibleEvents) {
    const m = (e.metadata ?? {}) as Meta;
    for (const k of ["to", "from", "userId"]) if (typeof m[k] === "string") ids.add(m[k] as string);
  }
  const names = new Map<string, string>();
  if (ids.size > 0) {
    const members = await db.organizationMembership.findMany({
      where: { userId: { in: [...ids] } },
      select: { user: { select: { id: true, name: true } } },
    });
    for (const m of members) names.set(m.user.id, m.user.name);
  }

  const items: TimelineItem[] = [
    ...comments.map((c) => ({
      kind: "comment" as const,
      id: c.id,
      at: c.createdAt,
      author: c.author,
      body: c.body,
      visibility: c.visibility,
      mentions: c.mentions.map((m) => m.user),
      attachments: c.attachments,
    })),
    ...visibleEvents.flatMap((e) => {
      const text = describe(e.action, (e.metadata ?? {}) as Meta, names);
      return text
        ? [
            {
              kind: "event" as const,
              id: e.id,
              at: e.createdAt,
              actor: e.actor?.name ?? "System",
              text,
              action: e.action,
            },
          ]
        : [];
    }),
  ];
  return items.sort((a, b) => a.at.getTime() - b.at.getTime() || (a.kind === "event" ? -1 : 1));
}
