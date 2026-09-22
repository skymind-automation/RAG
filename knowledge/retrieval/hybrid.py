"""Hybrid retrieval: Postgres full-text (BM25-ish) + pgvector dense, fused
with Reciprocal Rank Fusion.

Why RRF rather than a weighted score blend: `ts_rank_cd` and cosine distance
are not on comparable scales and their distributions shift per query, so any
fixed alpha is wrong somewhere. RRF only uses each retriever's *rank*, so it is
scale-free and needs no per-query calibration.

    score(d) = sum over retrievers of  weight_r / (k + rank_r(d))

k=60 is the standard constant from the original RRF paper; it flattens the
contribution of the head so a single retriever cannot dominate the fusion.

Lexical is not optional here. Exact-match cases -- part numbers, TSB numbers,
DTC codes appearing in narrative text -- are exactly where dense retrieval is
weakest, and they are a large share of advisor traffic.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field

from django.conf import settings
from django.contrib.postgres.search import SearchQuery, SearchRank
from django.db.models import F, Q, QuerySet, Value
from pgvector.django import CosineDistance

from knowledge.models import Chunk
from knowledge.retrieval.entities import QueryEntities

logger = logging.getLogger(__name__)


@dataclass
class ScoredChunk:
    chunk: Chunk
    score: float
    lexical_rank: int | None = None
    dense_rank: int | None = None
    lexical_score: float | None = None
    dense_score: float | None = None
    signals: dict = field(default_factory=dict)

    @property
    def retrievers(self) -> list[str]:
        found = []
        if self.lexical_rank is not None:
            found.append("lexical")
        if self.dense_rank is not None:
            found.append("dense")
        return found


# Tokens worth searching for. Punctuation is dropped, but commas, slashes,
# hyphens and periods inside a token are kept: "60,000", "5W-30", "P0299" and
# "a/c" are all single meaningful terms.
_TERM_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9,/\-\.]*")

# Very common words carry no retrieval signal and, OR-ed into the query, drag
# in every chunk in the corpus at a low rank. Postgres' english dictionary
# already strips most of them; these are the ones that survive as lexemes.
_STOPWORDS = {
    "what", "whats", "which", "when", "where", "how", "why", "who", "any",
    "the", "a", "an", "is", "are", "was", "were", "do", "does", "did", "for",
    "on", "in", "at", "to", "of", "and", "or", "my", "we", "it", "this",
    "that", "there", "customer", "says", "said", "im", "ive", "get", "got",
}


def build_lexical_query(text: str) -> SearchQuery | None:
    """OR the query terms together rather than AND-ing them.

    This matters more than it looks. `websearch_to_tsquery` -- and
    `plainto_tsquery` -- AND every term, so a single word absent from a chunk
    excludes it entirely. "What's due at 60k miles?" then matches nothing at
    all, because no manual contains the token "60k", and the lexical half of
    the hybrid silently contributes zero rows.

    OR-ing keeps recall, and `ts_rank_cd` still ranks chunks matching more
    terms (and matching them closer together) above chunks matching one. That
    is the behaviour the fusion needs: a ranked list, not a filtered one.
    """
    terms = []
    for match in _TERM_RE.finditer(text.lower()):
        token = match.group(0).strip(",.-/")
        if len(token) < 2 or token in _STOPWORDS:
            continue
        terms.append(token)

    if not terms:
        return None

    combined: SearchQuery | None = None
    for term in dict.fromkeys(terms):
        # Each term goes through SearchQuery individually, so Django escapes
        # it; no raw tsquery string is ever assembled by hand.
        clause = SearchQuery(term, search_type="plain", config="english")
        combined = clause if combined is None else combined | clause
    return combined


def lexical_search(
    queryset: QuerySet, query: str, limit: int
) -> list[tuple[Chunk, float]]:
    """Postgres full-text search over the generated `search_vector` column."""
    search_query = build_lexical_query(query)
    if search_query is None:
        return []
    rows = (
        queryset.filter(search_vector=search_query)
        .annotate(rank=SearchRank(F("search_vector"), search_query, normalization=Value(32)))
        .order_by("-rank", "id")[:limit]
    )
    return [(row, float(row.rank)) for row in rows]


def dense_search(
    queryset: QuerySet, embedding: list[float], limit: int
) -> list[tuple[Chunk, float]]:
    """Approximate nearest neighbour over the HNSW index.

    Cosine distance is returned as a similarity (1 - distance) so that, like
    the lexical score, larger is better.
    """
    rows = (
        queryset.annotate(distance=CosineDistance("embedding", embedding))
        .order_by("distance", "id")[:limit]
    )
    return [(row, 1.0 - float(row.distance)) for row in rows]


def reciprocal_rank_fusion(
    ranked_lists: dict[str, list[tuple[Chunk, float]]],
    *,
    k: int = 60,
    weights: dict[str, float] | None = None,
) -> list[ScoredChunk]:
    """Fuse any number of ranked lists. Order within each list is what counts;
    the raw scores are carried through for debugging only."""
    weights = weights or {}
    fused: dict[int, ScoredChunk] = {}

    for retriever, rows in ranked_lists.items():
        weight = weights.get(retriever, 1.0)
        for rank, (chunk, raw_score) in enumerate(rows, start=1):
            entry = fused.get(chunk.pk)
            if entry is None:
                entry = ScoredChunk(chunk=chunk, score=0.0)
                fused[chunk.pk] = entry
            entry.score += weight / (k + rank)
            if retriever == "lexical":
                entry.lexical_rank, entry.lexical_score = rank, raw_score
            elif retriever == "dense":
                entry.dense_rank, entry.dense_score = rank, raw_score

    return sorted(fused.values(), key=lambda s: (-s.score, s.chunk.pk))


def apply_soft_boosts(
    results: list[ScoredChunk], entities: QueryEntities, *, boost: float = 0.15
) -> list[ScoredChunk]:
    """Nudge, don't gate.

    Signals that are too unreliable to be hard filters still carry real
    information. Each adds a small multiplicative bump and is recorded on the
    result, so a surprising ranking can be read back rather than guessed at.
    """
    system = entities.primary_system
    for item in results:
        chunk = item.chunk
        multiplier = 1.0

        if system and chunk.system == system:
            multiplier += boost
            item.signals["system_match"] = system

        # TSBs are the highest-value, lowest-volume documents and map ~1:1
        # onto advisor phrasing; when a query looks symptom-shaped, prefer them.
        if chunk.doc_type == "tsb" and chunk.symptom_keywords:
            multiplier += boost / 2
            item.signals["tsb_symptom_doc"] = True

        if entities.dtc_codes and set(entities.dtc_codes) & set(chunk.dtc_codes or []):
            multiplier += boost * 2
            item.signals["dtc_mentioned"] = sorted(
                set(entities.dtc_codes) & set(chunk.dtc_codes)
            )

        if entities.tsb_numbers and chunk.tsb_number.upper() in entities.tsb_numbers:
            multiplier += boost * 4
            item.signals["tsb_number_match"] = chunk.tsb_number

        # An exactly-scoped document (this model, this year) beats a generic
        # one that merely mentions the same words.
        if entities.model and chunk.model == entities.model:
            multiplier += boost / 2
            item.signals["exact_model"] = chunk.model

        item.score *= multiplier

    return sorted(results, key=lambda s: (-s.score, s.chunk.pk))


def hybrid_search(
    queryset: QuerySet,
    query: str,
    embedding: list[float],
    entities: QueryEntities,
    *,
    candidate_k: int | None = None,
    top_k: int | None = None,
    lexical_query: str | None = None,
) -> list[ScoredChunk]:
    """Run both retrievers, fuse, boost, truncate.

    `lexical_query` carries vocabulary expansions (see expansion.py) that only
    the lexical half needs; the dense half is given the advisor's own wording,
    embedded, because expansion terms would only dilute that vector.
    """
    candidate_k = candidate_k or settings.RAG_CANDIDATE_K
    top_k = top_k or settings.RAG_TOP_K

    lexical = lexical_search(queryset, lexical_query or query, candidate_k)
    dense = dense_search(queryset, embedding, candidate_k)
    logger.debug("hybrid: %d lexical, %d dense candidates", len(lexical), len(dense))

    fused = reciprocal_rank_fusion(
        {"lexical": lexical, "dense": dense},
        k=settings.RAG_RRF_K,
        weights=settings.RAG_RRF_WEIGHTS,
    )
    boosted = apply_soft_boosts(fused, entities)
    return boosted[:top_k]
