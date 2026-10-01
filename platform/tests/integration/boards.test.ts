import { beforeEach, describe, expect, it } from "vitest";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import type { OrgContext } from "@/server/context";
import { getBoard, moveTicket } from "@/server/boards/board-service";
import { createTeam } from "@/server/teams/team-service";
import { setWorkflowTransition } from "@/server/tickets/ticket-config-service";
import { createTicket, getTicket } from "@/server/tickets/ticket-service";
import { joinAs, makeOrg, resetDb, statusByKey } from "./helpers";

describe("kanban boards", () => {
  let owner: OrgContext;
  let agent: OrgContext;
  let other: OrgContext;

  beforeEach(async () => {
    await resetDb();
    owner = await makeOrg("Acme IT", "acme");
    agent = await joinAs(owner, "AGENT");
    other = await makeOrg("Beta Corp", "beta");
  });

  const column = (board: Awaited<ReturnType<typeof getBoard>>, c: string) =>
    board.columns.find((x) => x.category === c)!;

  it("groups tickets into category columns, most urgent first", async () => {
    const low = await createTicket(owner, { type: "TASK", title: "low", priorityKey: "low" });
    const crit = await createTicket(owner, { type: "INCIDENT", title: "crit", priorityKey: "critical" });
    await createTicket(other, { type: "TASK", title: "beta only" });
    const board = await getBoard(agent);
    expect(board.columns.map((c) => c.category)).toEqual(["NEW", "OPEN", "IN_PROGRESS", "PENDING", "RESOLVED"]);
    expect(column(board, "NEW").cards.map((c) => c.id)).toEqual([crit.id, low.id]);
    expect(column(board, "NEW").total).toBe(2);
  });

  it("moves a card along allowed transitions only", async () => {
    const t = await createTicket(owner, { type: "INCIDENT", title: "move me" });
    const r = await moveTicket(agent, { ticketId: t.id, expectedVersion: 1, toCategory: "IN_PROGRESS" });
    expect(r).toMatchObject({ moved: true, version: 2, status: { category: "IN_PROGRESS" } });
    // NEW → PENDING isn't in the default workflow (from IN_PROGRESS it is).
    const t2 = await createTicket(owner, { type: "INCIDENT", title: "no shortcut" });
    await expect(moveTicket(agent, { ticketId: t2.id, expectedVersion: 1, toCategory: "PENDING" })).rejects.toThrow(
      /doesn't allow/,
    );
    // Same column is a no-op.
    expect(await moveTicket(agent, { ticketId: t.id, expectedVersion: 2, toCategory: "IN_PROGRESS" })).toMatchObject({
      moved: false,
    });
  });

  it("respects workflow edits, required resolutions and concurrency", async () => {
    const t = await createTicket(owner, { type: "INCIDENT", title: "resolve me" });
    await moveTicket(agent, { ticketId: t.id, expectedVersion: 1, toCategory: "OPEN" });
    await expect(
      moveTicket(agent, { ticketId: t.id, expectedVersion: 2, toCategory: "RESOLVED" }),
    ).rejects.toMatchObject({
      fieldErrors: { resolution: ["A resolution is required."] },
    });
    await moveTicket(agent, { ticketId: t.id, expectedVersion: 2, toCategory: "RESOLVED", resolution: "Fixed it" });
    expect((await getTicket(owner, t.id)).resolution).toBe("Fixed it");
    await expect(moveTicket(agent, { ticketId: t.id, expectedVersion: 2, toCategory: "OPEN" })).rejects.toBeInstanceOf(
      ConflictError,
    );

    // Disable NEW → OPEN and the board refuses that move.
    await setWorkflowTransition(owner, {
      fromStatusId: await statusByKey(owner, "new"),
      toStatusId: await statusByKey(owner, "open"),
      enabled: false,
    });
    const t2 = await createTicket(owner, { type: "TASK", title: "blocked" });
    await expect(moveTicket(agent, { ticketId: t2.id, expectedVersion: 1, toCategory: "OPEN" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("filters by team, assignee and priority", async () => {
    const team = await createTeam(owner, { name: "Network" });
    await createTicket(owner, {
      type: "INCIDENT",
      title: "net",
      teamId: team.id,
      assigneeId: agent.user.id,
      priorityKey: "high",
    });
    await createTicket(owner, { type: "INCIDENT", title: "other" });
    const titles = async (f: Record<string, string>) =>
      (await getBoard(agent, f)).columns.flatMap((c) => c.cards.map((x) => x.title));
    expect(await titles({ teamId: team.id })).toEqual(["net"]);
    expect(await titles({ assigneeId: "me" })).toEqual(["net"]);
    expect(await titles({ assigneeId: "unassigned" })).toEqual(["other"]);
    expect(await titles({ priorityKey: "high" })).toEqual(["net"]);
  });

  it("viewers can see the board but not move; requesters can't see it; tenants are isolated", async () => {
    const viewer = await joinAs(owner, "VIEWER");
    const requester = await joinAs(owner, "REQUESTER", "req");
    const t = await createTicket(owner, { type: "TASK", title: "visible task" });
    expect(column(await getBoard(viewer), "NEW").cards).toHaveLength(1);
    await expect(moveTicket(viewer, { ticketId: t.id, expectedVersion: 1, toCategory: "OPEN" })).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    await expect(getBoard(requester)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(moveTicket(other, { ticketId: t.id, expectedVersion: 1, toCategory: "OPEN" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect((await getBoard(other)).columns.every((c) => c.cards.length === 0)).toBe(true);
  });
});
