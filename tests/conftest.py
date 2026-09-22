import os

import pytest

os.environ.setdefault("RAG_EMBEDDING_BACKEND", "hashing")


@pytest.fixture(autouse=True)
def _reset_embedding_backend():
    """The backend is a process-wide singleton; drop it between tests so a
    settings override in one test cannot leak into the next."""
    from knowledge.ingestion.embeddings import reset_embedding_backend

    reset_embedding_backend()
    yield
    reset_embedding_backend()
