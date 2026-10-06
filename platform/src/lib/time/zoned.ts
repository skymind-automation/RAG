/**
 * Timezone-correct calendar math with only the platform Intl API.
 *
 * "Today", "this week" and "due on 5 Oct" mean the organization's calendar,
 * not UTC's and not the server's. Every helper takes an IANA zone and
 * handles DST transitions and non-hour offsets (Asia/Kolkata +5:30,
 * Pacific/Chatham +12:45).
 */

export interface WallDate {
  year: number;
  month: number; // 1-12
  day: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

interface ZonedParts extends WallDate {
  hour: number;
  minute: number;
  second: number;
  /** 0 = Monday … 6 = Sunday (ISO order). */
  isoWeekday: number;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    isoWeekday: WEEKDAYS.indexOf(parts.weekday ?? "Mon"),
  };
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds (east positive). */
export function offsetMs(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The instant at which the wall clock in `timeZone` reads `wall` at hh:mm.
 * Follows Temporal's "compatible" disambiguation: a time that occurs twice
 * (fall-back) resolves to the earlier instant; a time skipped by a DST gap
 * (spring-forward) is shifted forward by the gap length (02:30 → 03:30).
 */
export function zonedTimeToUtc(wall: WallDate, timeZone: string, hour = 0, minute = 0): Date {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, hour, minute);
  const before = offsetMs(new Date(naive - 12 * 3600_000), timeZone);
  const after = offsetMs(new Date(naive + 12 * 3600_000), timeZone);
  const matches = (t: number) => {
    const p = zonedParts(new Date(t), timeZone);
    return (
      p.year === wall.year && p.month === wall.month && p.day === wall.day && p.hour === hour && p.minute === minute
    );
  };
  const candidates = [naive - before, naive - after].filter(matches).sort((a, b) => a - b);
  // No candidate = inside a gap: the pre-transition offset lands after the gap.
  return new Date(candidates[0] ?? naive - before);
}

export function wallDateOf(instant: Date, timeZone: string): WallDate {
  const { year, month, day } = zonedParts(instant, timeZone);
  return { year, month, day };
}

export function addDays(wall: WallDate, days: number): WallDate {
  const d = new Date(Date.UTC(wall.year, wall.month - 1, wall.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function startOfDay(instant: Date, timeZone: string): Date {
  return zonedTimeToUtc(wallDateOf(instant, timeZone), timeZone);
}

/** [start, end) of the calendar day containing `instant`. */
export function dayRange(instant: Date, timeZone: string): { start: Date; end: Date } {
  const wall = wallDateOf(instant, timeZone);
  return { start: zonedTimeToUtc(wall, timeZone), end: zonedTimeToUtc(addDays(wall, 1), timeZone) };
}

/** [Monday 00:00, next Monday 00:00) of the ISO week containing `instant`. */
export function weekRange(instant: Date, timeZone: string): { start: Date; end: Date } {
  const p = zonedParts(instant, timeZone);
  const monday = addDays({ year: p.year, month: p.month, day: p.day }, -p.isoWeekday);
  return { start: zonedTimeToUtc(monday, timeZone), end: zonedTimeToUtc(addDays(monday, 7), timeZone) };
}

export function parseWallDate(s: string): WallDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const wall = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  const check = new Date(Date.UTC(wall.year, wall.month - 1, wall.day));
  return check.getUTCMonth() + 1 === wall.month && check.getUTCDate() === wall.day ? wall : null;
}

export function formatWallDate(w: WallDate): string {
  return `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
}

/**
 * A due *date* means "by the end of that day in the organization's zone".
 * Stored as the last millisecond of that day so `dueAt < now` is exactly
 * "overdue".
 */
export function endOfWallDay(wall: WallDate, timeZone: string): Date {
  return new Date(zonedTimeToUtc(addDays(wall, 1), timeZone).getTime() - 1);
}
