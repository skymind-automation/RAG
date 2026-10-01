import { describe, expect, it } from "vitest";
import { applyMove, type BoardData } from "@/components/boards/board-model";
import { formatClock } from "@/lib/time/format";
import { formatDuration } from "@/server/time/time-service";

const card = (id: string, level: number, category = "NEW") => ({
  id,
  key: id,
  title: id,
  type: "TASK" as const,
  version: 1,
  dueAt: null,
  status: { id: "s", name: "x", category },
  priority: { key: `p${level}`, name: `P${level}`, level, color: "#000" },
  assignee: null,
  team: null,
});

const board = (): BoardData => ({
  columns: [
    { category: "NEW", total: 2, cards: [card("a", 1), card("b", 3)] },
    { category: "OPEN", total: 1, cards: [card("c", 2, "OPEN")] },
    { category: "IN_PROGRESS", total: 0, cards: [] },
    { category: "PENDING", total: 0, cards: [] },
    { category: "RESOLVED", total: 0, cards: [] },
  ],
});

describe("applyMove (optimistic board update)", () => {
  it("moves a card, keeps urgency order and adjusts totals without mutating input", () => {
    const before = board();
    const after = applyMove(before, "b", "OPEN");
    expect(after.columns[0]!.cards.map((c) => c.id)).toEqual(["a"]);
    expect(after.columns[0]!.total).toBe(1);
    expect(after.columns[1]!.cards.map((c) => c.id)).toEqual(["c", "b"]);
    expect(after.columns[1]!.total).toBe(2);
    expect(after.columns[1]!.cards[1]!.status.category).toBe("OPEN");
    expect(before.columns[0]!.cards).toHaveLength(2); // snapshot for rollback is untouched
  });

  it("is a no-op for unknown cards", () => {
    const b = board();
    expect(applyMove(b, "zzz", "OPEN")).toBe(b);
  });
});

describe("duration formatting", () => {
  it("formats clocks and durations", () => {
    expect(formatClock(0)).toBe("0:00:00");
    expect(formatClock(3725)).toBe("1:02:05");
    expect(formatDuration(59)).toBe("0m");
    expect(formatDuration(5400)).toBe("1h 30m");
  });
});
