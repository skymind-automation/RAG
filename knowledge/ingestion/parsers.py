"""Source-file parsers.

Three shapes, three treatments, straight from the retrieval design:

  manual    -> chunk by procedure/section heading, tables preserved as markdown
  tsb       -> one bulletin, one chunk
  dtc table -> rows into `rag_dtc_codes`, never chunked or embedded as prose

Every parser returns plain dataclasses; nothing here touches the database, so
parsers are unit-testable without Postgres and chunk quality can be inspected
before any of it is written.
"""
from __future__ import annotations

import csv
import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from django.conf import settings

from knowledge.constants import AccessLevel, DocType, Severity, VehicleSystem
from knowledge.ingestion.chunking import TextChunk, chunk_markdown
from knowledge.ingestion.metadata import (
    DocumentMeta,
    extract_dtc_codes,
    extract_symptom_keywords,
    infer_system,
    normalize_model,
    normalize_system,
    parse_front_matter,
    parse_year_range,
)


class ParseError(Exception):
    """Raised when a source file cannot be turned into valid metadata.

    Ingestion fails loudly rather than storing a chunk with a missing `model`
    tag: an untagged chunk is invisible to every filtered query, which looks
    like a retrieval bug months later.
    """


@dataclass
class ParsedChunk:
    heading_path: list[str]
    content: str
    contains_table: bool
    system: str
    symptom_keywords: list[str] = field(default_factory=list)
    dtc_codes: list[str] = field(default_factory=list)


@dataclass
class ParsedDocument:
    meta: DocumentMeta
    chunks: list[ParsedChunk]
    content_hash: str
    raw_metadata: dict = field(default_factory=dict)


@dataclass
class ParsedDTC:
    code: str
    description: str
    likely_causes: list[str]
    severity: str
    applicable_models: list[str]
    applicable_year_start: int | None
    applicable_year_end: int | None
    system: str
    is_generic: bool
    advisor_guidance: str = ""


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# --------------------------------------------------------------------------
# Manuals
# --------------------------------------------------------------------------

def parse_manual(path: Path) -> ParsedDocument:
    raw = path.read_text(encoding="utf-8")
    fm, body = parse_front_matter(raw)

    year_start, year_end = parse_year_range(fm.get("model_year") or fm.get("model_years"))
    declared_system = fm.get("system")
    meta = DocumentMeta(
        title=fm.get("title") or _title_from_body(body) or path.stem,
        doc_type=DocType.MANUAL,
        source_file=str(path),
        source_uri=fm.get("source_uri", "") or "",
        oem=(fm.get("oem") or "").strip(),
        model=normalize_model(fm.get("model")),
        model_year_start=year_start,
        model_year_end=year_end,
        system=normalize_system(declared_system) if declared_system
        else infer_system(body),
        access_level=fm.get("access_level") or AccessLevel.ADVISOR,
        is_synthetic=bool(fm.get("synthetic", False)),
        extra={k: v for k, v in fm.items() if k not in _KNOWN_FM_KEYS},
    )
    _require_valid(meta, path)

    text_chunks = chunk_markdown(
        body,
        max_chars=settings.RAG_CHUNK_MAX_CHARS,
        min_chars=settings.RAG_CHUNK_MIN_CHARS,
    )
    chunks = [_to_parsed_chunk(tc, meta) for tc in text_chunks]
    if not chunks:
        raise ParseError(f"{path}: manual produced no chunks")
    return ParsedDocument(meta=meta, chunks=chunks,
                          content_hash=sha256_bytes(raw.encode("utf-8")),
                          raw_metadata=fm)


# --------------------------------------------------------------------------
# Technical Service Bulletins
# --------------------------------------------------------------------------

def parse_tsb(path: Path) -> ParsedDocument:
    raw = path.read_text(encoding="utf-8")
    fm, body = parse_front_matter(raw)

    tsb_number = str(fm.get("tsb_number") or _tsb_number_from_body(body) or "").strip()
    year_start, year_end = parse_year_range(fm.get("model_year") or fm.get("model_years"))
    declared_system = fm.get("system")

    meta = DocumentMeta(
        title=fm.get("title") or _title_from_body(body) or path.stem,
        doc_type=DocType.TSB,
        source_file=str(path),
        source_uri=fm.get("source_uri", "") or "",
        oem=(fm.get("oem") or "").strip(),
        model=normalize_model(fm.get("model")),
        model_year_start=year_start,
        model_year_end=year_end,
        system=normalize_system(declared_system) if declared_system
        else infer_system(body),
        tsb_number=tsb_number,
        revision=str(fm.get("revision") or ""),
        issued_on=fm.get("issued_on"),
        access_level=fm.get("access_level") or AccessLevel.ADVISOR,
        is_synthetic=bool(fm.get("synthetic", False)),
        extra={k: v for k, v in fm.items() if k not in _KNOWN_FM_KEYS},
    )
    _require_valid(meta, path)

    # One bulletin = one chunk. The symptom -> cause -> fix narrative only
    # makes sense whole, and it is short enough to stay whole.
    text_chunks = chunk_markdown(body, single_chunk=True)
    if not text_chunks:
        raise ParseError(f"{path}: TSB body is empty")

    chunks = [_to_parsed_chunk(text_chunks[0], meta)]
    # Declared symptom keywords from front matter are authoritative and get
    # unioned with whatever the body scan found.
    declared = [str(s).lower().strip() for s in (fm.get("symptoms") or [])]
    merged = list(dict.fromkeys(declared + chunks[0].symptom_keywords))
    chunks[0].symptom_keywords = merged

    declared_codes = [str(c).upper().strip() for c in (fm.get("dtc_codes") or [])]
    chunks[0].dtc_codes = list(dict.fromkeys(declared_codes + chunks[0].dtc_codes))

    return ParsedDocument(meta=meta, chunks=chunks,
                          content_hash=sha256_bytes(raw.encode("utf-8")),
                          raw_metadata=fm)


# --------------------------------------------------------------------------
# DTC code tables
# --------------------------------------------------------------------------

_DTC_REQUIRED_COLUMNS = {"code", "description"}


def parse_dtc_table(path: Path) -> list[ParsedDTC]:
    """Parse a DTC table from CSV.

    Never embedded as prose and never chunked. `likely_causes` and
    `applicable_models` are pipe-delimited inside their CSV cells.
    """
    raw = path.read_text(encoding="utf-8")
    reader = csv.DictReader(raw.splitlines())
    if not reader.fieldnames:
        raise ParseError(f"{path}: DTC table has no header row")

    columns = {c.strip().lower() for c in reader.fieldnames}
    missing = _DTC_REQUIRED_COLUMNS - columns
    if missing:
        raise ParseError(f"{path}: DTC table missing required column(s): {sorted(missing)}")

    out: list[ParsedDTC] = []
    for lineno, row in enumerate(reader, start=2):
        row = {(k or "").strip().lower(): (v or "").strip() for k, v in row.items()}
        code = row.get("code", "").upper()
        if not code:
            continue
        if not re.fullmatch(r"[PBCU][0-9][0-9A-F][0-9A-F]{2}", code):
            raise ParseError(f"{path}:{lineno}: {code!r} is not a valid DTC code")

        severity = (row.get("severity") or Severity.MODERATE).lower()
        if severity not in Severity.ALL:
            raise ParseError(f"{path}:{lineno}: unknown severity {severity!r}")

        models = [normalize_model(m) for m in _split_cell(row.get("applicable_models"))]
        year_start, year_end = parse_year_range(row.get("model_years"))

        out.append(
            ParsedDTC(
                code=code,
                description=row.get("description", ""),
                likely_causes=_split_cell(row.get("likely_causes")),
                severity=severity,
                applicable_models=[m for m in models if m],
                applicable_year_start=year_start,
                applicable_year_end=year_end,
                system=normalize_system(row.get("system")),
                # A code with no model restriction is generic OBD-II.
                is_generic=not models,
                advisor_guidance=row.get("advisor_guidance", ""),
            )
        )
    if not out:
        raise ParseError(f"{path}: DTC table contained no rows")
    return out


# --------------------------------------------------------------------------
# Dispatch
# --------------------------------------------------------------------------

PARSERS = {
    DocType.MANUAL: parse_manual,
    DocType.TSB: parse_tsb,
}


def detect_doc_type(path: Path) -> str:
    """Infer doc type from front matter, then directory, then filename.

    Front matter wins: a TSB filed in the wrong directory should still ingest
    as a TSB.
    """
    if path.suffix.lower() == ".csv":
        return DocType.DTC_TABLE
    try:
        fm, _ = parse_front_matter(path.read_text(encoding="utf-8"))
    except (ValueError, UnicodeDecodeError):
        fm = {}
    declared = str(fm.get("doc_type") or "").strip().lower()
    if declared in DocType.ALL:
        return declared

    parts = {p.lower() for p in path.parts}
    if {"tsbs", "tsb", "bulletins"} & parts:
        return DocType.TSB
    if {"manuals", "manual"} & parts:
        return DocType.MANUAL
    if re.search(r"\btsb\b", path.stem, re.IGNORECASE):
        return DocType.TSB
    return DocType.MANUAL


def parse_file(path: Path) -> ParsedDocument | list[ParsedDTC]:
    doc_type = detect_doc_type(path)
    if doc_type == DocType.DTC_TABLE:
        return parse_dtc_table(path)
    parser = PARSERS.get(doc_type)
    if parser is None:
        raise ParseError(f"{path}: no parser for doc_type {doc_type!r}")
    return parser(path)


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------

_KNOWN_FM_KEYS = {
    "title", "doc_type", "model", "model_year", "model_years", "system", "oem",
    "tsb_number", "revision", "issued_on", "source_uri", "access_level",
    "synthetic", "symptoms", "dtc_codes",
}


def _to_parsed_chunk(tc: TextChunk, meta: DocumentMeta) -> ParsedChunk:
    haystack = f"{' '.join(tc.heading_path)}\n{tc.content}"
    return ParsedChunk(
        heading_path=list(tc.heading_path),
        content=tc.content,
        contains_table=tc.contains_table,
        # A chunk can belong to a different system than its parent document --
        # an engine manual has a cooling-system section. Fall back to the
        # document's system when the chunk gives no signal.
        system=infer_system(haystack, default=meta.system),
        symptom_keywords=extract_symptom_keywords(haystack),
        dtc_codes=extract_dtc_codes(haystack),
    )


def _require_valid(meta: DocumentMeta, path: Path) -> None:
    problems = meta.validate()
    if not meta.model:
        problems.append(
            "no `model` in front matter; an untagged chunk is invisible to "
            "every model-filtered query"
        )
    if problems:
        raise ParseError(f"{path}: " + "; ".join(problems))


def _split_cell(value: str | None) -> list[str]:
    if not value:
        return []
    return [part.strip() for part in value.split("|") if part.strip()]


def _title_from_body(body: str) -> str:
    for line in body.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return ""


def _tsb_number_from_body(body: str) -> str:
    match = re.search(r"\b(?:TSB|Bulletin)\s*(?:No\.?|#|Number)?\s*[:\-]?\s*"
                      r"([A-Z0-9][A-Z0-9\-/]{3,})", body, re.IGNORECASE)
    return match.group(1) if match else ""
