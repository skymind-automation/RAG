# Schema reference

Three tables. The shape follows the retrieval flow, not the source documents.

## `rag_documents`

One row per source file.

| Column | Notes |
| --- | --- |
| `title`, `doc_type`, `source_file`, `source_uri` | `doc_type` ∈ manual, tsb, dtc_table, tech_note |
| `oem`, `model`, `model_year_start`, `model_year_end`, `system` | Applicability. Blank `model` = applies to all. |
| `tsb_number`, `revision`, `issued_on` | Bulletin identity; required for a TSB, because citations need it |
| `access_level` | public < advisor < technician < internal |
| `is_synthetic` | True for sample corpora, so eval numbers can't be mistaken for production ones |
| `content_hash` | SHA-256 of the raw bytes; drives idempotent re-ingest |
| `metadata` | Front matter keys the schema doesn't model |

Constraints: `uniq_doc_source_hash` on (`source_file`, `content_hash`);
`ck_doc_year_range` forbids an end year before the start year.

## `rag_chunks`

The retrievable unit.

| Column | Notes |
| --- | --- |
| `document_id`, `ordinal` | Unique together |
| `heading_path` (text[]) | Heading breadcrumb, outermost first. Used in citations and indexed at weight A. |
| `content` | Markdown. Tables stay tables. |
| `contains_table`, `content_chars` | |
| `embedding` vector(1024) | HNSW, `vector_cosine_ops` |
| `embedding_model` | Which model produced it; drives `ingest --reembed` |
| `doc_type`, `model`, `model_year_*`, `system`, `tsb_number`, `access_level` | **Denormalized from the document** so the pre-filter never joins |
| `symptom_keywords` (text[]) | Advisor-phrasing terms. GIN. |
| `dtc_codes` (text[]) | Codes mentioned in the body, for code → narrative lookup. GIN. |
| `search_vector` tsvector | **GENERATED ALWAYS**, see below |

### Why `search_vector` is generated, not maintained

A Postgres GENERATED column is recomputed on every write, so there is no code
path anywhere in the project that can insert a chunk whose lexical index is
stale — the failure mode where half the corpus is invisible to BM25 and nobody
notices for a month simply cannot occur.

The definition lives in `rag_chunk_search_vector` (migration `0001`):

```
setweight(to_tsvector('english', heading_path),     'A')
setweight(to_tsvector('english', dtc_codes),        'A')
setweight(to_tsvector('english', symptom_keywords), 'A')
setweight(to_tsvector('english', tsb_number),       'A')
setweight(to_tsvector('english', content),          'B')
```

A term matching a procedure heading, a TSB number or a DTC code is a much
stronger signal than the same term buried in a torque table, and `ts_rank_cd`
reflects that with no application-side scoring.

`array_to_string` is only STABLE, and a generated column requires IMMUTABLE,
hence the `rag_immutable_array_to_string` wrapper — its element type is pinned
to `text`, so the immutability claim is true rather than merely asserted.

## `rag_dtc_codes`

A plain lookup table. **Not** chunked, **not** embedded as prose.

| Column | Notes |
| --- | --- |
| `code` | Unique, uppercase, `[PBCU][0-9][0-9A-F][0-9A-F]{2}` |
| `description` | |
| `likely_causes` (text[]) | Ordered most-likely-first |
| `severity` | info / low / moderate / high / critical |
| `applicable_models` (text[]) | Empty = generic OBD-II. GIN. |
| `applicable_year_start/end`, `system`, `is_generic` | |
| `advisor_guidance` | Plain-language line an advisor can say to a customer |
| `description_embedding` vector(1024) | The **only** vector here |

The description embedding exists so a query with no code in it ("check engine
light for a misfire") can resolve to the P0300 series. Causes and severity are
structured fields, looked up rather than searched.

## Indexes

| Index | Purpose |
| --- | --- |
| `ix_chunk_prefilter` (model, doc_type, system) | The pre-filter path |
| `ix_chunk_model_years` | Year applicability |
| `ix_chunk_dtc_codes`, `ix_chunk_symptoms` (GIN) | Array containment |
| `ix_chunk_search_vector` (GIN) | Lexical |
| `ix_chunk_content_trgm` (GIN, trigram) | Part numbers and misspellings the stemmer destroys |
| `ix_chunk_embedding_hnsw` | Dense, cosine |
| `ix_dtc_description_hnsw` | DTC description search |
| `ix_dtc_code_prefix` | Family fallback (P0307 → P030x) |

HNSW rather than IVFFlat: no training pass, so a freshly-ingested corpus is
searchable immediately, and recall holds better as the corpus grows.
