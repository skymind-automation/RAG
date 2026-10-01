# ADR-0013: Kanban columns are status categories; moves go through the workflow

**Status:** Accepted

## Context
Boards need drag-and-drop with optimistic updates that reconcile with the
server, an accessible alternative to dragging, and must not bypass workflow
rules. Organizations name their statuses differently (ADR-0007).

## Decision
- **Columns** are the status categories `NEW, OPEN, IN_PROGRESS, PENDING,
  RESOLVED`. Dropping a card in a column runs `moveTicket()`, which picks
  the first allowed transition into that category and delegates to
  `transitionTicket()`. Workflow rules, required resolutions, optimistic
  concurrency and audit all apply exactly as on the ticket page. Card order
  is derived (priority, then recency), with no manual ranking.
- **Optimistic updates** use TanStack Query: `onMutate` snapshots and moves
  the card locally, `onError` restores the snapshot, and `onSettled` always
  refetches. A required resolution opens a dialog and retries the move. A
  version conflict shows a warning and the refetched state.
- **Pointer** dragging uses dnd-kit. **Keyboard** moving is explicit: Space or
  Enter picks up a card's handle, ←/→ choose a column (highlighted and
  announced in a live region), Space or Enter drops, Escape cancels, and focus
  follows the card. Every card also has a "Move to…" menu. The first version
  used dnd-kit's geometry-based keyboard sensor, and an E2E test showed it
  dropping cards on the wrong column after the board auto-scrolled. Explicit
  key handling has no dependence on layout.
- **Refresh:** the board refetches every 30 s until server-sent events land
  in Phase 4.

## Alternatives considered
- **One column per status:** boards would differ per organization and grow
  unbounded.
- **Manual rank (fractional indexing):** useful for backlogs. It adds a
  write per reorder and conflict handling, so it's deferred until someone
  needs it.

## Consequences
- With several statuses in one category, a drop picks the first by workflow
  position. To reach a specific status, use the ticket page.
- Each column shows the 50 most urgent cards plus the total. Filters narrow it.
