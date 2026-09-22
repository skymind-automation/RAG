"""The retrieval service: one entry point implementing the advisor path.

    advisor query
      -> extract entities (model, year, mileage, DTC) -- regex, no LLM call
      -> hard-filter the index by model / year / system
      -> DTC code present? -> exact lookup table, skip vector search entirely
      -> else hybrid search (BM25 + dense, RRF-fused) over the filtered set
      -> rerank the top 5-10
      -> return results with mandatory citations and a confidence signal

The service returns evidence, never prose. Synthesis is the caller's job, and
keeping that boundary means the retrieval layer can be evaluated on its own --
which is the only way to know whether a bad answer was a retrieval failure or a
generation failure.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field

from django.conf import settings

from knowledge.constants import AccessLevel, DocType
from knowledge.ingestion.embeddings import get_embedding_backend
from knowledge.retrieval import dtc as dtc_lookup
from knowledge.retrieval.entities import QueryEntities, extract_entities
from knowledge.retrieval.confidence import score_confidence
from knowledge.retrieval.expansion import expand_lexical_query
from knowledge.retrieval.filters import build_candidate_queryset
from knowledge.retrieval.hybrid import ScoredChunk, hybrid_search
from knowledge.retrieval.rerank import get_reranker

logger = logging.getLogger(__name__)


class Route:
    DTC_EXACT = "dtc_exact"
    HYBRID = "hybrid"
    EMPTY = "empty"


@dataclass
class Citation:
    document_title: str
    document_id: int
    chunk_id: int
    doc_type: str
    section: str
    tsb_number: str
    source_file: str
    source_uri: str
    model: str
    years: str

    def as_dict(self) -> dict:
        return {
            "document_id": self.document_id,
            "document_title": self.document_title,
            "chunk_id": self.chunk_id,
            "doc_type": self.doc_type,
            "section": self.section,
            "tsb_number": self.tsb_number,
            "source_file": self.source_file,
            "source_uri": self.source_uri,
            "model": self.model,
            "years": self.years,
        }


@dataclass
class RetrievalResult:
    route: str
    query: str
    entities: QueryEntities
    passages: list[ScoredChunk] = field(default_factory=list)
    dtc_matches: list[dtc_lookup.DTCMatch] = field(default_factory=list)
    filters: dict = field(default_factory=dict)
    confidence: float = 0.0
    confidence_detail: dict = field(default_factory=dict)
    sufficient: bool = False
    took_ms: int = 0
    notes: list[str] = field(default_factory=list)

    def as_dict(self, include_content: bool = True) -> dict:
        return {
            "route": self.route,
            "query": self.query,
            "entities": self.entities.as_dict(),
            "filters": self.filters,
            "confidence": round(self.confidence, 6),
            "confidence_detail": self.confidence_detail,
            "sufficient": self.sufficient,
            "took_ms": self.took_ms,
            "notes": self.notes,
            "dtc_matches": [m.as_dict() for m in self.dtc_matches],
            "passages": [
                _passage_dict(p, include_content=include_content) for p in self.passages
            ],
        }


def _passage_dict(scored: ScoredChunk, include_content: bool = True) -> dict:
    chunk = scored.chunk
    payload = {
        "chunk_id": chunk.pk,
        "score": round(scored.score, 6),
        "retrievers": scored.retrievers,
        "lexical_rank": scored.lexical_rank,
        "dense_rank": scored.dense_rank,
        "signals": scored.signals,
        "citation": build_citation(chunk).as_dict(),
        "symptom_keywords": chunk.symptom_keywords,
        "dtc_codes": chunk.dtc_codes,
        "contains_table": chunk.contains_table,
    }
    if include_content:
        payload["content"] = chunk.content
    return payload


def build_citation(chunk) -> Citation:
    document = chunk.document
    return Citation(
        document_title=document.title,
        document_id=document.pk,
        chunk_id=chunk.pk,
        doc_type=chunk.doc_type,
        section=" > ".join(chunk.heading_path),
        tsb_number=chunk.tsb_number,
        source_file=document.source_file,
        source_uri=document.source_uri,
        model=chunk.model,
        years=document.year_label,
    )


class RetrievalService:
    """Stateless; safe to instantiate per request or hold as a singleton."""

    def __init__(self, reranker=None):
        self.reranker = reranker or get_reranker()

    def search(
        self,
        query: str,
        *,
        vehicle_context: dict | None = None,
        role: str = AccessLevel.ADVISOR,
        top_k: int | None = None,
        doc_types: tuple[str, ...] = (),
        skip_dtc_shortcut: bool = False,
    ) -> RetrievalResult:
        started = time.perf_counter()
        top_k = top_k or settings.RAG_TOP_K

        entities = extract_entities(query, vehicle_context)
        result = RetrievalResult(route=Route.EMPTY, query=query, entities=entities)

        # --- DTC shortcut -------------------------------------------------
        # An exact code is a lookup, not a search. Going through embeddings
        # here can only turn a right answer into a nearby wrong one.
        if entities.has_dtc and not skip_dtc_shortcut:
            matches = dtc_lookup.resolve_codes(
                entities.dtc_codes, model=entities.model, year=entities.model_year
            )
            if matches:
                result.route = Route.DTC_EXACT
                result.dtc_matches = matches
                # De-duplicate: two codes in one query frequently resolve to
                # the same bulletin (P0299 and P2263 are the same boost leak),
                # and returning that chunk twice both wastes a result slot and
                # makes it look like two independent pieces of evidence.
                seen: set[int] = set()
                passages: list[ScoredChunk] = []
                for match in matches:
                    for chunk in match.related_chunks:
                        if chunk.pk in seen:
                            continue
                        seen.add(chunk.pk)
                        passages.append(
                            ScoredChunk(chunk=chunk, score=1.0,
                                        signals={"source": "dtc_related",
                                                 "dtc_code": match.code.code})
                        )
                result.passages = passages[:top_k]
                # An exact code match is a table read, not a ranking.
                result.confidence = 1.0
                result.confidence_detail = {"basis": "exact DTC table match"}
                result.sufficient = True
                for match in matches:
                    if not match.applies_to_vehicle:
                        result.notes.append(
                            f"{match.code.code} is not listed as applicable to "
                            f"{entities.model or 'this model'}"
                            f"{f' {entities.model_year}' if entities.model_year else ''}."
                        )
                    if match.match_type == "family":
                        result.notes.append(
                            f"Exact code not in the table; showing the "
                            f"{match.code.code} family instead."
                        )
                result.took_ms = _elapsed_ms(started)
                return result
            result.notes.append(
                f"No table entry for {', '.join(entities.dtc_codes)}; "
                "falling through to document search."
            )

        # --- hybrid path ---------------------------------------------------
        queryset, filter_report = build_candidate_queryset(
            entities, role=role, doc_types=doc_types
        )
        result.filters = filter_report.as_dict()
        if filter_report.relaxed:
            result.notes.append(
                "Relaxed filter(s) to avoid an empty result set: "
                + ", ".join(filter_report.relaxed)
            )

        if filter_report.candidates_after == 0:
            result.took_ms = _elapsed_ms(started)
            result.notes.append("No documents matched the vehicle filters.")
            return result

        embedding = get_embedding_backend().embed_query(query)
        lexical_query = expand_lexical_query(query, entities)
        if lexical_query != query:
            result.notes.append(f"Lexical query expanded to: {lexical_query}")
        fused = hybrid_search(
            queryset, query, embedding, entities,
            candidate_k=settings.RAG_CANDIDATE_K,
            top_k=max(top_k * 3, top_k),  # give the reranker room to reorder
            lexical_query=lexical_query,
        )
        passages = self.reranker.rerank(query, fused, top_k)

        result.route = Route.HYBRID
        result.passages = passages
        # Confidence comes from the absolute retriever scores, not from the
        # fused RRF score -- see confidence.py for why the fused score is
        # unusable as a gate.
        confidence = score_confidence(passages)
        result.confidence = confidence.score
        result.confidence_detail = confidence.as_dict()
        # The safety gate: below this the caller should say "insufficient
        # documentation" rather than let a model fill the gap.
        result.sufficient = result.confidence >= settings.RAG_MIN_CONFIDENCE
        if not result.sufficient:
            result.notes.append(
                "Retrieval confidence is below the configured floor; treat as "
                "insufficient documentation rather than answering from it."
            )
        if self.reranker.name == "noop":
            result.notes.append("Reranker: none (fused order preserved).")
        result.took_ms = _elapsed_ms(started)
        return result

    def lookup_dtc(
        self, code: str, *, model: str = "", year: int | None = None
    ) -> list[dtc_lookup.DTCMatch]:
        """Direct table read for GET /dtc/<code>."""
        return dtc_lookup.resolve_codes([code], model=model, year=year)

    def search_dtc_by_symptom(self, text: str, limit: int = 5):
        """Description-embedding search, for when no code was given at all."""
        embedding = get_embedding_backend().embed_query(text)
        return dtc_lookup.lookup_by_description(embedding, limit=limit)


def _elapsed_ms(started: float) -> int:
    return int((time.perf_counter() - started) * 1000)
