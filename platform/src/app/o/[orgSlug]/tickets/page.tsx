import { Plus, Ticket } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { PriorityBadge, TICKET_TYPE_LABELS, TicketStatusBadge } from "@/components/tickets/badges";
import { FilterBar } from "@/components/tickets/filter-bar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireOrganizationPage } from "@/server/auth/context";
import { getTicketFormOptions } from "@/server/tickets/ticket-config-service";
import { listTickets } from "@/server/tickets/ticket-service";
import { ValidationError } from "@/lib/errors";

export const metadata: Metadata = { title: "Tickets" };

type Search = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function TicketsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<Search>;
}) {
  const { orgSlug } = await params;
  const sp = await searchParams;
  const ctx = await requireOrganizationPage(orgSlug);
  if (!ctx.permissions.has("tickets.read") && !ctx.permissions.has("tickets.read_own")) notFound();

  const filters = {
    cursor: first(sp.cursor),
    q: first(sp.q),
    state: first(sp.state),
    assigneeId: first(sp.assigneeId),
    priorityKey: first(sp.priorityKey),
    type: first(sp.type),
    teamId: first(sp.teamId),
  };
  // Hand-edited URLs with bad values fall back to the unfiltered list.
  const result = await listTickets(ctx, { ...filters, limit: 25 }).catch((err) => {
    if (err instanceof ValidationError) return listTickets(ctx, { limit: 25 });
    throw err;
  });
  const { items, nextCursor } = result;
  const options = await getTicketFormOptions(ctx);
  const own = !ctx.permissions.has("tickets.read");
  const base = `/o/${orgSlug}/tickets`;
  const tz = ctx.organization.timezone;
  const nextParams = new URLSearchParams(
    Object.entries({ ...filters, cursor: nextCursor ?? undefined }).filter((e): e is [string, string] => Boolean(e[1])),
  );
  const filtered = Object.entries(filters).some(([k, v]) => k !== "cursor" && v);

  return (
    <div className="grid gap-4">
      <PageHeader
        title={own ? "My requests" : "Tickets"}
        description={own ? "Requests you've submitted." : "All tickets in this organization, newest first."}
        actions={
          ctx.permissions.has("tickets.create") ? (
            <Button asChild>
              <Link href={`${base}/new`}>
                <Plus aria-hidden />
                {own ? "New request" : "New ticket"}
              </Link>
            </Button>
          ) : null
        }
      />
      <FilterBar
        options={{
          priorities: options.priorities,
          teams: options.teams,
          members: options.members,
          staff: ctx.permissions.has("tickets.update"),
        }}
      />
      {items.length === 0 ? (
        <EmptyState
          icon={Ticket}
          title={filtered ? "No tickets match these filters" : "No tickets yet"}
          description={filtered ? "Try clearing a filter." : "Tickets created here will appear in this list."}
        />
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
                <TableRow key={t.id} data-testid="ticket-row" className="relative">
                  <TableCell className="font-mono text-xs">{t.key}</TableCell>
                  <TableCell>
                    {/* The whole row is clickable via this link's stretched hit area. */}
                    <Link
                      href={`${base}/${t.key}`}
                      className="block max-w-md truncate font-medium outline-none after:absolute after:inset-0 focus-visible:underline"
                    >
                      {t.title}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {TICKET_TYPE_LABELS[t.type]} · {t.requester.name}
                      {t.team ? ` · ${t.team.name}` : ""}
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
                  <TableCell className="hidden text-xs whitespace-nowrap text-muted-foreground lg:table-cell">
                    {t.createdAt.toLocaleDateString("en-US", { timeZone: tz, dateStyle: "medium" })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <div className="flex gap-2">
        {filters.cursor ? (
          <Button variant="outline" asChild>
            <Link href={base}>Newest</Link>
          </Button>
        ) : null}
        {nextCursor ? (
          <Button variant="outline" asChild>
            <Link href={`${base}?${nextParams}`}>Older</Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
