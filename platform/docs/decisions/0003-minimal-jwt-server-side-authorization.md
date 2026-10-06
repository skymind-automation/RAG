# ADR-0003: Minimal JWT; authorization state is read per request

**Status:** Accepted

## Context
Auth.js Credentials requires JWT sessions. The spec forbids placing mutable
authorization state in long-lived tokens and requires immediate effect for
membership changes.

## Decision
The token carries only `sub` (user id) and `sv` (the user's
`sessionVersion` at issue). Each request loads the user (active, not
deleted, same `sessionVersion`) and the membership for the addressed
organization. Role, permissions and active organization are never in the
token. Bumping `sessionVersion` revokes every session.

## Alternatives considered
- **Database sessions:** not supported by Auth.js with Credentials without
  custom plumbing. It would give the same revocation property at similar
  cost.
- **Role/org claims in the JWT:** stale for up to the token lifetime.
  Rejected by the spec.

## Consequences
- Two indexed lookups per request (user by PK, membership by unique pair),
  memoised per request with React `cache`.
- Deactivation, removal and role changes apply on the next request (tested).
- If Redis rate limiting is down, login fails open (documented), but
  authorization always fails closed.
