# ADR-0011: The activity timeline is derived from the audit log

**Status:** Accepted

## Context
Ticket pages need an activity history. A separate `TicketActivity` table
would duplicate what the audit log already records in the same transaction
as each change.

## Decision
The timeline merges comments with audit rows where `entityType = 'ticket'`
and `entityId = <ticket>`. Ticket-related actions (attachments, links,
watchers) are audited against the ticket for this reason. The server turns
audit metadata into sentences, resolving user ids to names, so the client
never interprets raw metadata. Requesters receive public comments plus
`ticket.created` and `ticket.status_changed` only.

## Alternatives considered
- **A dedicated activity table:** an extra write per mutation, and two
  records that could disagree.

## Consequences
- Audit metadata for ticket events must be safe to show staff (no bodies,
  no secrets), which the sanitizer and service conventions already require.
- Very long-lived tickets read more audit rows. `(organizationId, entityType,
  entityId)` is indexed, and pagination can be added when needed.
