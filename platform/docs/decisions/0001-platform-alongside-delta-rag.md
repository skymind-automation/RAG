# ADR-0001: Build the platform alongside the existing Delta RAG service

**Status:** Accepted

## Context
The repository already contains a working Django + pgvector retrieval
service ("Delta RAG") for fleet-maintenance documents (manuals, bulletins,
DTC codes), with its own tests and golden evaluation set. The ITSM
specification requires a TypeScript/Next.js/Prisma stack, and says not to
silently replace working infrastructure.

## Decision
Build the ITSM platform as a self-contained application in `platform/`.
Leave the Django service untouched. Share nothing at runtime for now: each
has its own database. The ITSM RAG subsystem (Phase 6) is implemented in
TypeScript behind a `Retriever` interface, carrying over Delta RAG's
retrieval lessons (see docs/ai-rag.md).

## Alternatives considered
- **Replace the Django service:** destroys a tested, domain-specific system
  that other consumers (Fleet ERP, n8n investigator) call.
- **Use Delta RAG as the ITSM retrieval backend:** its schema is shaped
  around vehicles (model/year pre-filters) and has no tenant or
  per-requester access model. Retrofitting multi-tenancy into another
  service's tables would weaken isolation guarantees.
- **Separate repository:** cleaner boundaries, but the user asked for this
  work here, and co-location keeps the retrieval lessons in view.

## Consequences
- Two stacks in one repo; CI runs them independently.
- A later integration is possible: ITSM tickets could cite fleet documents
  by calling Delta RAG's `POST /retrieve` as an external knowledge source,
  mediated by RAGService, with results labelled and never mixed into
  tenant-owned embeddings.
