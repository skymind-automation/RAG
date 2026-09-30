# Deployment

## Topology

| Component | Options |
| --- | --- |
| App | Vercel, or the Docker image (`Dockerfile`, standalone Next.js, non-root, health-checked) on any container platform |
| PostgreSQL 16 + pgvector | Neon, Supabase, RDS/Aurora, Cloud SQL, Crunchy. Must allow `CREATE EXTENSION vector` |
| Redis | Upstash, ElastiCache, Redis Cloud |
| Object storage (Phase 2) | S3 or Cloudflare R2 |

## Release procedure

1. Build the app (`npm run build`, or the Docker image).
2. Run migrations as a **separate release step** with a direct connection:
   `DATABASE_URL=$DIRECT_DATABASE_URL npx prisma migrate deploy`. Don't
   migrate at app boot, because concurrent instances would race.
3. Deploy the new app version. Readiness probe: `GET /api/health` (200 when
   the database is reachable and Redis is reachable or unconfigured).

On Vercel: set `DATABASE_URL` to the pooled URL (PgBouncer, transaction
mode, with `?pgbouncer=true`) and `DIRECT_DATABASE_URL` to the direct URL.
Middleware runs on the Edge runtime and uses only the edge-safe Auth.js
config. Everything touching the database runs on Node.

## Database roles (recommended)

- `itsm_owner`: owns the schema, runs migrations.
- `itsm_app`: runtime role with `SELECT, INSERT, UPDATE, DELETE` on
  application tables, and **only `SELECT, INSERT` on `audit_logs`** (no
  `TRUNCATE`, not the owner). Combined with the trigger, this makes the
  audit log tamper-evident even against a compromised app credential.

## Required production settings

- `AUTH_SECRET`: at least 32 random bytes, rotated with a planned
  re-login.
- `AUTH_URL`: the public origin (also used for invitation links).
- `TRUST_PROXY=1` only behind a proxy that overwrites `X-Forwarded-For`.
- Never set `SEED_ALLOW_PRODUCTION`.

## Local stack

`docker compose up -d --build` runs Postgres (pgvector), Redis, a one-shot
`migrate` service (exits 0 when done) and the app, all with health checks.
The app waits for `migrate` to complete successfully. Demo data:
`docker compose run --rm migrate npm run db:seed`.

Verified during Phase 1 development: images built, all four services
healthy, migrations applied, seed ran, login and pages served from the
container.

## Backups and retention

Point-in-time recovery on the managed Postgres. Audit logs are retained
indefinitely by default. Retention/archival policy is an organization-level
setting for a later phase, implemented as partition detachment rather than
`DELETE`.
