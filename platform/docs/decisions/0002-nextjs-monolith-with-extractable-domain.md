# ADR-0002: Next.js monolith with a transport-independent domain layer

**Status:** Accepted

## Context
The spec prefers Server Actions and Route Handlers, with NestJS "only if
complexity genuinely justifies it", and domain logic independent of transport.

## Decision
One Next.js application. Domain services in `src/server/*` take an
`OrgContext` and untrusted input, and never touch Next.js request APIs.
Transport adapters (`runAuthed`, `runInOrg`, `orgRoute`) own context
resolution, error mapping and logging.

## Alternatives considered
- **NestJS API + Next.js frontend:** two deployables, duplicated auth, and
  network hops. No current requirement (long-running processes run as
  BullMQ workers, which can import the same services).
- **tRPC:** a good fit, but adds a layer the specification doesn't ask for.
  Server actions plus a small REST surface cover current needs.

## Consequences
- Services are reusable by workers, tests and seeds unchanged.
- Extracting a service later means moving `src/server/<x>` plus its adapter.
  No domain rewrite.
