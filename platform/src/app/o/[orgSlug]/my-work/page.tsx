import { AlarmClock, CalendarDays, CalendarRange, Eye, Inbox, UserCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { PriorityBadge, TICKET_TYPE_LABELS, TicketStatusBadge } from "@/components/tickets/badges";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { requireOrganizationPage } from "@/server/auth/context";
import { formatDuration } from "@/server/time/time-service";
import {
  getMyTimeSummary,
  getMyWork,
  getMyWorkCounts,
  MY_WORK_VIEWS,
  type MyWorkView,
} from "@/server/work/my-work-service";

export const metadata: Metadata = { title: "My Work" };

const VIEWS: Record<MyWorkView, { label: string; icon: typeof Inbox; empty: string }> = {
  assigned: { label: "Assigned to me", icon: UserCheck, empty: "Nothing assigned to you is open." },
  today: { label: "Today", icon: CalendarDays, empty: "Nothing of yours is due today." },
  week: { label: "This week", icon: CalendarRange, empty: "Nothing of yours is due this week." },
  overdue: { label: "Overdue", icon: AlarmClock, empty: "Nothing overdue. Nice." },
  backlog: { label: "Backlog", icon: Inbox, empty: "No unassigned tickets in your teams." },
  watching: { label: "Watching", icon: Eye, empty: "You aren't watching any open tickets." },
};

export default async function MyWorkPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { orgSlug } = await params;
  const { view: rawView } = await searchParams;
  const ctx = await requireOrganizationPage(orgSlug);
  if (!ctx.permissions.has("tickets.update")) notFound();
  const view: MyWorkView = (MY_WORK_VIEWS as readonly string[]).includes(rawView ?? "")
    ? (rawView as MyWorkView)
    : "assigned";

  const now = new Date();
  const [counts, { items, truncated }, time] = await Promise.all([
    getMyWorkCounts(ctx, now),
    getMyWork(ctx, view, now),
    getMyTimeSummary(ctx, now),
  ]);
  const tz = ctx.organization.timezone;
  const base = `/o/${orgSlug}/my-work`;
  const Empty = VIEWS[view].icon;

  return (
    <div className="grid gap-4">
      <PageHeader
        title="My Work"
        description={`Dates follow the organization's time zone (${tz}).`}
        actions={
          ctx.permissions.has("time.track") ? (
            <div className="text-right text-xs text-muted-foreground" aria-label="Your logged time">
              <p>
                Today{" "}
                <span className="font-medium text-foreground tabular-nums">
                  {formatDuration(time.today.totalSeconds)}
                </span>
              </p>
              <p>
                This week{" "}
                <span className="font-medium text-foreground tabular-nums">
                  {formatDuration(time.week.totalSeconds)}
                </span>
                {time.week.billableSeconds ? ` · ${formatDuration(time.week.billableSeconds)} billable` : ""}
              </p>
            </div>
          ) : null
        }
      />
      <nav aria-label="My Work views" className="flex flex-wrap gap-1">
        {MY_WORK_VIEWS.map((v) => {
          const Icon = VIEWS[v].icon;
          const active = v === view;
          return (
            <Link
              key={v}
              href={v === "assigned" ? base : `${base}?view=${v}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active ? "border-primary bg-primary/5 font-medium text-primary" : "hover:bg-muted",
              )}
            >
              <Icon className="size-3.5" aria-hidden />
              {VIEWS[v].label}
              <span
                className={cn(
                  "rounded-full px-1.5 text-xs tabular-nums",
                  v === "overdue" && counts.overdue > 0
                    ? "bg-destructive text-white"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {counts[v]}
              </span>
            </Link>
          );
        })}
      </nav>

      {items.length === 0 ? (
        <EmptyState icon={Empty} title={VIEWS[view].empty} />
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Key</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Priority</TableHead>
                <TableHead>Due</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((t) => {
                const overdue = t.dueAt !== null && t.dueAt < now;
                return (
                  <TableRow key={t.id} data-testid="my-work-row" className="relative">
                    <TableCell className="font-mono text-xs">{t.key}</TableCell>
                    <TableCell>
                      <Link
                        href={`/o/${orgSlug}/tickets/${t.key}`}
                        className="block max-w-md truncate font-medium outline-none after:absolute after:inset-0 focus-visible:underline"
                      >
                        {t.title}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {TICKET_TYPE_LABELS[t.type]}
                        {t.assignee ? ` · ${t.assignee.name}` : " · Unassigned"}
                        {t.team ? ` · ${t.team.name}` : ""}
                      </p>
                    </TableCell>
                    <TableCell>
                      <TicketStatusBadge name={t.status.name} category={t.status.category} />
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <PriorityBadge {...t.priority} />
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-xs whitespace-nowrap",
                        overdue ? "font-medium text-destructive" : "text-muted-foreground",
                      )}
                    >
                      {t.dueAt
                        ? `${overdue ? "Overdue · " : ""}${t.dueAt.toLocaleDateString("en-US", { timeZone: tz, dateStyle: "medium" })}`
                        : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
      {truncated ? <p className="text-xs text-muted-foreground">Showing the 100 most urgent.</p> : null}
    </div>
  );
}
