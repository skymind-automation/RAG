# ADR-0012: Custom fields as validated JSON on the ticket

**Status:** Accepted

## Context
Organizations need their own ticket fields (text, number, select, date,
checkbox), optionally required and per ticket type.

## Decision
`CustomFieldDefinition` rows per organization. Values live in
`Ticket.customFields` (JSON) keyed by the definition's stable `key`, and are
validated by one pure function (`validateCustomFields`) on every create and
update: unknown keys, wrong types, invalid options and missing required
values are field-level errors. Changing a ticket's type re-validates.
Archived definitions stop validating, and their key is renamed so a new field
can reuse the name without inheriting old values.

## Alternatives considered
- **EAV table (one row per value):** queryable per field, but every read
  becomes a pivot. Not needed until reporting on custom fields (Phase 4+),
  when a GIN index on the JSON or a typed projection can be added.
- **Columns per field (DDL per tenant):** unacceptable in a shared schema.

## Consequences
- Filtering by custom field needs a JSON index later.
- Values without an active definition are dropped the next time that
  ticket's fields are edited (documented in the service).
