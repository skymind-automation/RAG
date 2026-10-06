# ADR-0014: Calendar math in the organization's time zone

**Status:** Accepted

## Context
"Due today", "this week" and "overdue" must match the organization's
calendar. Phase 2 stored a date-only due date as UTC midnight, which is the
*previous evening* in America/Chicago: tickets appeared due a day early.

## Decision
- `lib/time/zoned.ts` does calendar math with `Intl` only (no date library):
  offsets, day and ISO-week ranges, and wall-time → instant conversion. It
  follows the Temporal API's `compatible` disambiguation: repeated times take
  the earlier instant, and skipped times shift forward by the gap.
- A date-only due date (`"2026-10-05"`) is stored as the last millisecond of
  that day in the organization's zone, so `dueAt < now` is exactly
  "overdue". Exact ISO instants are still accepted for integrations.
- Unit tests cover DST in both directions, 23- and 25-hour days, a zone whose
  midnight falls in a DST gap (America/Santiago), and half- and quarter-hour
  offsets (Asia/Kolkata, Pacific/Chatham).

## Alternatives considered
- **date-fns-tz / Luxon:** fine libraries. `Intl` covers what's needed with
  no dependency. The SLA engine (Phase 4) builds on the same module, and can
  swap in Temporal when it ships natively.

## Consequences
- Due dates entered before this change were midnight UTC. A one-off
  conversion is only needed for data created with the Phase 2 build (none in
  production).
- Per-user time zones (User.timezone) are stored but not yet used for
  display: the organization's zone is the shared reference for SLAs.
