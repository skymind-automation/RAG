# ADR-0009: Append-only audit log enforced by the database

**Status:** Accepted

## Context
Audit records must be immutable and must never disagree with the data.

## Decision
`audit_logs` has a trigger that raises on UPDATE and DELETE. Services
write audit rows through the same transaction as the change. Metadata is
sanitized, and content bodies are never recorded.

## Alternatives considered
- **Application-level discipline only:** one bug or one compromised
  credential rewrites history.
- **External append-only store (e.g., a log pipeline):** good as a *second*
  sink for SIEM export later, but not as the source of truth for in-app
  history.

## Consequences
- Test resets use `TRUNCATE`, which row triggers don't cover. Production
  roles must not hold `TRUNCATE` on the table (deployment.md).
- Retention will use partitioning, not deletes.
