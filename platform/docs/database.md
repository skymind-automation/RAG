# Database

PostgreSQL 16 is the system of record; pgvector is installed by the first
migration. Prisma 6 is the ORM.

## Conventions

- Tables `snake_case` (`@@map`), columns `camelCase` (quote them in raw SQL).
- IDs are CUIDs. Every tenant table has `organizationId` plus
  `@@unique([organizationId, id])` so children can use composite FKs.
- `createdAt` / `updatedAt` everywhere. `deletedAt` for soft-deletable
  business entities (users, organizations, teams, categories, tickets,
  comments).
- Memberships are never hard-deleted (`status = REMOVED`): tickets keep
  valid FKs to people who left.
- Audit rows are never updated or deleted (trigger).
- Deletes are `RESTRICT` by default. `CASCADE` only for pure children
  (team memberships, workflow statuses/transitions, comments/watchers of a
  ticket).

## Entity overview (current)

```
User ─┬─< OrganizationMembership >── Organization ─┬─< Team ─< TeamMembership >─ Membership
      │                                            ├─< Invitation
      │                                            ├─< AuditLog
      │                                            ├─< Workflow ─< WorkflowStatus
      │                                            │          └─< WorkflowTransition (from,to)
      │                                            ├─< TicketPriority, TicketCategory, TicketSequence
      └─ (requester/assignee/creator via membership) ─< Ticket ─< Comment, TicketWatcher
```

## Migrations

| Migration | Contents |
| --- | --- |
| `20260930212003_init` | `CREATE EXTENSION vector`; all tables, enums, indexes, FKs (incl. composite tenant FKs) |
| `20260930212100_tenant_integrity` | CHECKs (lowercase email, slug format, prefix format, positive numbers), partial unique indexes (one default workflow/priority per org, one initial status per workflow), active-membership index, audit immutability trigger |

The hand-written migration only contains objects Prisma doesn't diff, so
`prisma migrate diff --from-migrations … --to-schema-datamodel …` reports
no difference. Keep it that way: if you add a relation Prisma can model,
model it in `schema.prisma`, because Prisma *will* try to drop FKs it doesn't
know about.

## Performance notes

- Ticket list: `(organizationId, createdAt DESC, id)` supports the cursor
  pagination. Status/assignee/requester views have their own
  `(organizationId, x, updatedAt DESC)` indexes.
- Audit: `(organizationId, createdAt DESC)` and `(organizationId,
  entityType, entityId)` for per-entity history.
- Services select explicit columns (no `SELECT *`), and list queries
  resolve relations in one round trip.

## Concurrency

- Ticket numbers: `INSERT … ON CONFLICT DO UPDATE SET nextValue = nextValue + 1
  RETURNING`, inside the ticket transaction ([ADR-0008](decisions/0008-ticket-numbering.md)).
- Ticket mutations: optimistic concurrency via `version`
  (`updateMany … WHERE version = expected`, 0 rows → `ConflictError`).
- Owner invariants: `SELECT … FOR UPDATE` on active owner rows.
