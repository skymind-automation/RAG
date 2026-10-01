# ADR-0010: Attachments via presigned URLs, with a signed local driver for development

**Status:** Accepted

## Context
Attachments must be organization-scoped, authorized, validated, and stored
in S3/R2 without proxying large files through the application or exposing
storage credentials. Development and CI need a working path without a cloud
bucket.

## Decision
- `StorageProvider` interface (`presignUpload`, `presignDownload`, `head`,
  `delete`) with an S3 driver (AWS S3, R2, MinIO) and a **local** driver.
- Flow: `requestUpload` (validate allowlisted extension + matching MIME + size;
  authorize; create `PENDING_UPLOAD` row; 5-minute presigned PUT that signs
  `Content-Type` and `Content-Length`) → browser PUTs directly → `confirmUpload`
  (HEAD: size and type must match, else the object is deleted and the row
  marked `DELETED`; then the malware-scan hook) → `AVAILABLE`. Downloads get a
  60-second presigned GET with `Content-Disposition: attachment`, issued only
  after re-deriving authorization, and audited.
- Keys are `org/<organizationId>/tickets/<ticketId>/<random>`. The file name
  never enters the key, and a CHECK constraint ties the key prefix to the row's
  organization.
- Visibility is chosen at request time (`INTERNAL` uploads require
  `tickets.comment_internal`) and follows the comment the file is attached to.
- The local driver mimics presigning with HMAC-signed tokens (key, op, type,
  exact size, expiry) served by `/api/storage/local`. It is refused under
  `NODE_ENV=production` unless `STORAGE_ALLOW_LOCAL=1` (used only by the
  Compose evaluation stack and E2E).
- The malware scanner is a hook. The default reports `SKIPPED` (a no-op that
  says so). `INFECTED` quarantines the file, and `PENDING` holds it as
  `PENDING_SCAN` until a Phase 4 job records the verdict.

## Alternatives considered
- **Proxy uploads through the app:** simplest authorization, but it ties up
  server memory and bandwidth, and on Vercel hits request body limits.
- **Public-read buckets with unguessable keys:** no revocation, no audit, and
  a leaked URL is permanent.
- **MinIO in development instead of a local driver:** closer to production,
  but heavier for every contributor and CI job. Revisit if driver drift appears.

## Consequences
- Production buckets need CORS for `PUT` from the app origin.
- `PENDING_UPLOAD` rows from abandoned uploads, and objects of `DELETED`
  rows, need a sweeper job (Phase 4).
- The S3 driver's signing is unit-tested offline. It has not been exercised
  against a live bucket in this repository's CI.
