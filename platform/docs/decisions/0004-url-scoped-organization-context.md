# ADR-0004: The active organization comes from the URL

**Status:** Accepted

## Context
Users belong to many organizations and need to switch. The spec requires
the organization to be resolved server-side and never trusted from client
input without independent verification.

## Decision
All tenant routes live under `/o/<slug>` (pages) and `/api/orgs/<slug>`
(API). The slug only selects which membership to look up. Authority comes
from an ACTIVE membership row, re-read on every request. Non-members get
404. `User.lastActiveOrganizationId` is only a landing preference, updated by
the switcher.

## Alternatives considered
- **Active org in the session/JWT:** stale claims, one active org per
  browser (tabs interfere), and a switch requires re-issuing the token.
- **Active org in a cookie:** same tab-interference problem, and invisible
  in URLs, so shared links break.
- **Subdomains per org:** attractive for branding later. It needs wildcard
  TLS and DNS, and the resolution logic is identical, so it can be added on top.

## Consequences
- Multi-tab, multi-org work is natural, and links are shareable and
  self-describing.
- Every page is dynamic (per-request membership check). Acceptable for an
  authenticated app.
