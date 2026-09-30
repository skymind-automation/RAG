# ADR-0005: Three-layer tenant isolation; RLS deferred

**Status:** Accepted

## Context
Tenant isolation is non-negotiable and must not rely on UI filtering or on
every developer remembering a `where` clause.

## Decision
1. **Context:** services require an `OrgContext` built from a verified membership.
2. **Scoped client:** a Prisma extension injects and enforces
   `organizationId` on every tenant model, throws on cross-tenant writes,
   and fails closed on unknown operations.
3. **Database:** composite `(organizationId, id)` foreign keys, so
   cross-tenant references are unrepresentable.

Each layer is tested independently, and the scoped client is
mutation-tested.

## Alternatives considered
- **PostgreSQL row-level security:** strongest guarantee, including for raw
  SQL. With Prisma it needs every query wrapped in a transaction that runs
  `SET LOCAL app.org_id`, which interacts badly with connection poolers in
  transaction mode and doubles round trips. Deferred, not rejected. The
  schema (every tenant table has `organizationId`) is RLS-ready, and adding
  policies later needs no data migration.
- **Schema- or database-per-tenant:** strong isolation but heavy operations
  (migrations × tenants) and poor fit for cross-tenant users.

## Consequences
- Raw SQL bypasses layer 2 and must pass `organizationId` explicitly
  (review rule). Layer 3 still protects referential integrity there.
- Revisit RLS when the first raw-SQL-heavy subsystem (hybrid search) lands.
