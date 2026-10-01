import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { KanbanBoard, type BoardData } from "@/components/boards/kanban-board";
import { PageHeader } from "@/components/common/page-header";
import { FilterBar } from "@/components/tickets/filter-bar";
import { ValidationError } from "@/lib/errors";
import { requireOrganizationPage } from "@/server/auth/context";
import { getBoard } from "@/server/boards/board-service";
import { getTicketFormOptions } from "@/server/tickets/ticket-config-service";

export const metadata: Metadata = { title: "Board" };

type Search = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function BoardsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<Search>;
}) {
  const { orgSlug } = await params;
  const sp = await searchParams;
  const ctx = await requireOrganizationPage(orgSlug);
  if (!ctx.permissions.has("tickets.read")) notFound();

  const filters = {
    teamId: first(sp.teamId),
    assigneeId: first(sp.assigneeId),
    priorityKey: first(sp.priorityKey),
    type: first(sp.type),
  };
  const filterKey = new URLSearchParams(
    Object.entries(filters).filter((e): e is [string, string] => Boolean(e[1])),
  ).toString();
  const board = await getBoard(ctx, filters).catch((err) => {
    if (err instanceof ValidationError) return getBoard(ctx, {});
    throw err;
  });
  const options = await getTicketFormOptions(ctx);

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <PageHeader
        title="Board"
        description="Open work by stage. Drag a card (or use its menu) to move it through the workflow."
      />
      <FilterBar
        show={{ search: false, state: false }}
        options={{ priorities: options.priorities, teams: options.teams, members: options.members, staff: true }}
      />
      <KanbanBoard
        orgSlug={orgSlug}
        // Same JSON shape the client refetches from /api/orgs/:slug/board.
        initialData={JSON.parse(JSON.stringify(board)) as BoardData}
        initialFilterKey={filterKey}
        canMove={ctx.permissions.has("tickets.transition")}
        timezone={ctx.organization.timezone}
      />
    </div>
  );
}
