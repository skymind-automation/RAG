# ADR-0015: Time-tracking invariants enforced by the database

**Status:** Accepted

## Context
Time tracking needs timers and manual entries, and must prevent overlapping
active timers.

## Decision
- **One running timer:** a partial unique index on
  `(organizationId, userId) WHERE endedAt IS NULL AND deletedAt IS NULL`
  allows at most one running timer per user per organization. Concurrent
  "start" clicks can't both succeed (integration test: three parallel starts
  → exactly one wins). Starting while a timer runs is a ConflictError unless
  the caller asks to switch, which stops the old one in the same transaction.
- **Shape:** CHECK constraints keep entries consistent. An open entry has no
  end and no duration; a closed entry is 0–24 h with `endedAt >= startedAt`.
  Manual entries are always closed.
- **24-hour cap:** a timer left running for more than 24 h is capped at 24 h
  when stopped, and the audit record says `capped: true`, so a forgotten
  timer can't silently bill days.
- **Visibility:** time is staff data. `time.track` (agents and up) logs
  time, `time.manage` (managers and up) deletes others' entries, and
  `reports.read` can view it. Requesters never see time entries or time
  events.

## Consequences
- Overlapping *manual* entries are allowed (people log retroactively).
  Reporting in Phase 4 can flag overlaps.
