# Architecture decision records

Format: Context · Decision · Alternatives considered · Consequences.
Superseded ADRs stay, marked as superseded.

| # | Decision |
| --- | --- |
| [0001](0001-platform-alongside-delta-rag.md) | Build the platform in `platform/`, alongside the existing Django Delta RAG service |
| [0002](0002-nextjs-monolith-with-extractable-domain.md) | Next.js monolith with a transport-independent domain layer (no NestJS yet) |
| [0003](0003-minimal-jwt-server-side-authorization.md) | Minimal JWT (`sub`, `sv`), with all authorization state read server-side per request |
| [0004](0004-url-scoped-organization-context.md) | Active organization comes from the URL and is verified against membership |
| [0005](0005-layered-tenant-isolation.md) | Three-layer tenant isolation; Postgres RLS deferred |
| [0006](0006-permissions-over-roles.md) | Permissions as the unit of authorization; roles map to them in code |
| [0007](0007-configurable-workflows-with-status-categories.md) | Per-org configurable workflows whose statuses map to fixed categories |
| [0008](0008-ticket-numbering.md) | Gap-free per-org ticket numbering via an upserted counter row |
| [0009](0009-append-only-audit-log.md) | Append-only audit log enforced by trigger, written in-transaction |
| [0010](0010-attachments-via-presigned-urls.md) | Attachments via presigned URLs; HMAC-signed local driver for development |
| [0011](0011-timeline-from-audit-log.md) | Activity timeline derived from the audit log |
| [0012](0012-custom-fields-as-validated-json.md) | Custom fields as JSON validated against per-org definitions |
| [0013](0013-kanban-columns-and-moves.md) | Kanban columns are status categories; moves go through the workflow; explicit keyboard moving |
| [0014](0014-calendar-math-in-organization-time-zone.md) | Calendar math (today/week/overdue, due dates) in the organization's time zone |
| [0015](0015-time-tracking-invariants.md) | One running timer per user, 24 h cap, staff-only time data, all DB-enforced |
