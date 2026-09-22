"""Ingestion pipeline: parsed files -> Postgres rows -> embeddings.

Idempotent by content hash. Re-running over an unchanged corpus is a no-op;
re-running after an edit replaces that document's chunks wholesale rather than
trying to diff them, because chunk boundaries move when a heading changes and a
partial update would leave orphans.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path

from django.conf import settings
from django.db import transaction

from knowledge.constants import DocType
from knowledge.ingestion.chunking import render_for_embedding
from knowledge.ingestion.embeddings import get_embedding_backend
from knowledge.ingestion.parsers import (
    ParseError,
    ParsedDocument,
    ParsedDTC,
    detect_doc_type,
    parse_file,
)
from knowledge.models import Chunk, DTCCode, Document

logger = logging.getLogger(__name__)

SUPPORTED_SUFFIXES = {".md", ".markdown", ".txt", ".csv"}
# Files that live in the corpus tree but are about the corpus rather than part
# of it. Ingesting these produces chunks with no vehicle tags, which then fail
# validation and make a clean ingest look broken.
IGNORED_STEMS = {"readme", "index", "changelog", "license", "notes"}


@dataclass
class IngestStats:
    documents_created: int = 0
    documents_updated: int = 0
    documents_skipped: int = 0
    chunks_written: int = 0
    dtc_rows_written: int = 0
    embeddings_computed: int = 0
    errors: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "documents_created": self.documents_created,
            "documents_updated": self.documents_updated,
            "documents_skipped": self.documents_skipped,
            "chunks_written": self.chunks_written,
            "dtc_rows_written": self.dtc_rows_written,
            "embeddings_computed": self.embeddings_computed,
            "errors": self.errors,
        }


def discover(root: Path) -> list[Path]:
    """Every ingestible file under `root`, in a stable order."""
    if root.is_file():
        return [root]
    return sorted(
        p for p in root.rglob("*")
        if p.is_file()
        and p.suffix.lower() in SUPPORTED_SUFFIXES
        and not p.name.startswith(".")
        and p.stem.lower() not in IGNORED_STEMS
    )


def ingest_path(
    root: Path,
    *,
    force: bool = False,
    dry_run: bool = False,
    stats: IngestStats | None = None,
) -> IngestStats:
    stats = stats or IngestStats()
    for path in discover(root):
        try:
            parsed = parse_file(path)
        except (ParseError, ValueError) as exc:
            # One bad file must not abort a corpus-wide ingest; collect and
            # report at the end with a nonzero exit code.
            logger.error("parse failed: %s", exc)
            stats.errors.append(str(exc))
            continue

        try:
            if isinstance(parsed, list):
                _ingest_dtc_rows(parsed, path, stats, dry_run=dry_run)
            else:
                _ingest_document(parsed, stats, force=force, dry_run=dry_run)
        except Exception as exc:  # noqa: BLE001 - reported, not swallowed
            logger.exception("ingest failed for %s", path)
            stats.errors.append(f"{path}: {exc}")
    return stats


@transaction.atomic
def _ingest_document(
    parsed: ParsedDocument, stats: IngestStats, *, force: bool, dry_run: bool
) -> None:
    meta = parsed.meta
    existing = Document.objects.filter(source_file=meta.source_file).first()

    if existing and existing.content_hash == parsed.content_hash and not force:
        stats.documents_skipped += 1
        logger.debug("unchanged, skipping: %s", meta.source_file)
        return

    if dry_run:
        logger.info(
            "[dry-run] %s %s -> %d chunk(s) (model=%s years=%s system=%s)",
            "update" if existing else "create", meta.source_file,
            len(parsed.chunks), meta.model,
            f"{meta.model_year_start}-{meta.model_year_end}", meta.system,
        )
        stats.chunks_written += len(parsed.chunks)
        return

    fields = dict(
        title=meta.title,
        doc_type=meta.doc_type,
        source_uri=meta.source_uri,
        oem=meta.oem,
        model=meta.model,
        model_year_start=meta.model_year_start,
        model_year_end=meta.model_year_end,
        system=meta.system,
        tsb_number=meta.tsb_number,
        revision=meta.revision,
        issued_on=meta.issued_on,
        access_level=meta.access_level,
        is_synthetic=meta.is_synthetic,
        content_hash=parsed.content_hash,
        metadata=_jsonable(parsed.raw_metadata),
    )

    if existing:
        for key, value in fields.items():
            setattr(existing, key, value)
        existing.save()
        document = existing
        # Chunk boundaries move when headings change, so replace rather than
        # diff. The FK cascades, and we are inside a transaction.
        document.chunks.all().delete()
        stats.documents_updated += 1
    else:
        document = Document.objects.create(source_file=meta.source_file, **fields)
        stats.documents_created += 1

    backend = get_embedding_backend()
    payloads = [
        render_for_embedding(c.heading_path, c.content) for c in parsed.chunks
    ]
    vectors = backend.embed_documents(payloads)
    stats.embeddings_computed += len(vectors)

    Chunk.objects.bulk_create(
        [
            Chunk(
                document=document,
                ordinal=index,
                heading_path=chunk.heading_path,
                content=chunk.content,
                content_chars=len(chunk.content),
                contains_table=chunk.contains_table,
                embedding=vector,
                embedding_model=backend.model,
                doc_type=document.doc_type,
                model=document.model,
                model_year_start=document.model_year_start,
                model_year_end=document.model_year_end,
                system=chunk.system,
                tsb_number=document.tsb_number,
                access_level=document.access_level,
                symptom_keywords=chunk.symptom_keywords,
                dtc_codes=chunk.dtc_codes,
            )
            for index, (chunk, vector) in enumerate(zip(parsed.chunks, vectors))
        ]
    )
    stats.chunks_written += len(parsed.chunks)
    logger.info("ingested %s (%d chunks)", meta.source_file, len(parsed.chunks))


@transaction.atomic
def _ingest_dtc_rows(
    rows: list[ParsedDTC], path: Path, stats: IngestStats, *, dry_run: bool
) -> None:
    if dry_run:
        logger.info("[dry-run] %s -> %d DTC row(s)", path, len(rows))
        stats.dtc_rows_written += len(rows)
        return

    source_doc, _ = Document.objects.get_or_create(
        source_file=str(path),
        content_hash=_file_hash(path),
        defaults=dict(
            title=f"DTC table: {path.name}",
            doc_type=DocType.DTC_TABLE,
            system="general",
        ),
    )

    backend = get_embedding_backend()
    # Only the description is embedded -- that is what lets "check engine
    # light for a misfire" resolve to the P0300 series. Causes and severity
    # are structured fields and are looked up, not searched.
    vectors = backend.embed_documents([r.description for r in rows])
    stats.embeddings_computed += len(vectors)

    for row, vector in zip(rows, vectors):
        DTCCode.objects.update_or_create(
            code=row.code,
            defaults=dict(
                description=row.description,
                likely_causes=row.likely_causes,
                severity=row.severity,
                applicable_models=row.applicable_models,
                applicable_year_start=row.applicable_year_start,
                applicable_year_end=row.applicable_year_end,
                system=row.system,
                is_generic=row.is_generic,
                advisor_guidance=row.advisor_guidance,
                description_embedding=vector,
                embedding_model=backend.model,
                source_document=source_doc,
            ),
        )
    stats.dtc_rows_written += len(rows)
    logger.info("ingested %d DTC rows from %s", len(rows), path)


def reembed_stale(batch_size: int = 128) -> int:
    """Re-embed every row whose stored vector predates the current model.

    Run after changing RAG_EMBEDDING_BACKEND or RAG_EMBEDDING_MODEL. Mixing
    vectors from two models in one index makes distances meaningless.
    """
    backend = get_embedding_backend()
    total = 0

    stale = Chunk.objects.exclude(embedding_model=backend.model).order_by("id")
    while True:
        batch = list(stale[:batch_size])
        if not batch:
            break
        payloads = [render_for_embedding(c.heading_path, c.content) for c in batch]
        for chunk, vector in zip(batch, backend.embed_documents(payloads)):
            chunk.embedding = vector
            chunk.embedding_model = backend.model
        Chunk.objects.bulk_update(batch, ["embedding", "embedding_model"])
        total += len(batch)

    stale_dtc = DTCCode.objects.exclude(embedding_model=backend.model).order_by("id")
    while True:
        batch = list(stale_dtc[:batch_size])
        if not batch:
            break
        vectors = backend.embed_documents([d.description for d in batch])
        for dtc, vector in zip(batch, vectors):
            dtc.description_embedding = vector
            dtc.embedding_model = backend.model
        DTCCode.objects.bulk_update(batch, ["description_embedding", "embedding_model"])
        total += len(batch)

    return total


def _file_hash(path: Path) -> str:
    import hashlib

    return hashlib.sha256(path.read_bytes()).hexdigest()


def _jsonable(data: dict) -> dict:
    """Front matter can contain dates; JSONField needs them stringified."""
    import datetime

    out = {}
    for key, value in data.items():
        if isinstance(value, (datetime.date, datetime.datetime)):
            out[key] = value.isoformat()
        else:
            out[key] = value
    return out
