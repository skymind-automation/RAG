# Architecture

## Shape

A single Next.js 15 (App Router) application with a transport-independent
domain layer. No separate backend service yet ([ADR-0002](decisions/0002-nextjs-monolith-with-extractable-domain.md)).

```
Browser ──► middleware (request id, anonymous redirect: UX only)
        ──► Server Component page ─┐
        ──► Server Action ─────────┼──► runAuthed / runInOrg / orgRoute   (src/server/actions)
        ──► Route Handler (/api) ──┘        │ establishes context, maps errors, logs, audits denials
                                            ▼
                                   Domain services (src/server/*)
                                   take OrgContext + untrusted input
                                   validate (zod) → authorize → scopedDb(orgId) → audit (same tx)
                                            ▼
                                   PostgreSQL (system of record, pgvector)   Redis (rate limits; later queues/SSE)
```

## Layers and rules

| Layer | May depend on | Must not |
| --- | --- | --- |
| `app/` (routes, actions) | `server/*`, `components/*`, `lib/*` | contain business rules or DB queries |
| `components/` | `lib/*` (pure), action functions | import `server/*` services or Prisma |
| `server/*` services | `lib/*`, other services, Prisma via `scopedDb` | read `headers()`/cookies, import Next.js APIs |
| `server/auth/context.ts` | Next.js APIs | contain policy (it delegates to `resolve.ts`) |
| `lib/*` | nothing app-specific | know about requests |

Consequences:

- The same `createTicket(ctx, input)` serves a server action, the REST route
  `/api/orgs/:slug/tickets`, the seed, and tests. Background jobs (Phase 4)
  will build an `OrgContext` for a system actor and call the same services.
- `requireAuth / requireOrganization / requirePermission` are the only way
  to establish identity and tenancy. `resolve.ts` holds the policy as plain
  functions so tests exercise exactly the production code path.

## Service boundaries (current)

| Service | File | Responsibilities |
| --- | --- | --- |
| UserService | `server/users/user-service.ts` | registration, session revocation |
| OrganizationService | `server/organizations/organization-service.ts` | create (+ defaults), list mine, switch, settings |
| MembershipService | `server/memberships/membership-service.ts` | list, invite/revoke/accept, change role, remove/leave |
| TeamService | `server/teams/team-service.ts` | teams and team membership |
| TicketService | `server/tickets/ticket-service.ts` | create, list (cursor + filters), get, update, soft delete, transitions, assignment, comments (mentions, attachments) |
| Ticket collaboration | `server/tickets/{watcher,relation,timeline}-service.ts` | watchers, related tickets, activity timeline |
| Ticket configuration | `server/tickets/ticket-config-service.ts`, `custom-fields.ts` | categories, priorities, workflow statuses/transitions, custom fields |
| AttachmentService | `server/attachments/attachment-service.ts` + `lib/storage` | presigned upload/confirm/download, validation, scan hook |
| AuditService | `server/audit/*` | append-only writes in-transaction; tenant-scoped reads |
| PermissionService | `lib/permissions` + `server/auth/resolve.ts` | role→permission map, grant rules, checks |

Planned (per spec): SLAService, BusinessHoursService, NotificationService,
SearchService, RAGService, AIService.

## Request lifecycle (server action)

1. Middleware stamps `x-request-id`.
2. `runInOrg(slug, op, fn)` → `requireOrganization(slug)`:
   verify session JWT → load user (active? session version?) → load **active**
   membership for (user, slug) → build `OrgContext` with role permissions.
3. The service validates input with zod, checks permissions, runs in a
   transaction on `scopedDb(ctx.organization.id)`, writes the audit row in
   the same transaction.
4. Result or `PublicError` returned. One structured log line per operation
   (`requestId, organizationId, userId, operation, latencyMs, result,
   errorCategory`). Authorization denials are also audited.

## Error model

Typed errors in `lib/errors.ts` (`AuthenticationError`,
`AuthorizationError`, `TenantAccessError`, `ValidationError`,
`NotFoundError`, `ConflictError`, `RateLimitError`, `ExternalProviderError`,
`AIProviderError`, `InternalError`). Only `toPublicError()` output leaves the
server. Unknown errors become a generic message, and `details` go to logs only.

## Frontend

Server Components by default. Client Components only for interactivity
(forms with react-hook-form + zod, dropdowns, dialogs). TanStack Query is
provisioned for Phase 2+ client-side data. Zustand holds UI-only state
(mobile nav), never tenant data or authorization state. shadcn/ui (Radix)
primitives, Delta red as the primary token, WCAG-minded patterns: labelled
inputs, `aria-invalid`/`aria-describedby`, `role="alert"` errors, skip
link, Radix focus-trapped mobile drawer, visible focus rings.

## Observability hooks

`lib/observability/logger.ts` emits JSON lines with key-based redaction
(passwords, tokens, secrets, cookies, hashes). Swap the sink for
OpenTelemetry/Sentry there. Request ids flow from middleware into logs and
audit rows.
