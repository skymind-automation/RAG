import { ShieldCheck, Ticket, UserPlus, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/common/page-header";
import { RoleBadge } from "@/components/common/role-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ROLE_DESCRIPTIONS } from "@/lib/permissions";
import { listAuditLogs } from "@/server/audit/audit-query";
import { requireOrganizationPage } from "@/server/auth/context";
import { getOrganizationOverview } from "@/server/organizations/organization-service";

export const metadata: Metadata = { title: "Overview" };

function Stat({
  label,
  value,
  icon: Icon,
  href,
}: {
  label: string;
  value: number;
  icon: typeof Ticket;
  href?: string;
}) {
  const body = (
    <Card className="h-full transition-colors hover:bg-muted/40">
      <CardContent className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="size-4" aria-hidden />
        </span>
        <div>
          <p className="text-2xl font-semibold tabular-nums">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
  return href ? (
    <Link href={href} className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {body}
    </Link>
  ) : (
    body
  );
}

export default async function OverviewPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrganizationPage(orgSlug);
  const stats = await getOrganizationOverview(ctx);
  const recent = ctx.permissions.has("audit.read") ? (await listAuditLogs(ctx, { limit: 8 })).items : [];
  const base = `/o/${orgSlug}`;
  const canReadTickets = ctx.permissions.has("tickets.read") || ctx.permissions.has("tickets.read_own");

  return (
    <div className="grid gap-6">
      <PageHeader
        title={ctx.organization.name}
        description={`Signed in as ${ctx.user.name}`}
        actions={<RoleBadge role={ctx.role} />}
      />

      <section aria-label="Summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label={ctx.permissions.has("tickets.read") ? "Open tickets" : "My open requests"}
          value={stats.openTickets}
          icon={Ticket}
          href={canReadTickets ? `${base}/tickets` : undefined}
        />
        <Stat
          label="Members"
          value={stats.memberCount}
          icon={Users}
          href={ctx.permissions.has("members.read") ? `${base}/members` : undefined}
        />
        <Stat
          label="Teams"
          value={stats.teamCount}
          icon={Users}
          href={ctx.permissions.has("teams.read") ? `${base}/teams` : undefined}
        />
        {ctx.permissions.has("members.invite") ? (
          <Stat label="Pending invitations" value={stats.pendingInvites} icon={UserPlus} href={`${base}/members`} />
        ) : null}
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">Recent activity</CardTitle>
            <CardDescription>
              {ctx.permissions.has("audit.read")
                ? "Latest audited actions in this organization."
                : "Activity history is visible to administrators."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing to show yet.</p>
            ) : (
              <ol className="grid gap-2 text-sm">
                {recent.map((e) => (
                  <li key={e.id} className="flex items-baseline gap-2">
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{e.action}</code>
                    <span className="truncate text-muted-foreground">{e.actor?.name ?? "System"}</span>
                    <time
                      className="ml-auto shrink-0 text-xs text-muted-foreground"
                      dateTime={e.createdAt.toISOString()}
                    >
                      {e.createdAt.toLocaleString("en-US", {
                        timeZone: ctx.organization.timezone,
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </time>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <ShieldCheck className="size-4 text-primary" aria-hidden />
              Your access
            </CardTitle>
            <CardDescription>{ROLE_DESCRIPTIONS[ctx.role]}</CardDescription>
          </CardHeader>
          <CardContent>
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">{ctx.permissions.size} permissions</summary>
              <ul className="mt-2 grid gap-1 font-mono text-xs">
                {[...ctx.permissions].sort().map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </details>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
