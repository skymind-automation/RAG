# Multi-tenancy

Organizations are tenants. Users are global. `OrganizationMembership` links
them with a role and a status (`ACTIVE | SUSPENDED | REMOVED`).

## Resolving the active organization

The organization is part of the URL: `/o/<slug>/…` and
`/api/orgs/<slug>/…` ([ADR-0004](decisions/0004-url-scoped-organization-context.md)).
The slug is **untrusted**; it only selects which membership to look up:

```ts
membership = findFirst({ userId: session.user, status: ACTIVE,
                         organization: { slug, deletedAt: null } })
// none → TenantAccessError → 404
```

No request body, query string or client state can supply an
`organizationId`. The zod schemas don't accept one, and a unit test asserts
it is stripped. `User.lastActiveOrganizationId` is only a landing hint.

## Three layers

**Layer 1: context.** Every service takes an `OrgContext`, built only by
`resolveOrgContext()`. Services derive `organizationId` from it.

**Layer 2: the scoped client.** `scopedDb(orgId)` is a Prisma client
extension over every tenant model (`TENANT_MODELS` in
`src/lib/db/tenant.ts`):

| Operation | Behaviour |
| --- | --- |
| find*, count, aggregate, groupBy, update*, delete*, upsert | `where.organizationId = orgId` injected; an explicit different value **throws** |
| create, createMany | `organizationId` stamped; a different value or an `organization: {connect}` **throws** |
| update data | changing `organizationId` **throws** |
| unknown operation | **throws** (fail closed) |
| `scopedDb("")` | **throws** |

This layer is load-bearing, not decorative. Services rely on it for filters
like "the initial status of the default workflow". Mutation test: replacing
the guard with a pass-through fails all 18 isolation tests.

A unit test enumerates every Prisma model with an `organizationId` column and
fails if any is missing from `TENANT_MODELS`, so a new table can't silently
bypass the guard.

Not covered: `$queryRaw`. The two raw queries today
(`allocateTicketNumber`, `lockActiveOwners`) take `organizationId` as an
explicit bound parameter. Raw SQL on tenant tables must do the same, and is
review-flagged.

**Layer 3: the database.** Every tenant table has
`UNIQUE (organizationId, id)`, and child tables reference parents by the
pair:

- tickets → status, priority, category, team: `(organizationId, xId)`
- tickets → requester/assignee/creator: `(organizationId, userId)` →
  memberships (so only members, past or present, can appear on a ticket)
- comments, watchers → ticket and member; team memberships → team and
  membership; workflow transitions/statuses → workflow
- ticket relations → both tickets; attachments → ticket, optional comment
  and uploader; comment mentions → comment and member
- attachment storage keys must start with `org/<the row's organizationId>/`
  (CHECK constraint)

A row in Org A pointing at Org B's row is unrepresentable. The integration
suite proves this with the **raw, unscoped** client.

## Documented unscoped paths

These use the plain `prisma` client on purpose, because no organization
context exists yet or the operation is global:

| Path | Why | Guard |
| --- | --- | --- |
| `verifyCredentials`, `registerUser`, `resolveSessionUser` | identity is global | by user id / email |
| `resolveOrgContext`, `listMyOrganizations` | establishing context | filtered by the caller's user id |
| `createOrganization` + defaults | the tenant is being created | ids minted in the same tx |
| `acceptInvitation`, `previewInvitation` | caller isn't a member yet | token hash selects; org id from the invitation row; email must match |
| `changeMemberRole`, `removeMember` | need `SELECT … FOR UPDATE` | explicit `organizationId` from context in every predicate |
| `organization` table reads/updates | it *is* the tenant | keyed by `ctx.organization.id` |

## Access within a tenant

Row-level rules on top of tenancy, enforced in queries:

- `tickets.read` → all tickets; `tickets.read_own` → `requesterId = me`.
  Tickets you can't read are `NotFound`, never `Forbidden`.
- Internal comments are selected only with `tickets.read_internal`.
- Requesters can't set routing fields; their source is forced to `PORTAL`.

## Future subsystems must

- Put `organizationId` first in every composite index (search, embeddings).
- Filter vector search by `organization_id` **inside the SQL**, before
  ranking. Never post-filter a global top-k ([ai-rag.md](ai-rag.md)).
- Carry `organizationId` in every job payload and rebuild the context in the
  worker; never trust a job to "already be scoped".
- Namespace SSE channels and cache keys by organization.
- Attachments (done in Phase 2): stored under `org/<organizationId>/…`,
  authorization re-derived before every presigned URL.
