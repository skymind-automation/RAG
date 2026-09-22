"""Embedding backends.

Anthropic does not serve an embeddings endpoint, so the production backend is
Voyage (the recommended pairing). The `hashing` backend is a deterministic,
offline stand-in so that ingestion, retrieval and the eval harness are runnable
and testable without a network or an API key.

The hashing backend is NOT a quality substitute. It models lexical overlap, not
meaning, so dense recall measured under it is a floor, not a forecast. The eval
report labels which backend produced it for exactly this reason.

Switching backend or model invalidates every stored vector: the embedding model
name is written onto each row, and `ingest --reembed` re-runs the ones that
don't match.
"""
from __future__ import annotations

import hashlib
import logging
import math
import re
from abc import ABC, abstractmethod
from functools import lru_cache

from django.conf import settings

logger = logging.getLogger(__name__)

_TOKEN_RE = re.compile(r"[a-z0-9][a-z0-9\-/\.]*")


class EmbeddingBackend(ABC):
    """Vectorizes text. Documents and queries are embedded through separate
    methods because Voyage (and most modern embedding models) are trained with
    asymmetric input types."""

    name: str = "abstract"

    def __init__(self, model: str, dim: int):
        self.model = model
        self.dim = dim

    @abstractmethod
    def embed_documents(self, texts: list[str]) -> list[list[float]]: ...

    @abstractmethod
    def embed_query(self, text: str) -> list[float]: ...

    def __repr__(self) -> str:
        return f"<{type(self).__name__} model={self.model} dim={self.dim}>"


class VoyageBackend(EmbeddingBackend):
    """Production backend. Batches in chunks of 128, which is well inside
    Voyage's per-request token ceiling for chunks of our size."""

    name = "voyage"
    BATCH = 128

    def __init__(self, model: str, dim: int, api_key: str):
        super().__init__(model, dim)
        if not api_key:
            raise RuntimeError(
                "RAG_EMBEDDING_BACKEND=voyage but VOYAGE_API_KEY is unset."
            )
        try:
            import voyageai
        except ImportError as exc:  # pragma: no cover - dependency guard
            raise RuntimeError(
                "voyageai is not installed; `pip install voyageai` or set "
                "RAG_EMBEDDING_BACKEND=hashing for offline work."
            ) from exc
        self._client = voyageai.Client(api_key=api_key)

    def _embed(self, texts: list[str], input_type: str) -> list[list[float]]:
        out: list[list[float]] = []
        for start in range(0, len(texts), self.BATCH):
            batch = texts[start : start + self.BATCH]
            result = self._client.embed(
                batch, model=self.model, input_type=input_type,
                output_dimension=self.dim,
            )
            out.extend(result.embeddings)
        return out

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return self._embed(texts, "document")

    def embed_query(self, text: str) -> list[float]:
        return self._embed([text], "query")[0]


class HashingBackend(EmbeddingBackend):
    """Deterministic offline embedding: a hashed bag-of-words projection with
    sublinear term weighting, L2-normalized so cosine distance behaves.

    Good enough to exercise the full pipeline and to make the eval harness
    reproducible in CI. Not good enough to ship.
    """

    name = "hashing"

    def __init__(self, model: str, dim: int):
        super().__init__(model or "hashing-v1", dim)

    def _vector(self, text: str) -> list[float]:
        counts: dict[str, int] = {}
        for token in _TOKEN_RE.findall(text.lower()):
            if len(token) < 2:
                continue
            counts[token] = counts.get(token, 0) + 1
            # Character trigrams give partial credit for near-misses like
            # "injector" vs "injectors" that whole-token hashing would miss.
            for i in range(len(token) - 2):
                tri = token[i : i + 3]
                counts[f"#{tri}"] = counts.get(f"#{tri}", 0) + 1

        vec = [0.0] * self.dim
        for token, count in counts.items():
            digest = hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest()
            idx = int.from_bytes(digest[:4], "big") % self.dim
            sign = 1.0 if digest[4] & 1 else -1.0
            vec[idx] += sign * (1.0 + math.log(count))

        norm = math.sqrt(sum(v * v for v in vec))
        if norm == 0.0:
            # An all-stopword query would otherwise produce a zero vector, and
            # cosine distance against zero is undefined in pgvector.
            vec[0] = 1.0
            return vec
        return [v / norm for v in vec]

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [self._vector(t) for t in texts]

    def embed_query(self, text: str) -> list[float]:
        return self._vector(text)


@lru_cache(maxsize=1)
def get_embedding_backend() -> EmbeddingBackend:
    """Process-wide singleton, keyed off settings."""
    backend = (settings.RAG_EMBEDDING_BACKEND or "hashing").lower()
    dim = settings.RAG_EMBEDDING_DIM
    model = settings.RAG_EMBEDDING_MODEL

    if backend == "voyage":
        return VoyageBackend(model, dim, settings.VOYAGE_API_KEY)
    if backend == "hashing":
        logger.warning(
            "Using the deterministic hashing embedding backend. Dense recall "
            "measured here is a floor, not a production forecast."
        )
        return HashingBackend("hashing-v1", dim)
    raise RuntimeError(f"Unknown RAG_EMBEDDING_BACKEND: {backend!r}")


def reset_embedding_backend() -> None:
    """Drop the cached singleton. Tests use this after overriding settings."""
    get_embedding_backend.cache_clear()
