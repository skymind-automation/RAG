import { ScrollText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listAuditLogs } from "@/server/audit/audit-query";
import { requireOrganizationPage } from "@/server/auth/context";

export const metadata: Metadata = { title: "Audit log" };

function summarize(metadata: unknown): string {
  if (!metadata || typeof metadata !== "object") return "";
  return Object.entries(metadata as Record<string, unknown>)
    .slice(0, 4)
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");
}

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { orgSlug } = await params;
  const { cursor } = await searchParams;
  const ctx = await requireOrganizationPage(orgSlug);
  if (!ctx.permissions.has("audit.read")) notFound();
  const { items, nextCursor } = await listAuditLogs(ctx, { cursor, limit: 50 });
  const tz = ctx.organization.timezone;

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Audit log"
        description="Append-only record of security-sensitive and business-critical actions."
      />
      {items.length === 0 ? (
        <EmptyState icon={ScrollText} title="No events" />
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead className="hidden lg:table-cell">Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    <time dateTime={e.createdAt.toISOString()}>
                      {e.createdAt.toLocaleString("en-US", { timeZone: tz, dateStyle: "short", timeStyle: "medium" })}
                    </time>
                  </TableCell>
                  <TableCell>
                    <code className="text-xs">{e.action}</code>
                  </TableCell>
                  <TableCell className="text-sm">{e.actor?.name ?? e.actorType.toLowerCase()}</TableCell>
                  <TableCell className="hidden max-w-md truncate text-xs text-muted-foreground lg:table-cell">
                    {summarize(e.metadata)}
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
            <Link href={`/o/${orgSlug}/audit`}>Newest</Link>
          </Button>
        ) : null}
        {nextCursor ? (
          <Button variant="outline" asChild>
            <Link href={`/o/${orgSlug}/audit?cursor=${nextCursor}`}>Older</Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
