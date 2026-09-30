import { orgRoute } from "@/server/actions/route";
import { createTicket, listTickets } from "@/server/tickets/ticket-service";

export const dynamic = "force-dynamic";

/** GET /api/orgs/:orgSlug/tickets?cursor=&limit=&statusCategory= */
export const GET = orgRoute("tickets.list", (ctx, request) => {
  const q = new URL(request.url).searchParams;
  return listTickets(ctx, {
    cursor: q.get("cursor") ?? undefined,
    limit: q.has("limit") ? Number(q.get("limit")) : undefined,
    statusCategory: q.get("statusCategory") ?? undefined,
  });
});

/** POST /api/orgs/:orgSlug/tickets — body validated by createTicketSchema. */
export const POST = orgRoute("tickets.create", async (ctx, request) => {
  const body: unknown = await request.json().catch(() => ({}));
  return createTicket(ctx, body);
});
