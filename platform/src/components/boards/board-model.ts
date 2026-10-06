import type { TICKET_TYPE_LABELS } from "@/components/tickets/badges";

/** Pure board model shared by the board UI and its unit tests. */

export const COLUMNS = ["NEW", "OPEN", "IN_PROGRESS", "PENDING", "RESOLVED"] as const;
export type Column = (typeof COLUMNS)[number];

export const COLUMN_LABELS: Record<Column, string> = {
  NEW: "New",
  OPEN: "Open",
  IN_PROGRESS: "In Progress",
  PENDING: "Pending",
  RESOLVED: "Resolved",
};

/** JSON shape of a board (as served by /api/orgs/:slug/board). */
export interface BoardCardData {
  id: string;
  key: string;
  title: string;
  type: keyof typeof TICKET_TYPE_LABELS;
  version: number;
  dueAt: string | null;
  status: { id: string; name: string; category: string };
  priority: { key: string; name: string; level: number; color: string };
  assignee: { id: string; name: string } | null;
  team: { id: string; name: string } | null;
}
export interface BoardData {
  columns: { category: Column; total: number; cards: BoardCardData[] }[];
}

/** Pure optimistic update: move a card between columns, keeping urgency order. */
export function applyMove(board: BoardData, cardId: string, to: Column): BoardData {
  let moving: BoardCardData | undefined;
  const without = board.columns.map((col) => {
    const idx = col.cards.findIndex((c) => c.id === cardId);
    if (idx === -1) return col;
    moving = col.cards[idx];
    return { ...col, total: col.total - 1, cards: col.cards.filter((c) => c.id !== cardId) };
  });
  if (!moving) return board;
  const moved = { ...moving, status: { ...moving.status, category: to, name: COLUMN_LABELS[to] } };
  return {
    columns: without.map((col) =>
      col.category === to
        ? {
            ...col,
            total: col.total + 1,
            cards: [...col.cards, moved].sort((a, b) => a.priority.level - b.priority.level),
          }
        : col,
    ),
  };
}
