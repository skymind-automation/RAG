"""Settings for the Delta RAG retrieval service.

The service is designed to live inside the Skymind MRO Django project; this
standalone project exists so the schema, ingestion and retrieval layers can be
developed and evaluated on their own. To graft it onto Skymind, copy the
`knowledge` app across and merge the RAG_* block below into that project's
settings.
"""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _env_bool(name: str, default: bool = False) -> bool:
    return os.environ.get(name, str(int(default))).lower() in {"1", "true", "yes", "on"}


SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "dev-only-insecure-key")
DEBUG = _env_bool("DJANGO_DEBUG", True)
ALLOWED_HOSTS = [h for h in os.environ.get("DJANGO_ALLOWED_HOSTS", "*").split(",") if h]

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "django.contrib.staticfiles",
    "knowledge",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.common.CommonMiddleware",
]

ROOT_URLCONF = "delta_rag.urls"
WSGI_APPLICATION = "delta_rag.wsgi.application"
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {"context_processors": []},
    }
]

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ.get("DELTA_RAG_DB_NAME", "delta_rag"),
        "USER": os.environ.get("DELTA_RAG_DB_USER", "delta"),
        "PASSWORD": os.environ.get("DELTA_RAG_DB_PASSWORD", "delta"),
        "HOST": os.environ.get("DELTA_RAG_DB_HOST", "127.0.0.1"),
        "PORT": os.environ.get("DELTA_RAG_DB_PORT", "5432"),
    }
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
STATIC_URL = "static/"
USE_TZ = True

# --- RAG configuration -----------------------------------------------------

# Embedding backend: "voyage" for production, "hashing" for offline dev + CI.
# Anthropic does not serve an embeddings endpoint; Voyage is the recommended
# pairing. Changing backend or model means re-embedding every chunk.
RAG_EMBEDDING_BACKEND = os.environ.get("RAG_EMBEDDING_BACKEND", "hashing")
RAG_EMBEDDING_MODEL = os.environ.get("RAG_EMBEDDING_MODEL", "voyage-3-large")
RAG_EMBEDDING_DIM = int(os.environ.get("RAG_EMBEDDING_DIM", "1024"))
VOYAGE_API_KEY = os.environ.get("VOYAGE_API_KEY", "")

# Retrieval tuning. Both halves of the hybrid search fetch RAG_CANDIDATE_K rows;
# RRF fuses them and RAG_TOP_K survives to the caller.
RAG_CANDIDATE_K = int(os.environ.get("RAG_CANDIDATE_K", "50"))
RAG_TOP_K = int(os.environ.get("RAG_TOP_K", "8"))
RAG_RRF_K = int(os.environ.get("RAG_RRF_K", "60"))
# Weights applied to each retriever's RRF contribution. Lexical is weighted up
# because advisor queries carry part numbers, TSB numbers and DTC codes.
RAG_RRF_WEIGHTS = {"lexical": 1.0, "dense": 1.0}
# Safety gate. Confidence is on a calibrated [0, 1] scale derived from the
# absolute retriever scores (see knowledge/retrieval/confidence.py), NOT from
# the fused RRF score -- an RRF score reflects rank alone and is the same for
# a good top hit and a bad one. Below this floor the service reports
# `sufficient: false` so the caller answers "insufficient documentation"
# instead of letting a model fill the gap.
#
# Re-calibrate this against the golden set whenever the embedding backend
# changes: it is a property of the score distribution, not a universal constant.
RAG_MIN_CONFIDENCE = float(os.environ.get("RAG_MIN_CONFIDENCE", "0.25"))

# Reranker: "noop" (default) or "cross-encoder:<model name>".
RAG_RERANKER = os.environ.get("RAG_RERANKER", "noop")

# Chunking
RAG_CHUNK_MAX_CHARS = int(os.environ.get("RAG_CHUNK_MAX_CHARS", "2400"))
RAG_CHUNK_MIN_CHARS = int(os.environ.get("RAG_CHUNK_MIN_CHARS", "120"))

RAG_DATA_DIR = Path(os.environ.get("RAG_DATA_DIR", BASE_DIR / "data"))

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": os.environ.get("DJANGO_LOG_LEVEL", "INFO")},
}
