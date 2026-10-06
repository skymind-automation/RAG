# Delta ITSM

Multi-organization IT service management (incidents, requests, problems,
changes, tasks) with a tenant-isolated AI/RAG layer, built on Next.js 15,
PostgreSQL + pgvector, Prisma, Auth.js and Redis.

> **Status: Phases 1–3 complete (Foundation, Core ITSM, Work Management).**
> What exists is built and tested end to end. Everything else in the
> [roadmap](#roadmap) is designed for but not built. The sidebar shows planned
> areas as disabled "Soon" items rather than dead links.

## Contents

- [What works today](#what-works-today)
- [Quick start](#quick-start)
- [Environment variables](#environment-variables)
- [Database, migrations and seed](#database-migrations-and-seed)
- [Architecture](#architecture)
- [Authentication and authorization](#authentication-and-authorization)
- [Tenant isolation](#tenant-isolation)
- [Ticket model](#ticket-model)
- [Testing](#testing)
- [Deployment](#deployment)
- [Roadmap](#roadmap)
- [Troubleshooting](#troubleshooting)

Deep dives live in [`docs/`](docs): [architecture](docs/architecture.md),
[security](docs/security.md), [multi-tenancy](docs/multi-tenancy.md),
[database](docs/database.md), [AI/RAG plan](docs/ai-rag.md),
[deployment](docs/deployment.md), and the [decision records](docs/decisions).

## What works today

| Milestone requirement | Where |
| --- | --- |
| Register / login (email + password, argon2id, rate-limited) | `src/server/auth`, `src/server/users` |
| Create organizations; belong to many; switch between them | `src/server/organizations`, org switcher |
| Roles → permissions, enforced server-side | `src/lib/permissions`, `src/server/auth/resolve.ts` |
| Invitations (email-bound, single-use, hashed, expiring), role changes, removal | `src/server/memberships` |
| Teams | `src/server/teams` |
| Organization-scoped data isolation (3 layers) | [multi-tenancy.md](docs/multi-tenancy.md) |
| Immutable audit log (DB-enforced) with UI | `src/server/audit`, `/o/<slug>/audit` |
| Prisma migrations with DB-level tenant FKs | `prisma/` |
| Docker Compose (Postgres+pgvector, Redis, migrations, app) | `docker-compose.yml` |
| Automated isolation/authz tests | `tests/` (48 unit, 107 integration, 19 E2E) |
| Seed: 2 orgs, 12 users, all roles, 5 teams, 36 tickets, custom fields, links, mentions | `prisma/seed/seed.ts` |
| Authenticated dashboard | `/o/<slug>` |

**Phase 2: Core ITSM**

| Capability | Where |
| --- | --- |
| Ticket CRUD: create (agent form and requester portal), partial edit, soft delete | `ticket-service.ts`, `/tickets/new`, `/tickets/<KEY>` |
| Per-org numbering with configurable prefix and digit count | `ticket-numbering.ts`, Settings |
| Configurable workflow: add/rename statuses, transition matrix, "requires resolution" | `ticket-config-service.ts`, `/settings/tickets` |
| Priorities (rename, colour, default), categories (create, archive) | same |
| Custom fields (text, number, select, date, checkbox), per type, required, validated server-side | `custom-fields.ts` |
| Assignment, watchers (self-watch; staff manage others) | `ticket-service.ts`, `watcher-service.ts` |
| Comments: public replies and internal notes, Markdown, @mentions, attachments | `addComment`, `comment-composer.tsx` |
| Attachments: S3/R2 presigned upload/download, type/size/extension validation, malware-scan hook, internal visibility | `src/server/attachments`, `src/lib/storage` |
| Related tickets (relates to, duplicates, blocks, caused by) | `relation-service.ts` |
| Activity timeline merged from comments and the audit log, filtered per audience | `timeline-service.ts` |
| Ticket list with URL-driven filters (state, assignee, priority, type, team, search) | `/tickets` |

**Phase 3: Work management**

| Capability | Where |
| --- | --- |
| My Work: assigned, today, this week, overdue, backlog (unassigned in my teams), watching, plus logged time | `my-work-service.ts`, `/my-work` |
| Calendar math in the organization's time zone (DST-safe); date-only due dates mean end of that local day | `lib/time/zoned.ts` ([ADR-0014](docs/decisions/0014-calendar-math-in-organization-time-zone.md)) |
| Kanban board by status category, filters, grouping by assignee or priority | `board-service.ts`, `/boards` |
| Drag-and-drop (pointer), explicit keyboard moving, "Move to" menu; optimistic updates with rollback and server reconciliation | `kanban-board.tsx` ([ADR-0013](docs/decisions/0013-kanban-columns-and-moves.md)) |
| Time tracking: start/stop timer (one running per user, DB-enforced), switch, manual entries, billable, 24 h cap, live sidebar timer | `time-service.ts`, ticket Time panel ([ADR-0015](docs/decisions/0015-time-tracking-invariants.md)) |

## Quick start

Prerequisites: Node ≥ 20.18, Docker (or a local PostgreSQL 16 with pgvector,
and Redis).

```bash
cd platform
cp .env.example .env                       # set AUTH_SECRET: openssl rand -base64 48
docker compose up -d postgres redis        # infrastructure only
npm ci                                     # also runs prisma generate
npm run db:migrate                         # apply migrations
npm run db:seed                            # optional demo data
npm run dev                                # http://localhost:3000
```

Seeded sign-ins (password `delta-demo-password`, development only):

| User | Delta Fleet Operations (`/o/delta-ops`) | Northwind Health IT (`/o/northwind`) |
| --- | --- | --- |
| maya.chen@delta.example | Owner | — |
| omar.haddad@delta.example | Admin | — |
| priya.nair@delta.example | Manager | — |
| luis.ortega@delta.example | Agent | Viewer (multi-org user) |
| tom.walsh@delta.example | Requester | — |
| grace.kim@delta.example | Viewer | — |
| daniel.okafor@northwind.example | — | Owner |
| ben.carter@northwind.example | — | Requester |

Or run everything in containers: `docker compose up -d --build`, then
`docker compose run --rm migrate npm run db:seed`.

## Environment variables

All configuration is environment-driven; see [`.env.example`](.env.example)
for the full annotated list. Required today:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Runtime connection (may be pooled) |
| `DIRECT_DATABASE_URL` | Direct connection for migrations |
| `AUTH_SECRET` | Signs/encrypts session tokens. 32+ random bytes |
| `AUTH_URL` | Public origin; also used to build invitation links |
| `REDIS_URL` | Rate limiting (falls back to in-process when unset) |
| `STORAGE_DRIVER` | `s3` (S3/R2/MinIO via `S3_*`) or `local` (development only) |

AI and email variables are declared now so deployments are provisioned
consistently, and are consumed from the phases that introduce those
subsystems. Only `NEXT_PUBLIC_*` values reach the browser; no secret
uses that prefix.

## Database, migrations and seed

- `npm run db:migrate`: apply migrations (`prisma migrate deploy`)
- `npm run db:migrate:dev -- --name <change>`: author a new migration. Needs
  a role that can `CREATE EXTENSION vector` in the shadow database, or
  pgvector pre-installed in `template1` (the Docker init script does this).
- `npm run db:seed`: demo data. Refuses if seed orgs exist; `-- --reset`
  truncates first. Refuses under `NODE_ENV=production`.

The migrations are the schema plus a hand-written `tenant_integrity`
migration for what Prisma can't express: CHECK constraints, partial unique
indexes and the audit-immutability trigger. `prisma migrate diff` against the
schema reports **no drift**. See [database.md](docs/database.md).

## Architecture

```
src/
  app/                 routes only: pages, layouts, server actions, route handlers
  components/          ui/ (shadcn), shell/, members/, teams/, tickets/, …
  server/              domain services, framework-independent
    auth/              Auth.js config, context resolution (requireAuth/…)
    organizations/ memberships/ teams/ tickets/ users/ audit/
    actions/           runAuthed / runInOrg / orgRoute: uniform execution + error mapping
  lib/
    db/                Prisma client, tenant-scoped client, error mapping
    permissions/       roles → permissions (pure, shared)
    validation/        zod schemas shared by forms and services
    security/          password hashing, tokens, rate limiting
    observability/     structured logger with redaction
prisma/                schema, migrations, seed
tests/                 unit/, integration/ (real Postgres), e2e/ (Playwright)
```

Services take an `OrgContext` and never read the request, so the same code
serves server actions, route handlers, background jobs and tests. Details:
[architecture.md](docs/architecture.md).

**Relationship to the repository root:** the Django service in the parent
directory (`knowledge/`, "Delta RAG") is a separate, domain-specific retrieval
service for fleet-maintenance documents. It is untouched. How the two relate
is recorded in [ADR-0001](docs/decisions/0001-platform-alongside-delta-rag.md).

## Authentication and authorization

- Auth.js v5, Credentials provider, JWT sessions carrying only `sub`
  (user id) and `sv` (session version). Every request re-reads the user,
  so deactivation and "sign out everywhere" (bump `sessionVersion`) take
  effect immediately. See [ADR-0003](docs/decisions/0003-minimal-jwt-server-side-authorization.md).
- `requireAuth()` → `requireOrganization(slug)` (= `requireMembership`) →
  `requirePermission(ctx, "…")`. Pages, actions and route handlers all use
  these. Middleware only redirects anonymous users (a UX nicety, not a
  security boundary).
- Roles (`OWNER`, `ADMIN`, `MANAGER`, `AGENT`, `REQUESTER`, `VIEWER`) map to
  permissions in `src/lib/permissions`. Code checks permissions, never role
  names. Only owners grant or manage peers; everyone else acts strictly
  downward; the last owner can't be demoted or removed.

## Tenant isolation

The active organization comes from the URL (`/o/<slug>`) and is **verified
against an active membership on every request**. It is never read from a
request body. Isolation is layered:

1. **Context:** services only run with an `OrgContext` built from the
   membership row.
2. **Scoped client:** `scopedDb(orgId)` injects `organizationId` into every
   query on tenant models and throws on writes naming another tenant. The
   services depend on it (mutation-tested: disabling it fails 18/18
   isolation tests).
3. **Database:** composite foreign keys `(organizationId, id)` make
   cross-tenant references unrepresentable, even for raw SQL.

Non-members get a 404, indistinguishable from a missing organization.
Full model: [multi-tenancy.md](docs/multi-tenancy.md).

## Ticket model

Six types (`INCIDENT`, `SERVICE_REQUEST`, `PROBLEM`, `CHANGE`, `TASK`,
`QUESTION`). Keys like `IT-000042` are unique per organization, with a
configurable prefix, allocated gap-free under concurrency. Statuses are
per-organization and configurable, but each maps to a fixed **category**
(`NEW…CLOSED`) that boards, SLAs and reports rely on. Transitions go through
`transitionTicket()` only, which validates the workflow, required resolution
and optimistic concurrency (`version`), then audits. Internal notes are
filtered in the query for anyone without `tickets.read_internal`, and so are
internal attachments and staff-only timeline events (assignment, links,
watchers). Requesters see public replies, creation and status changes only.
Custom-field values are JSON on the ticket, validated against the
organization's definitions on every write ([ADR-0012](docs/decisions/0012-custom-fields-as-validated-json.md)).
Files go browser ↔ storage directly via short-lived presigned URLs, issued only
after authorization ([ADR-0010](docs/decisions/0010-attachments-via-presigned-urls.md)).
[ADR-0007](docs/decisions/0007-configurable-workflows-with-status-categories.md),
[ADR-0008](docs/decisions/0008-ticket-numbering.md).

## Testing

```bash
npm run lint && npm run typecheck
npm run test:unit            # pure logic
npm run test:integration     # real Postgres (TEST_DATABASE_URL, name must contain "test")
npm run build && npm run test:e2e   # Playwright vs production build, fresh seeded DB (itsm_e2e)
```

The integration suite covers the non-negotiables: Org A cannot read, list,
comment on, assign or reference Org B's tickets/teams/members/audit;
requesters never receive internal notes; viewers can't administer; role
escalation is blocked; the last owner is protected; removed members lose
access on their next request; sessions are revocable; invitations are
email-bound, single-use and expiring; audit rows can't be updated or deleted;
ticket numbers are unique under 20-way concurrency. Phase 2 adds: Org A
cannot upload to, list, download or delete Org B's files, resolve Org B's
ticket keys when linking, or mention Org B's users; internal files, notes and
staff-only events never reach requesters; mentions only reach people who can
read the comment; uploads must match the signed type and size; quarantined and
pending files are never served. Phase 3 adds: the database admits only one
running timer per user even under concurrent starts; time data never reaches
requesters; board moves can't bypass workflow rules, required resolutions or
version checks; and My Work buckets are correct across DST. A unit test fails
if any model with an
`organizationId` is missing from the scoped client. Search, embedding and
AI-history isolation tests arrive with those subsystems.

## Deployment

Vercel (or any Node host) + managed PostgreSQL with pgvector + managed Redis.
Run `prisma migrate deploy` as a release step, not at boot. The Docker image
is a standalone Next.js server running as a non-root user, with a health
check on `/api/health`. See [deployment.md](docs/deployment.md).

## Roadmap

Following the specification's phase order. Each phase ships with its tests
and docs.

| Phase | Scope | State |
| --- | --- | --- |
| 1 Foundation | auth, orgs, memberships, roles, tenant-safe services, audit, tests, Docker | **done** |
| 2 Core ITSM | ticket CRUD and UI, workflow/priority/category/custom-field admin, comments, internal notes, mentions, attachments, relations, watchers, timeline | **done** |
| 3 Work management | My Work, Kanban (with keyboard alternative to drag-and-drop), time tracking | **done** |
| 4 SLA & notifications | business hours/holidays, SLA engine, BullMQ jobs, email providers, SSE | planned |
| 5 Knowledge | articles, versions, lifecycle, FTS | planned |
| 6 RAG foundation | embeddings, pgvector HNSW, hybrid retrieval, permission filtering, eval | planned, see [ai-rag.md](docs/ai-rag.md) |
| 7 AI features | similar tickets → classification → … → NL reporting, all human-in-the-loop | planned |
| 8 Evaluation | retrieval/grounding/cost metrics with adversarial sets | planned |

## Troubleshooting

- **`permission denied to create extension "vector"`** during `migrate dev`:
  your role can't create extensions in the shadow DB. Pre-install pgvector
  in `template1` (as a superuser: `\c template1` then
  `CREATE EXTENSION vector;`) or use a superuser `--shadow-database-url`.
- **Integration tests refuse to start:** `TEST_DATABASE_URL` must name a
  database containing "test". This is deliberate: the suite truncates tables.
- **Login always fails after many attempts:** rate limit (8 per email / 20
  per IP per 15 min). Wait, or clear `rl:*` keys in Redis.
- **Playwright can't find a browser:** set `PLAYWRIGHT_CHROMIUM_EXECUTABLE`
  or run `npx playwright install chromium`.
- **Uploads fail with S3/R2 but work locally:** the bucket needs a CORS rule
  allowing `PUT` from your app origin with the `Content-Type` header (see
  deployment.md). The URL is signed for one content type and exact size.
- **A page you expect returns 404:** by design for non-members *and* for
  members lacking the page's permission. Check the role in the org switcher.
