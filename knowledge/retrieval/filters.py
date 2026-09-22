"""Hard pre-filters applied before any search runs.

This is the piece the Notion doc calls out as fixing more relevance problems
than reranking will. It is a plain queryset narrowing, deliberately boring.

One rule governs all of it: a filter is only applied when we are confident in
the value. A wrong hard filter returns nothing, and "no results" reads to an
advisor as "no such bulletin exists" -- worse than a mediocre ranking.
"""
from __future__ import annotations

from dataclasses import dataclass

from django.db.models import Q, QuerySet

from knowledge.constants import AccessLevel
from knowledge.models import Chunk
from knowledge.retrieval.entities import QueryEntities


@dataclass
class FilterReport:
    """What was actually applied, and what it cost. Returned to the caller so
    a thin result set is explainable rather than mysterious."""

    model: str = ""
    model_year: int | None = None
    system: str = ""
    doc_types: tuple[str, ...] = ()
    access_role: str = AccessLevel.ADVISOR
    candidates_before: int = 0
    candidates_after: int = 0
    relaxed: list[str] = None  # filters dropped to avoid an empty candidate set

    def __post_init__(self):
        if self.relaxed is None:
            self.relaxed = []

    def as_dict(self) -> dict:
        return {
            "model": self.model,
            "model_year": self.model_year,
            "system": self.system,
            "doc_types": list(self.doc_types),
            "access_role": self.access_role,
            "candidates_before": self.candidates_before,
            "candidates_after": self.candidates_after,
            "relaxed": self.relaxed,
        }


def year_predicate(year: int) -> Q:
    """A chunk matches a year if its applicability range contains it. An open
    end (NULL) means 'to present'; an open start means 'since forever'."""
    return (Q(model_year_start__isnull=True) | Q(model_year_start__lte=year)) & (
        Q(model_year_end__isnull=True) | Q(model_year_end__gte=year)
    )


def build_candidate_queryset(
    entities: QueryEntities,
    *,
    role: str = AccessLevel.ADVISOR,
    doc_types: tuple[str, ...] = (),
    filter_system: bool = True,
) -> tuple[QuerySet, FilterReport]:
    """Narrow `rag_chunks` down to the set worth searching.

    Filters are applied strongest-first and relaxed one at a time if they empty
    the set, so a mis-tagged corpus degrades to a wider search rather than to
    silence. Each relaxation is recorded in the report.
    """
    report = FilterReport(
        model=entities.model,
        model_year=entities.model_year,
        system=entities.primary_system or "",
        doc_types=doc_types,
        access_role=role,
    )

    base = Chunk.objects.filter(
        access_level__in=AccessLevel.visible_to(role),
        embedding__isnull=False,
    )
    if doc_types:
        base = base.filter(doc_type__in=doc_types)
    report.candidates_before = base.count()

    queryset = base
    # Model is the safest filter: the advisor is looking at the vehicle. Note
    # that documents with a blank `model` are generic and always stay in.
    if entities.model:
        narrowed = queryset.filter(Q(model=entities.model) | Q(model=""))
        if narrowed.exists():
            queryset = narrowed
        else:
            report.relaxed.append("model")

    # Model year is the one filter that is never relaxed.
    #
    # Relaxing `model` widens the search; relaxing `model_year` actively
    # produces wrong answers. A bulletin scoped to 2021-2023 does not apply to
    # a 2019 vehicle, and surfacing it anyway hands the advisor a confident,
    # billable recommendation for work that will not fix the vehicle and will
    # not be covered. An empty result set is the correct answer here, and the
    # caller reports it as "no applicable documentation" via `sufficient`.
    if entities.model_year:
        queryset = queryset.filter(year_predicate(entities.model_year))

    # System is only a gate when the caller supplied it explicitly. When it was
    # inferred from query keywords it is a ranking signal and nothing more.
    #
    # This is not caution for its own sake. "Shudder on cold start" scores as
    # `engine` on keywords, but the bulletin that answers it is filed under
    # `transmission` -- gating on the inferred value hides the one right
    # document and returns a confident page of wrong ones. Cross-system
    # symptoms are the normal case in this domain, not the exception.
    system_is_explicit = entities.sources.get("systems") == "vehicle_context"
    if filter_system and entities.primary_system and system_is_explicit:
        narrowed = queryset.filter(
            Q(system=entities.primary_system) | Q(system="general")
        )
        if narrowed.exists():
            queryset = narrowed
        else:
            report.relaxed.append("system")
            report.system = ""
    elif entities.primary_system:
        report.relaxed.append("system (inferred; applied as a boost, not a filter)")
        report.system = ""

    report.candidates_after = queryset.count()
    return queryset, report
