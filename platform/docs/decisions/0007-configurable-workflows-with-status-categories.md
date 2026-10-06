# ADR-0007: Configurable workflows whose statuses map to fixed categories

**Status:** Accepted

## Context
Workflows must be configurable per organization, but boards, SLA pausing
and reports need stable semantics.

## Decision
`Workflow → WorkflowStatus (category) → WorkflowTransition(from, to,
requiresResolution)`. Organizations name and add statuses freely, and each
maps to one of `NEW, OPEN, IN_PROGRESS, PENDING, RESOLVED, CLOSED`. All status
changes go through `transitionTicket()`, which validates the transition,
required fields and version, sets lifecycle timestamps by category, and audits.

## Alternatives considered
- **Hard-coded enum statuses:** not configurable.
- **Fully free-form statuses:** every consumer would need per-org mapping.

## Consequences
- SLA "pending pauses the clock" becomes `category = PENDING`, whatever the
  org calls it.
- Workflow admin UI (Phase 2) must keep exactly one initial status (the DB
  enforces at most one via a partial unique index).
