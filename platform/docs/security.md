# Security model

## Principles

Security, tenant isolation, data integrity and auditability win over
convenience. The server is authoritative for identity, organization,
role, permissions, ownership, state transitions and audit. When context
can't be established, access is denied.

## Authentication

- Email + password via Auth.js v5 Credentials. Passwords: argon2id (19 MiB,
  t=2, p=1). Minimum 12 characters, maximum 128.
- Uniform failure: unknown email, wrong password, deactivated account and
  rate-limited attempts all return the same "Invalid email or password."
  Unknown emails still pay the argon2 cost (dummy hash).
- Rate limits (Redis, fixed window): login 20/15 min per IP and 8/15 min per
  email; registration 10/h per IP; invitations 100/h per org. If Redis is
  unreachable the limiter **fails open** with a warning log: abuse
  mitigation shouldn't turn a cache outage into a login outage.
  Authorization never fails open.
- Sessions: JWT (encrypted, httpOnly cookie) with only `sub` and `sv`.
  Every request reloads the user and compares `sessionVersion`, so
  deactivation and "sign out everywhere" are immediate. 7-day lifetime.
- Registration reveals whether an email exists (inherent to sign-up);
  bounded by the per-IP limit.

## Authorization

Permissions, not roles, at call sites. `requirePermission()` throws
`AuthorizationError` (403). Inaccessible tenants and tickets are 404.
Grant rules: only owners grant or manage peers or superiors; the last active
owner can't be demoted or removed (owner rows locked `FOR UPDATE` to prevent
concurrent races). The UI hides what a role can't do, and the server
re-checks every action. The middleware is not a security boundary.

## Invitations

256-bit random tokens, stored as SHA-256 only, 7-day expiry, single use
(conditional update), bound to the invited email (a forwarded link can't be
redeemed by another account), superseded by re-invites. The accept page
sets `Referrer-Policy: no-referrer`.

## Attachments

See [ADR-0010](decisions/0010-attachments-via-presigned-urls.md). In short:
- **Allowlist:** extension plus matching MIME. Executable and
  active-content types are rejected (html, svg, js, exe…).
- **Limits:** size (25 MB default), 100 files per ticket, sanitized names.
- **Upload URLs** last 5 minutes and sign the type and size. Confirmation
  HEADs the object and discards mismatches.
- **Download URLs** last 60 seconds, force `attachment` disposition, and are
  served with `nosniff` and a sandbox CSP on the local driver. Each issue is
  audited, and authorization is re-derived each time.
- **Visibility:** internal files are filtered in queries for anyone without
  `tickets.read_internal`.
- **Scan hook:** quarantined and pending-scan files are never downloadable.

## User content

Markdown is rendered without raw HTML, dangerous URL schemes are stripped,
links get `rel="noopener noreferrer nofollow"`, and remote images are not
loaded (a placeholder is shown), so a comment can't become a tracking pixel.
@mentions are validated server-side: only active members who can read that
comment can be mentioned, so a mention can't be used to expose an internal
note or another requester's ticket.

## Audit

Append-only `audit_logs`: a `BEFORE UPDATE OR DELETE` trigger raises for
every role. Rows are written in the same transaction as the change, so there's
never a change without a record or a record of a rolled-back change. Metadata
is sanitized (secret-like keys redacted, strings truncated, 8 KB cap).
Comment bodies are never logged or audited. Row triggers don't fire on
`TRUNCATE`: in production, the application role must not own the table
or hold `TRUNCATE` (see deployment.md).

Audited today: registration, login success/failure, organization
create/update/switch, invitations (create/revoke/accept), role changes,
removals, team changes, ticket create/update/delete/status/assignment/
priority/comment, watchers, links, attachment request/upload/download/delete/
quarantine, ticket and workflow configuration changes, and authorization
denials. AI events join in Phase 7.

## Transport and headers

`X-Frame-Options: DENY`, CSP `frame-ancestors 'none'; base-uri 'self';
form-action 'self'; object-src 'none'`, `nosniff`,
`strict-origin-when-cross-origin`, a restrictive `Permissions-Policy`, HSTS in
production, no `X-Powered-By`. A full script-src CSP with nonces is a
tracked follow-up (it needs middleware nonce plumbing for Next.js inline
scripts).

## Errors and logging

No stack traces, SQL or provider details in responses (`toPublicError`).
Logs are structured and redacted by key. Client IPs are taken from
`X-Forwarded-For` only when `TRUST_PROXY` isn't `0`.

## Secrets

Environment only. `.env*` is git-ignored except `.env.example`. No secret
uses `NEXT_PUBLIC_`. API keys (Phase 2+) will be stored hashed, scoped and
revocable like invitation tokens.

## AI security (design constraints for Phases 6–8)

See [ai-rag.md](ai-rag.md). In short: retrieved content is data, never
instructions; the model gets no database access; tenant and permission
filtering happens in SQL before ranking; every suggestion is labelled,
editable, rejectable and audited; nothing changes state without a human.

## Known gaps (tracked, not hidden)

- No MFA or OAuth/SAML yet (the provider list is the extension point).
- No email verification or password reset (they need the email subsystem, Phase 4).
- No Postgres row-level security. Isolation is the three layers above;
  RLS is evaluated in [ADR-0005](decisions/0005-layered-tenant-isolation.md).
- Script-src CSP (above).
