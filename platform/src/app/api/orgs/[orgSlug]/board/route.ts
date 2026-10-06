import { orgRoute } from "@/server/actions/route";
import { getBoard } from "@/server/boards/board-service";

export const dynamic = "force-dynamic";

/** GET /api/orgs/:orgSlug/board?teamId=&assigneeId=&priorityKey=&type= */
export const GET = orgRoute("boards.read", (ctx, request) => {
  const q = new URL(request.url).searchParams;
  return getBoard(ctx, {
    teamId: q.get("teamId") ?? undefined,
    assigneeId: q.get("assigneeId") ?? undefined,
    priorityKey: q.get("priorityKey") ?? undefined,
    type: q.get("type") ?? undefined,
  });
});
