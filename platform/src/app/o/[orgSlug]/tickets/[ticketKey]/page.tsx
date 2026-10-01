import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Markdown } from "@/components/common/markdown";
import { ActivityTimeline } from "@/components/tickets/activity-timeline";
import { CommentComposer } from "@/components/tickets/comment-composer";
import { AttachmentsPanel, RelatedPanel, WatchersPanel } from "@/components/tickets/side-panels";
import { TicketHeader } from "@/components/tickets/ticket-header";
import { TicketProperties } from "@/components/tickets/ticket-properties";
import { DescriptionEditor } from "@/components/tickets/description-editor";
import { NotFoundError } from "@/lib/errors";
import { listTicketAttachments } from "@/server/attachments/attachment-service";
import { requireOrganizationPage } from "@/server/auth/context";
import { listRelations } from "@/server/tickets/relation-service";
import { getTicketFormOptions } from "@/server/tickets/ticket-config-service";
import { availableTransitions, getTicket } from "@/server/tickets/ticket-service";
import { getTicketTimeline } from "@/server/tickets/timeline-service";

type Params = Promise<{ orgSlug: string; ticketKey: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { ticketKey } = await params;
  return { title: decodeURIComponent(ticketKey).toUpperCase() };
}

export default async function TicketPage({ params }: { params: Params }) {
  const { orgSlug, ticketKey } = await params;
  const ctx = await requireOrganizationPage(orgSlug);
  const ticket = await getTicket(ctx, decodeURIComponent(ticketKey)).catch((err) => {
    if (err instanceof NotFoundError) notFound();
    throw err;
  });

  const perms = ctx.permissions;
  const staff = perms.has("tickets.update");
  const [timeline, related, attachments, options, transitions] = await Promise.all([
    getTicketTimeline(ctx, ticket.id),
    listRelations(ctx, ticket.id),
    listTicketAttachments(ctx, ticket.id),
    getTicketFormOptions(ctx),
    perms.has("tickets.transition") ? availableTransitions(ctx, ticket.id) : Promise.resolve([]),
  ]);
  const tz = ctx.organization.timezone;

  return (
    <div className="grid gap-4">
      <Link
        href={`/o/${orgSlug}/tickets`}
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden /> {staff ? "Tickets" : "My requests"}
      </Link>
      <TicketHeader
        orgSlug={orgSlug}
        ticket={{
          id: ticket.id,
          key: ticket.key,
          title: ticket.title,
          version: ticket.version,
          resolution: ticket.resolution,
          status: ticket.status,
        }}
        transitions={transitions}
        can={{ update: staff, transition: perms.has("tickets.transition"), delete: perms.has("tickets.delete") }}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid min-w-0 grid-cols-1 content-start gap-4">
          <section aria-label="Description" className="rounded-lg border bg-card p-4">
            {staff ? (
              <DescriptionEditor
                orgSlug={orgSlug}
                ticketId={ticket.id}
                version={ticket.version}
                description={ticket.description}
              />
            ) : ticket.description ? (
              <Markdown>{ticket.description}</Markdown>
            ) : (
              <p className="text-sm text-muted-foreground">No description.</p>
            )}
          </section>

          {ticket.resolution ? (
            <section
              aria-label="Resolution"
              className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-900 dark:bg-emerald-950/30"
            >
              <h2 className="mb-1 text-xs font-medium tracking-wider text-emerald-800 uppercase dark:text-emerald-300">
                Resolution
              </h2>
              <Markdown>{ticket.resolution}</Markdown>
            </section>
          ) : null}

          <section aria-label="Activity" className="grid gap-3">
            <h2 className="text-sm font-semibold">Activity</h2>
            <ActivityTimeline orgSlug={orgSlug} items={timeline} timezone={tz} />
            {perms.has("tickets.comment") ? (
              <CommentComposer
                orgSlug={orgSlug}
                ticketId={ticket.id}
                requesterId={ticket.requester.id}
                canInternal={perms.has("tickets.comment_internal")}
                mentionCandidates={
                  staff
                    ? options.members
                        .filter((m) => m.id !== ctx.user.id)
                        .map((m) => ({
                          id: m.id,
                          name: m.name,
                          canReadAll: m.canReadAll,
                          canReadInternal: m.canReadInternal,
                        }))
                    : []
                }
              />
            ) : null}
          </section>
        </div>

        <aside className="grid min-w-0 grid-cols-1 content-start gap-3" aria-label="Ticket sidebar">
          <TicketProperties
            orgSlug={orgSlug}
            timezone={tz}
            can={{ update: staff, assign: perms.has("tickets.assign") }}
            options={options}
            ticket={{
              id: ticket.id,
              version: ticket.version,
              type: ticket.type,
              priority: ticket.priority,
              category: ticket.category,
              team: ticket.team,
              assignee: ticket.assignee,
              requester: ticket.requester,
              createdBy: ticket.createdBy,
              source: ticket.source,
              dueAt: ticket.dueAt?.toISOString() ?? null,
              createdAt: ticket.createdAt.toISOString(),
              resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
              customFields: (ticket.customFields ?? {}) as Record<string, string | number | boolean>,
            }}
          />
          <AttachmentsPanel
            orgSlug={orgSlug}
            ticketId={ticket.id}
            attachments={attachments}
            currentUserId={ctx.user.id}
            canManageAll={staff}
            canUpload={perms.has("tickets.comment")}
          />
          <RelatedPanel orgSlug={orgSlug} ticketId={ticket.id} related={related} canEdit={staff} />
          <WatchersPanel
            orgSlug={orgSlug}
            ticketId={ticket.id}
            watchers={ticket.watchers}
            currentUserId={ctx.user.id}
            candidates={staff ? options.members.filter((m) => m.canReadAll || m.id === ticket.requester.id) : []}
          />
        </aside>
      </div>
    </div>
  );
}
