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

## Object storage (attachments)

Set `STORAGE_DRIVER=s3` and `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`. For Cloudflare R2, also set
`S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com` and
`S3_REGION=auto`. The bucket must be **private** (no public read). Browsers
upload directly, so add a CORS rule:

```json
[{ "AllowedOrigins": ["https://itsm.example.com"], "AllowedMethods": ["PUT", "GET"],
   "AllowedHeaders": ["Content-Type"], "MaxAgeSeconds": 3000 }]
```

Grant the access key only `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`
and `s3:HeadObject` (via `GetObject`) on `arn:aws:s3:::<bucket>/org/*`.
To add malware scanning, implement `MalwareScanner` (for example a ClamAV
sidecar or GuardDuty Malware Protection for S3) and register it in
`src/lib/storage/scanner.ts`.

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

Verified during development: images built, all four services healthy,
migrations applied, seed ran, login and pages served from the container, and
an attachment uploaded and downloaded through the container (Phase 2).
The Compose stack stores attachments on a local volume
(`STORAGE_DRIVER=local`, `STORAGE_ALLOW_LOCAL=1`). Set the `S3_*` variables
and `STORAGE_DRIVER=s3` to use a bucket instead.

## Backups and retention

Point-in-time recovery on the managed Postgres. Audit logs are retained
indefinitely by default. Retention/archival policy is an organization-level
setting for a later phase, implemented as partition detachment rather than
`DELETE`.
