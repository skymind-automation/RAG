import { describe, expect, it } from "vitest";
import {
  dayRange,
  endOfWallDay,
  formatWallDate,
  offsetMs,
  parseWallDate,
  wallDateOf,
  weekRange,
  zonedTimeToUtc,
} from "@/lib/time/zoned";

const iso = (d: Date) => d.toISOString();

describe("zoned calendar math", () => {
  it("computes offsets including half and quarter hours", () => {
    const t = new Date("2026-06-01T12:00:00Z");
    expect(offsetMs(t, "UTC")).toBe(0);
    expect(offsetMs(t, "America/Chicago")).toBe(-5 * 3600_000); // CDT
    expect(offsetMs(t, "Asia/Kolkata")).toBe(5.5 * 3600_000);
    expect(offsetMs(t, "Pacific/Chatham")).toBe(12.75 * 3600_000); // winter in NZ
  });

  it("finds day boundaries in the organization's zone", () => {
    // 03:00 UTC on 1 Oct is still 30 Sep in Chicago.
    const t = new Date("2026-10-01T03:00:00Z");
    expect(formatWallDate(wallDateOf(t, "America/Chicago"))).toBe("2026-09-30");
    const { start, end } = dayRange(t, "America/Chicago");
    expect(iso(start)).toBe("2026-09-30T05:00:00.000Z");
    expect(iso(end)).toBe("2026-10-01T05:00:00.000Z");
    expect(iso(dayRange(t, "Asia/Kolkata").start)).toBe("2026-09-30T18:30:00.000Z");
  });

  it("handles DST transitions (23- and 25-hour days)", () => {
    // US spring forward: 8 Mar 2026. Fall back: 1 Nov 2026.
    const spring = dayRange(new Date("2026-03-08T18:00:00Z"), "America/Chicago");
    expect((spring.end.getTime() - spring.start.getTime()) / 3600_000).toBe(23);
    const fall = dayRange(new Date("2026-11-01T18:00:00Z"), "America/Chicago");
    expect((fall.end.getTime() - fall.start.getTime()) / 3600_000).toBe(25);
    const london = dayRange(new Date("2026-03-29T12:00:00Z"), "Europe/London");
    expect(iso(london.start)).toBe("2026-03-29T00:00:00.000Z");
    expect(iso(london.end)).toBe("2026-03-29T23:00:00.000Z");
  });

  it("resolves skipped and repeated wall times like Temporal's compatible mode", () => {
    // 02:30 doesn't exist in Chicago on 8 Mar 2026 → 03:30 CDT (Temporal "compatible").
    const t = zonedTimeToUtc({ year: 2026, month: 3, day: 8 }, "America/Chicago", 2, 30);
    expect(iso(t)).toBe("2026-03-08T08:30:00.000Z");
    // 01:30 happens twice on 1 Nov 2026 → the earlier (CDT) one.
    expect(iso(zonedTimeToUtc({ year: 2026, month: 11, day: 1 }, "America/Chicago", 1, 30))).toBe(
      "2026-11-01T06:30:00.000Z",
    );
    // Santiago springs forward at midnight: the day starts at 01:00 local.
    const santiago = dayRange(new Date("2026-09-06T15:00:00Z"), "America/Santiago");
    expect(iso(santiago.start)).toBe("2026-09-06T04:00:00.000Z");
  });

  it("weeks start on Monday in the zone", () => {
    // Sunday 4 Oct 2026, 23:00 in Chicago (= Monday 04:00 UTC).
    const { start, end } = weekRange(new Date("2026-10-05T04:00:00Z"), "America/Chicago");
    expect(iso(start)).toBe("2026-09-28T05:00:00.000Z");
    expect(iso(end)).toBe("2026-10-05T05:00:00.000Z");
  });

  it("due dates mean the end of that day locally", () => {
    const due = endOfWallDay({ year: 2026, month: 10, day: 5 }, "America/Chicago");
    expect(iso(due)).toBe("2026-10-06T04:59:59.999Z");
    expect(formatWallDate(wallDateOf(due, "America/Chicago"))).toBe("2026-10-05");
  });

  it("parses only real calendar dates", () => {
    expect(parseWallDate("2026-02-28")).toEqual({ year: 2026, month: 2, day: 28 });
    expect(parseWallDate("2026-02-30")).toBeNull();
    expect(parseWallDate("2026-2-3")).toBeNull();
  });
});
