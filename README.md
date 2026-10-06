# Delta RAG — fleet maintenance retrieval

> **Repository layout.** This repository holds two independent systems:
> the Delta RAG retrieval service described below (Django, repository root),
> and the **Delta ITSM platform** (Next.js multi-tenant IT service
> management) in [`platform/`](platform/README.md). They share no runtime
> state; see [ADR-0001](platform/docs/decisions/0001-platform-alongside-delta-rag.md).

Retrieval backend for the Delta RAG system, scoped to the **service reception /
service advisor** path described in the Notion working doc: semi-structured
content (OEM manuals, service bulletins, DTC tables) answering lookup,
interval and known-issue questions.

The service returns **evidence with citations, never a synthesized answer**.
That boundary is deliberate — it is what makes a wrong answer diagnosable as
either a retrieval miss or a generation failure, rather than a mystery.

Built in the order the doc sequences it: schema → ingestion → retrieval →
eval, with the golden set written alongside ingestion so retrieval has
something to be measured against from the first commit.

## What's here

| Layer | Where | What it does |
| --- | --- | --- |
| Schema | `knowledge/models.py`, `knowledge/migrations/` | `documents`, `chunks` (pgvector + generated tsvector), `dtc_codes` |
| Ingestion | `knowledge/ingestion/` | Heading-aware chunking, metadata tagging, embedding, idempotent load |
| Retrieval | `knowledge/retrieval/` | Entity pre-filter, DTC shortcut, BM25 + pgvector + RRF, confidence gate |
| API | `knowledge/api/` | `POST /retrieve`, `GET /dtc/<code>`, `GET /dtc/search`, `GET /healthz` |
| Eval | `eval/golden_qa.yaml`, `knowledge/evaluation.py` | 32 advisor-phrased cases, scored by shape |

## Quick start

```bash
python -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env                 # then edit

createdb delta_rag
psql delta_rag -c 'CREATE EXTENSION IF NOT EXISTS vector;'

set -a && . ./.env && set +a
./manage.py migrate
./manage.py ingest                   # loads data/
./manage.py eval_retrieval           # scores retrieval
./manage.py runserver
```

`RAG_EMBEDDING_BACKEND=hashing` (the default) needs no API key and no network,
so the whole pipeline is runnable and testable offline. It is a deterministic
lexical-overlap stand-in, **not** a quality substitute — see
[Embeddings](#embeddings).

## The retrieval flow

```
advisor query
  ↓ extract entities (model, year, mileage, DTC)   regex + alias table, no LLM call
  ↓ hard pre-filter: model, year, access role
  ↓ DTC code present? ──yes──► exact table lookup, vector search skipped entirely
  ↓ no
  ↓ hybrid search over the filtered set
  │    lexical  Postgres FTS over a generated tsvector  (headings/TSB/DTC at weight A)
  │    dense    pgvector HNSW, cosine
  │    fuse     Reciprocal Rank Fusion, k=60
  ↓ soft boosts (system match, exact model, TSB number, DTC mention)
  ↓ rerank top-k  (pluggable; no-op by default, and it says so)
  ↓ confidence gate → `sufficient: false` means "insufficient documentation"
  ↓ passages + mandatory citations (doc name + section + TSB number)
```

### Four decisions worth knowing about

**The entity pre-filter is the highest-leverage piece, and `model_year` is
never relaxed.** Widening a model filter costs precision; widening a year
filter produces *wrong* answers — a bulletin scoped to 2021-2023 does not apply
to a 2019 vehicle, and surfacing it hands the advisor a confident, billable
recommendation for work that will not fix the truck. An empty result set is the
correct answer there, and the service says so rather than improvising.

**An inferred system is a boost, never a gate.** "Shudder on cold start" scores
as `engine` on keywords, but the bulletin that answers it is filed under
`transmission`. Gating on the inferred value hid the one right document and
returned a confident page of wrong ones. Cross-system symptoms are the normal
case in this domain. A system supplied *explicitly* by the caller is trusted
and does gate.

**The lexical retriever ORs its terms.** `websearch_to_tsquery` and
`plainto_tsquery` both AND, so a single absent word excludes a chunk entirely —
"What's due at 60k miles?" matched nothing at all, because no manual contains
the token "60k", and the lexical half of the hybrid silently contributed zero
rows. OR-ing keeps recall and `ts_rank_cd` still ranks multi-term matches
higher. `knowledge/retrieval/expansion.py` closes the remaining vocabulary gaps
(`60k` → `60,000` → `97,000 km`) on the lexical side only.

**The fused RRF score is not a confidence signal.** RRF depends only on *rank*,
so the top result of a search over a corpus containing nothing relevant scores
almost exactly the same as one that found the right bulletin — a threshold on
it fires at random. Confidence is computed separately in
`knowledge/retrieval/confidence.py` from the absolute retriever scores (cosine
similarity and normalized `ts_rank_cd`) plus a bonus when both retrievers
independently rank the same chunk first. That is what the safety gate reads.

## Schema

Three tables, shaped around the retrieval flow rather than around the sources.

`rag_chunks` carries **denormalized** `model` / `model_year_*` / `system` /
`doc_type` / `access_level` columns mirroring its document. Every advisor query
filters on those before doing anything else, and a join on every vector scan is
the difference between a filter Postgres pushes into the index and one it
applies afterwards.

`search_vector` is a Postgres **GENERATED** column, not a trigger and not
something application code maintains — so no code path can insert a chunk whose
lexical index is stale. The weighting lives in one SQL function
(`rag_chunk_search_vector`, migration `0001`): headings, TSB number, DTC codes
and symptom keywords at weight A, body text at weight B.

`rag_dtc_codes` is a plain lookup table, deliberately **not** chunked and not
embedded as prose. The only vector on it is `description_embedding`, which
exists so "check engine light for a misfire" resolves to the P0300 series.

## Ingestion

| Source | Treatment |
| --- | --- |
| Manual | Chunked by procedure/section heading. Tables preserved as markdown and never split. |
| TSB | One bulletin, one chunk — the symptom → cause → fix narrative only makes sense whole. |
| DTC table | Rows into `rag_dtc_codes`. Never chunked, never embedded as prose. |

Ingestion **refuses** a document it cannot tag with a `model`. An untagged
chunk is invisible to every filtered query, which surfaces months later as an
unreproducible retrieval bug rather than as an ingest error.

Re-ingest is idempotent by content hash. A changed document has its chunks
replaced wholesale rather than diffed, because chunk boundaries move when a
heading changes and a partial update leaves orphans.

Look at chunk quality before trusting any of it:

```bash
./manage.py inspect_chunks data/manuals/transit-brakes-2021-2024.md
./manage.py ingest --dry-run
```

## Evaluation

`eval/golden_qa.yaml` holds 32 advisor-phrased cases across the three query
shapes from the doc, plus applicability and negative cases. It grades
**retrieval only** — no LLM in the loop.

```bash
./manage.py eval_retrieval --verbose
./manage.py eval_retrieval --shape bulletin
./manage.py eval_retrieval --json eval/results/run.json --fail-under 0.9
```

Current baseline (`eval/results/baseline-hashing.json`), on the sample corpus
with the offline hashing backend and **no reranker**:

| shape | cases | hit@8 | MRR | recall@8 | precision@8 |
| --- | --- | --- | --- | --- | --- |
| lookup | 7 | 1.000 | 1.000 | 1.000 | 1.000 |
| interval | 13 | 1.000 | 0.793 | 0.923 | 0.217 |
| bulletin | 9 | 1.000 | 0.815 | 1.000 | 0.155 |
| **overall** | **32** | **1.000** | **0.850** | **0.966** | **0.387** |

Applicability and negative cases assert behaviour rather than ranking and are
excluded from those averages; they are pass/fail and all 32 cases pass.

**Read these numbers narrowly.** They are measured on a small synthetic corpus
with a stand-in embedding backend. They demonstrate that the harness works and
that the pipeline has no gross defects — they are not a forecast of production
retrieval quality. Low precision@8 is expected and not alarming here: with 31
chunks the top-8 necessarily includes most of the corpus. Re-baseline
everything once the real corpus lands.

The harness earned its place immediately: writing it surfaced four real defects
(duplicate passages in the DTC route, the year filter relaxing itself, the
inferred-system gate, and the RRF-as-confidence mistake) that all looked fine
when eyeballing results.

## Embeddings

Anthropic does not serve an embeddings endpoint, so the production backend is
Voyage. Set `RAG_EMBEDDING_BACKEND=voyage` and `VOYAGE_API_KEY`.

The `hashing` backend is a deterministic offline stand-in that models lexical
overlap, not meaning. Dense recall measured under it is a **floor**, not a
forecast. It is flagged in the ingest output, the eval report and `/healthz` so
a number produced with it can never be quietly mistaken for a production one.

Changing backend or model invalidates every stored vector — the model name is
written onto each row:

```bash
RAG_EMBEDDING_BACKEND=voyage ./manage.py ingest --reembed
```

`RAG_MIN_CONFIDENCE` is calibrated against the score distribution and must be
re-tuned against the golden set when the backend changes.

## API

```bash
curl -X POST localhost:8000/api/v1/retrieve -H 'Content-Type: application/json' -d '{
  "query": "customer says shudder on cold start, any bulletins?",
  "vehicle_context": {"model": "Ford Transit", "model_year": 2022, "mileage": 64000},
  "role": "advisor",
  "top_k": 5
}'

curl localhost:8000/api/v1/dtc/P0299?model=cascadia&year=2022
curl 'localhost:8000/api/v1/dtc/search?q=check+engine+light+for+a+misfire'
curl localhost:8000/api/v1/healthz
```

`vehicle_context` always wins over anything parsed from the query text — the
advisor's screen is ground truth, the sentence they typed is a guess. The
response reports which filters were applied, which were relaxed and why, so a
thin result set is explainable rather than mysterious.

Access control is applied at retrieval time via `role`: technician notes and
internal documents never reach an advisor-role query.

## The sample corpus is not real documents

Everything in `data/` is a **representative sample**, marked `synthetic: true`
in front matter and surfaced on `is_synthetic`, in `/healthz` and in the eval
report. The files are modelled on the real structure of OEM manuals and TSBs so
the chunker and metadata extractor are exercised against shapes they will meet
in production; the technical content is written for this repository and is not
fit for use on a vehicle. See `data/README.md` for how to swap in the real
corpus.

## Not built yet, and deliberately

Following the doc's sequencing — hybrid + reranker first, graph later, agentic
orchestration last:

- **Reranker** — the seam exists (`knowledge/retrieval/rerank.py`) with a
  cross-encoder implementation ready. The default is an explicit no-op that
  *reports itself as a no-op*, so eval numbers are never credited to a
  reranker that isn't running. Turn it on once the golden set is large enough
  to prove the +5-15 MRR the literature claims; a cross-encoder is latency you
  cannot justify on 32 cases.
- **Query rewriting / HyDE** — the deterministic expansion covers the known
  vocabulary gaps. Reach for a model only where that measurably stops working.
- **Graph-augmented retrieval** — needs a volume of TSBs and incident reports
  that does not exist yet.
- **Agentic orchestration** — explicitly deferred until the basic pipeline is
  solid.
- **Answer synthesis** — intentionally the caller's job. When it is added, it
  belongs behind the `sufficient` flag with mandatory citation enforcement.
- **OCR** — scanned manuals need a text extraction pass ahead of `parse_manual`.
- **Freshness** — manuals and work orders need separate re-index cadences.

## Integration

Per the doc's architecture-fit section: this is the Skymind MRO (Django/Python)
side. The `knowledge` app is self-contained — copy it across and merge the
`RAG_*` settings block. The Fleet ERP (Next.js) calls `POST /retrieve`
directly; the n8n Fleet Incident Investigator calls `GET /dtc/<code>` when
telemetry flags a fault, before drafting a report. The vector store stays
centralized in Postgres rather than SQLite in the ERP.

## Tests

```bash
.venv/bin/python -m pytest tests -q     # 60 tests; integration ones need Postgres
```
