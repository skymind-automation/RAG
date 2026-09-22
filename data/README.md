# Sample corpus

These files are **representative samples, not real OEM documents**. Every one
carries `synthetic: true` in its front matter, which is stored on the
`rag_documents.is_synthetic` column and reported by `/api/v1/healthz` and by
the eval harness — so retrieval numbers measured here can never be mistaken
for numbers measured on the real corpus.

Why they exist: the whole point of building ingestion before retrieval logic is
to look at chunk quality on documents shaped like the real thing. These are
modelled on the real structure of OEM service manuals and TSBs — YAML front
matter for applicability, procedure-level headings, markdown torque/spec
tables, and the symptom → cause → correction narrative a bulletin uses — so the
chunker and the metadata extractor are exercised against the shapes they will
meet in production. The vehicle model names are real because applicability
filtering has to be tested against real model spellings; the technical content
is written for this repository and is not fit for use on a vehicle.

## Replacing them with the real corpus

1. Drop the real files into `data/manuals/`, `data/tsbs/`, `data/dtc/`.
2. Add front matter (or extend `knowledge/ingestion/parsers.py` to read the
   OEM's own metadata sidecar). `model` is mandatory — ingestion refuses a
   document it cannot tag, because an untagged chunk is invisible to every
   filtered query.
3. Scanned PDFs need an OCR pass first; `parse_manual` expects text.
4. Re-run `manage.py ingest --path data --force`, then
   `manage.py eval_retrieval` and compare against the numbers committed in
   `eval/`.

## Layout

    manuals/   procedure- and section-structured service manual extracts
    tsbs/      one bulletin per file
    dtc/       DTC lookup table as CSV (never chunked, never embedded as prose)
