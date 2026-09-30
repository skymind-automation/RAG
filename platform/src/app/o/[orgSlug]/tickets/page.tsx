import { Ticket } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { PriorityBadge, TICKET_TYPE_LABELS, TicketStatusBadge } from "@/components/tickets/badges";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireOrganizationPage } from "@/server/auth/context";
import { listTickets } from "@/server/tickets/ticket-service";

export const metadata: Metadata = { title: "Tickets" };

/**
 * Read-only ticket list over the Phase 1 ticket domain. Creation, detail,
 * comments and transitions get their UI in Phase 2; the services and their
 * authorization already exist and are tested.
 */
export default async function TicketsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { orgSlug } = await params;
  const { cursor } = await searchParams;
  const ctx = await requireOrganizationPage(orgSlug);
  if (!ctx.permissions.has("tickets.read") && !ctx.permissions.has("tickets.read_own")) notFound();
  const { items, nextCursor } = await listTickets(ctx, { cursor, limit: 25 });
  const own = !ctx.permissions.has("tickets.read");
  const tz = ctx.organization.timezone;

  return (
    <div className="grid gap-6">
      <PageHeader
        title={own ? "My requests" : "Tickets"}
        description={own ? "Requests you've submitted." : "All tickets in this organization, newest first."}
      />
      {items.length === 0 ? (
        <EmptyState icon={Ticket} title="No tickets yet" description="Tickets created here will appear in this list." />
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Key</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Priority</TableHead>
                <TableHead className="hidden lg:table-cell">Assignee</TableHead>
                <TableHead className="hidden lg:table-cell">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((t) => (
                <TableRow key={t.id} data-testid="ticket-row">
                  <TableCell className="font-mono text-xs">{t.key}</TableCell>
                  <TableCell>
                    <p className="max-w-md truncate font-medium">{t.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {TICKET_TYPE_LABELS[t.type]} · {t.requester.name}
                    </p>
                  </TableCell>
                  <TableCell>
                    <TicketStatusBadge name={t.status.name} category={t.status.category} />
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <PriorityBadge {...t.priority} />
                  </TableCell>
                  <TableCell className="hidden text-sm lg:table-cell">
                    {t.assignee?.name ?? <span className="text-muted-foreground">Unassigned</span>}
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap text-xs text-muted-foreground lg:table-cell">
                    {t.createdAt.toLocaleDateString("en-US", { timeZone: tz, dateStyle: "medium" })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <div className="flex gap-2">
        {cursor ? (
          <Button variant="outline" asChild>
            <Link href={`/o/${orgSlug}/tickets`}>Newest</Link>
          </Button>
        ) : null}
        {nextCursor ? (
          <Button variant="outline" asChild>
            <Link href={`/o/${orgSlug}/tickets?cursor=${nextCursor}`}>Older</Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
