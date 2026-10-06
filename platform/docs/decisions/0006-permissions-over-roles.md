# ADR-0006: Permissions are the unit of authorization

**Status:** Accepted

## Context
The spec requires permissions separate from roles, and extensibility.

## Decision
A typed `Permission` union (`tickets.read`, `members.invite`, …) and a
`ROLE_PERMISSIONS` map in `src/lib/permissions`. Call sites check
permissions only. Role *hierarchy* (`ROLE_RANK`) is used for exactly one
thing: who may grant or manage whom.

## Alternatives considered
- **Role checks at call sites:** every new role touches every call site.
- **Database-stored custom roles now:** more flexible, but more surface
  than Phase 1 needs. The design allows it: `resolveOrgContext` is the only
  place that turns a membership into a permission set, so custom roles become a
  lookup there.

## Consequences
- The client can import the same pure map to hide controls. The server
  re-checks every action.
- Viewers are least-privilege by default (no internal notes, no AI).
