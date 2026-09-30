# ADR-0008: Ticket numbering

**Status:** Accepted

## Context
Keys like `IT-000042` must be unique per organization, human-friendly, and
configurable in format.

## Decision
A `ticket_sequences (organizationId, prefix, nextValue)` row, incremented by
one `INSERT … ON CONFLICT DO UPDATE … RETURNING` statement inside the
ticket-creating transaction. The key is `prefix-zeroPad(number, padding)`,
stored with `UNIQUE (organizationId, key)`. Changing the prefix starts a new
sequence, and existing keys never change.

## Alternatives considered
- **`MAX(number) + 1`:** races under concurrency.
- **Postgres `SEQUENCE` per org:** DDL per tenant, and a rolled-back
  transaction still consumes values (gaps).

## Consequences
- Gap-free and unique (tested with 20 concurrent creates, and a failed
  create consumes no number).
- Creates within one org serialise on the counter row only for the brief
  statement. Fine at ITSM volumes.
