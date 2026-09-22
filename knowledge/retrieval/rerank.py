"""Reranking stage.

The doc's sequencing is hybrid search + reranker first. Hybrid is built; the
reranker is a seam, not a stub-that-lies: the default is an explicit no-op that
reports itself as such, so eval numbers are never quietly attributed to a
reranker that isn't running.

Swap in `CrossEncoderRerank` (or a hosted reranker) once there is a golden set
big enough to prove the +5-15 MRR the literature claims on hard queries. Until
then a cross-encoder is latency you cannot justify.
"""
from __future__ import annotations

import logging
from abc import ABC, abstractmethod

from django.conf import settings

logger = logging.getLogger(__name__)


class Reranker(ABC):
    name = "abstract"

    @abstractmethod
    def rerank(self, query: str, results: list, top_k: int) -> list: ...


class NoopReranker(Reranker):
    """Truncates. Does not reorder. Honest about it."""

    name = "noop"

    def rerank(self, query: str, results: list, top_k: int) -> list:
        return results[:top_k]


class CrossEncoderReranker(Reranker):
    """Cross-encoder reranking over the fused top-k.

    Loaded lazily: importing sentence-transformers costs seconds and hundreds
    of MB, which a service that may never rerank should not pay at boot.
    """

    name = "cross-encoder"

    def __init__(self, model_name: str):
        self.model_name = model_name
        self._model = None

    def _load(self):
        if self._model is None:
            from sentence_transformers import CrossEncoder

            self._model = CrossEncoder(self.model_name)
        return self._model

    def rerank(self, query: str, results: list, top_k: int) -> list:
        if not results:
            return []
        model = self._load()
        pairs = [(query, item.chunk.content) for item in results]
        scores = model.predict(pairs)
        for item, score in zip(results, scores):
            item.signals["rerank_score"] = float(score)
            item.score = float(score)
        return sorted(results, key=lambda s: -s.score)[:top_k]


def get_reranker() -> Reranker:
    name = getattr(settings, "RAG_RERANKER", "noop")
    if name in ("", "noop", None):
        return NoopReranker()
    if name.startswith("cross-encoder:"):
        return CrossEncoderReranker(name.split(":", 1)[1])
    logger.warning("unknown reranker %r; falling back to noop", name)
    return NoopReranker()
