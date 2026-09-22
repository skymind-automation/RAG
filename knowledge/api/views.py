"""HTTP surface for the retrieval service.

Plain Django JSON views rather than DRF: the payloads are small and fixed, and
the Fleet ERP and the n8n Incident Investigator both just want JSON. Adding a
framework here would be weight without leverage.

The endpoints return evidence and citations, never a synthesized answer. That
boundary is deliberate -- see the service docstring.
"""
from __future__ import annotations

import json
import logging

from django.conf import settings
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from knowledge.constants import AccessLevel, DocType
from knowledge.models import Chunk, DTCCode, Document
from knowledge.retrieval.service import RetrievalService

logger = logging.getLogger(__name__)
_service = RetrievalService()

MAX_QUERY_CHARS = 2000
MAX_TOP_K = 25


def _error(message: str, status: int = 400, **extra) -> JsonResponse:
    return JsonResponse({"error": message, **extra}, status=status)


@csrf_exempt
@require_POST
def retrieve(request):
    """POST /api/v1/retrieve

    {
      "query": "customer says shudder on cold start, any bulletins?",
      "vehicle_context": {"model": "Ford Transit", "model_year": 2022,
                          "mileage": 64000},
      "role": "advisor",
      "top_k": 8,
      "doc_types": ["tsb", "manual"]
    }
    """
    try:
        payload = json.loads(request.body or b"{}")
    except json.JSONDecodeError as exc:
        return _error(f"invalid JSON body: {exc}")
    if not isinstance(payload, dict):
        return _error("request body must be a JSON object")

    query = (payload.get("query") or "").strip()
    if not query:
        return _error("`query` is required and must be non-empty")
    if len(query) > MAX_QUERY_CHARS:
        return _error(f"`query` exceeds {MAX_QUERY_CHARS} characters")

    vehicle_context = payload.get("vehicle_context") or {}
    if not isinstance(vehicle_context, dict):
        return _error("`vehicle_context` must be an object")

    role = payload.get("role") or AccessLevel.ADVISOR
    if role not in AccessLevel.ALL:
        return _error(f"unknown role {role!r}", allowed=AccessLevel.ALL)

    doc_types = tuple(payload.get("doc_types") or ())
    unknown = [d for d in doc_types if d not in DocType.ALL]
    if unknown:
        return _error(f"unknown doc_type(s): {unknown}", allowed=DocType.ALL)

    top_k = payload.get("top_k") or settings.RAG_TOP_K
    try:
        top_k = max(1, min(int(top_k), MAX_TOP_K))
    except (TypeError, ValueError):
        return _error("`top_k` must be an integer")

    result = _service.search(
        query,
        vehicle_context=vehicle_context,
        role=role,
        top_k=top_k,
        doc_types=doc_types,
    )
    return JsonResponse(
        result.as_dict(include_content=bool(payload.get("include_content", True)))
    )


@require_GET
def dtc_detail(request, code: str):
    """GET /api/v1/dtc/<code>?model=transit&year=2022

    The exact-match path on its own, for callers that already know they have a
    code -- the n8n Incident Investigator reading a fault off telemetry, for
    instance.
    """
    model = request.GET.get("model", "")
    year = request.GET.get("year")
    if year:
        try:
            year = int(year)
        except ValueError:
            return _error("`year` must be an integer")
    else:
        year = None

    matches = _service.lookup_dtc(code, model=model, year=year)
    if not matches:
        return _error(
            f"no table entry for {code.upper()}", status=404,
            hint="Try /api/v1/dtc/search?q=<symptom> for a description lookup.",
        )
    return JsonResponse(
        {
            "code": code.upper(),
            "matches": [m.as_dict() for m in matches],
            "related": [
                {
                    "chunk_id": chunk.pk,
                    "doc_type": chunk.doc_type,
                    "tsb_number": chunk.tsb_number,
                    "title": chunk.document.title,
                    "content": chunk.content,
                }
                for match in matches
                for chunk in match.related_chunks
            ],
        }
    )


@require_GET
def dtc_search(request):
    """GET /api/v1/dtc/search?q=check+engine+light+for+a+misfire

    Description-embedding search. The one place embeddings touch the DTC table.
    """
    query = (request.GET.get("q") or "").strip()
    if not query:
        return _error("`q` is required")
    limit = min(int(request.GET.get("limit", 5) or 5), 20)
    codes = _service.search_dtc_by_symptom(query, limit=limit)
    return JsonResponse(
        {
            "query": query,
            "results": [
                {
                    "code": c.code,
                    "description": c.description,
                    "severity": c.severity,
                    "system": c.system,
                    "likely_causes": c.likely_causes,
                }
                for c in codes
            ],
        }
    )


@require_GET
def healthz(request):
    """Liveness plus the facts that most often explain a bad result set:
    corpus size, and which embedding model the index was built with."""
    from knowledge.ingestion.embeddings import get_embedding_backend

    backend = get_embedding_backend()
    embedded = Chunk.objects.filter(embedding__isnull=False).count()
    total = Chunk.objects.count()
    return JsonResponse(
        {
            "status": "ok",
            "documents": Document.objects.count(),
            "chunks": total,
            "chunks_embedded": embedded,
            "chunks_missing_embedding": total - embedded,
            "dtc_codes": DTCCode.objects.count(),
            "embedding_backend": backend.name,
            "embedding_model": backend.model,
            "embedding_dim": backend.dim,
            "synthetic_documents": Document.objects.filter(is_synthetic=True).count(),
        }
    )
