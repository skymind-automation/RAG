"""DTC lookup: the exact-match shortcut.

"What's P0299 on a Transit" is not a semantic question. It has one right
answer, it lives in a row, and vector search can only make it worse. So when a
DTC code is present in the query, we skip the vector path entirely and read the
table.

Two fallbacks behind the exact match:

  prefix/family  P0301 unknown -> fall back to the P0300 misfire family, which
                 is the answer the advisor actually needs
  description    no code in the query at all -> embedding search over the
                 description column only, so "check engine light for a
                 misfire" resolves to the P0300 series
"""
from __future__ import annotations

from dataclasses import dataclass, field

from django.db import models
from pgvector.django import CosineDistance

from knowledge.models import Chunk, DTCCode
from knowledge.retrieval.filters import year_predicate


@dataclass
class DTCMatch:
    code: DTCCode
    match_type: str  # exact | family | description
    applies_to_vehicle: bool = True
    # Narrative chunks (usually TSBs) that mention this code. The code row says
    # what the fault is; these say what to do about it on this vehicle.
    related_chunks: list[Chunk] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "code": self.code.code,
            "description": self.code.description,
            "likely_causes": self.code.likely_causes,
            "severity": self.code.severity,
            "system": self.code.system,
            "is_generic": self.code.is_generic,
            "applicable_models": self.code.applicable_models,
            "advisor_guidance": self.code.advisor_guidance,
            "match_type": self.match_type,
            "applies_to_vehicle": self.applies_to_vehicle,
        }


def lookup_exact(code: str) -> DTCCode | None:
    return DTCCode.objects.filter(code=code.upper()).first()


def lookup_family(code: str) -> list[DTCCode]:
    """Codes sharing the first four characters.

    P0301..P0308 are per-cylinder misfires; if the specific code is not in the
    table, the family row (P0300) carries the causes the advisor needs.
    """
    code = code.upper()
    if len(code) < 5:
        return []
    return list(
        DTCCode.objects.filter(code__startswith=code[:4])
        .exclude(code=code)
        .order_by("code")[:5]
    )


def lookup_by_description(embedding: list[float], limit: int = 5) -> list[DTCCode]:
    """Semantic search over descriptions only -- never over causes or prose."""
    return list(
        DTCCode.objects.filter(description_embedding__isnull=False)
        .annotate(distance=CosineDistance("description_embedding", embedding))
        .order_by("distance")[:limit]
    )


def related_chunks_for_code(
    code: str, *, model: str = "", year: int | None = None, limit: int = 5
) -> list[Chunk]:
    """Narrative documents that mention this code, scoped to the vehicle.

    A TSB that names the code is worth far more to an advisor than the code
    row alone, so the DTC shortcut returns both.
    """
    queryset = Chunk.objects.filter(dtc_codes__contains=[code.upper()])
    if model:
        queryset = queryset.filter(models.Q(model=model) | models.Q(model=""))
    if year:
        queryset = queryset.filter(year_predicate(year))
    # TSBs first: they are the actionable ones.
    return list(
        queryset.select_related("document")
        .order_by(models.Case(
            models.When(doc_type="tsb", then=0),
            models.When(doc_type="manual", then=1),
            default=2,
            output_field=models.IntegerField(),
        ), "id")[:limit]
    )


def resolve_codes(
    codes: list[str], *, model: str = "", year: int | None = None
) -> list[DTCMatch]:
    """Resolve every code in the query, exact first, family as a fallback."""
    matches: list[DTCMatch] = []
    for raw in codes:
        code = raw.upper()
        exact = lookup_exact(code)
        if exact:
            matches.append(
                DTCMatch(
                    code=exact,
                    match_type="exact",
                    applies_to_vehicle=exact.applies_to(model, year),
                    related_chunks=related_chunks_for_code(code, model=model, year=year),
                )
            )
            continue
        for relative in lookup_family(code):
            matches.append(
                DTCMatch(
                    code=relative,
                    match_type="family",
                    applies_to_vehicle=relative.applies_to(model, year),
                    related_chunks=related_chunks_for_code(
                        relative.code, model=model, year=year
                    ),
                )
            )
            break
    return matches
