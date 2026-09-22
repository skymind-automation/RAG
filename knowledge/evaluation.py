"""Golden-set retrieval evaluation.

Measures retrieval and nothing else: did the right evidence come back, and how
high did it rank. Deliberately no LLM in the loop — mixing generation quality
into this number is how teams end up tuning a prompt to compensate for a
retrieval bug.

Metrics, per case and aggregated:

  hit@k        did any relevant chunk appear in the top k (the number an
               advisor actually feels: was the answer on screen)
  recall@k     fraction of this case's relevant chunks that appeared in top k
  precision@k  fraction of the top k that were relevant
  MRR          1 / rank of the first relevant chunk, 0 if none

Plus two correctness checks that are not ranking metrics at all:

  route        did the DTC shortcut fire when it should have
  applicability did an inapplicable document leak through the pre-filter —
               a violation here is a failure however good the ranking is
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml

from knowledge.retrieval.service import RetrievalService


@dataclass
class CaseResult:
    case_id: str
    shape: str
    question: str
    route: str
    hit: bool
    first_relevant_rank: int | None
    recall_at_k: float
    precision_at_k: float
    reciprocal_rank: float
    confidence: float
    sufficient: bool
    took_ms: int
    failures: list[str] = field(default_factory=list)
    retrieved: list[str] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return not self.failures

    def as_dict(self) -> dict:
        return {
            "case_id": self.case_id,
            "shape": self.shape,
            "question": self.question,
            "route": self.route,
            "hit": self.hit,
            "first_relevant_rank": self.first_relevant_rank,
            "recall_at_k": round(self.recall_at_k, 4),
            "precision_at_k": round(self.precision_at_k, 4),
            "reciprocal_rank": round(self.reciprocal_rank, 4),
            "confidence": round(self.confidence, 6),
            "sufficient": self.sufficient,
            "took_ms": self.took_ms,
            "passed": self.passed,
            "failures": self.failures,
            "retrieved": self.retrieved,
        }


def matches(chunk, matcher: dict) -> bool:
    """Does this chunk satisfy one matcher? All declared keys must hold."""
    if "tsb_number" in matcher:
        if chunk.tsb_number.upper() != str(matcher["tsb_number"]).upper():
            return False
    if "doc_type" in matcher:
        if chunk.doc_type != matcher["doc_type"]:
            return False
    if "source_file" in matcher:
        if str(matcher["source_file"]).lower() not in chunk.document.source_file.lower():
            return False
    if "heading" in matcher:
        heading = " > ".join(chunk.heading_path).lower()
        if str(matcher["heading"]).lower() not in heading:
            return False
    if "contains" in matcher:
        if str(matcher["contains"]).lower() not in chunk.content.lower():
            return False
    return True


def is_relevant(chunk, matchers: list[dict]) -> bool:
    """Any matcher hitting makes the chunk relevant.

    Matchers naming `dtc_code` are about the DTC table, not about chunks, so
    they never match a chunk here -- see `dtc_row_matchers`.
    """
    return any(matches(chunk, m) for m in matchers if "dtc_code" not in m)


def dtc_row_matchers(matchers: list[dict]) -> list[dict]:
    """The subset of matchers that grade returned DTC table rows.

    For a lookup query the DTC row *is* the evidence -- it is what answers
    "what does P0420 mean". Grading only chunks would score a perfectly
    correct lookup as a miss, because DTC codes are deliberately not chunked.
    """
    return [m for m in matchers if "dtc_code" in m]


def dtc_row_matches(dtc_matches, matchers: list[dict]) -> bool:
    """Did the returned DTC rows satisfy any row matcher?"""
    if not matchers:
        return False
    returned = {m.code.code.upper() for m in dtc_matches}
    for matcher in matchers:
        wanted = str(matcher["dtc_code"]).upper()
        if matcher.get("prefix"):
            if any(code.startswith(wanted) for code in returned):
                return True
        elif wanted in returned:
            return True
    return False


def load_cases(path: Path) -> tuple[list[dict], dict]:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    return data.get("cases", []), data.get("meta", {})


def count_relevant_in_corpus(matchers: list[dict]) -> int:
    """How many chunks in the whole corpus satisfy this case's matchers.

    Recall needs a denominator. Computing it from the corpus rather than
    assuming one relevant chunk per case keeps recall honest when an answer is
    genuinely spread across several sections.
    """
    from knowledge.models import Chunk

    return sum(
        1 for chunk in Chunk.objects.select_related("document").all()
        if is_relevant(chunk, matchers)
    )


def run_case(service: RetrievalService, case: dict, top_k: int) -> CaseResult:
    question = case["question"]
    result = service.search(
        question, vehicle_context=case.get("vehicle_context") or {}, top_k=top_k
    )
    matchers = case.get("relevant") or []
    chunk_matchers = [m for m in matchers if "dtc_code" not in m]
    row_matchers = dtc_row_matchers(matchers)
    passages = result.passages

    relevant_flags = (
        [is_relevant(p.chunk, chunk_matchers) for p in passages]
        if chunk_matchers else []
    )
    first_rank = next((i + 1 for i, ok in enumerate(relevant_flags) if ok), None)
    relevant_found = sum(relevant_flags)
    total_relevant = (
        count_relevant_in_corpus(chunk_matchers) if chunk_matchers else 0
    )

    # A satisfied DTC row matcher is evidence at rank 1: the lookup returned
    # the right table row, which is the whole answer for this query shape.
    row_hit = dtc_row_matches(result.dtc_matches, row_matchers)
    if row_hit and first_rank is None:
        first_rank = 1
        relevant_found = max(relevant_found, 1)
        total_relevant = max(total_relevant, 1)

    failures: list[str] = []

    # --- route assertion ------------------------------------------------
    expected_route = case.get("expect_route")
    if expected_route and result.route != expected_route:
        failures.append(f"route was {result.route!r}, expected {expected_route!r}")

    expected_dtc = [c.upper() for c in (case.get("expect_dtc") or [])]
    if expected_dtc:
        returned = {m.code.code.upper() for m in result.dtc_matches}
        missing = [c for c in expected_dtc if c not in returned]
        if missing:
            failures.append(f"DTC lookup missed {missing}")

    # --- applicability: an inapplicable document must not appear ---------
    for forbidden in case.get("expect_no_results_matching") or []:
        leaked = [p for p in passages if matches(p.chunk, forbidden)]
        if leaked:
            failures.append(
                f"inapplicable document leaked through the filter: {forbidden} "
                f"(rank {passages.index(leaked[0]) + 1})"
            )

    # --- the safety gate --------------------------------------------------
    if case.get("expect_insufficient"):
        if result.sufficient:
            failures.append(
                "expected low confidence (insufficient documentation) but the "
                f"service reported sufficient at {result.confidence:.4f}"
            )
    elif matchers and first_rank is None:
        if row_matchers and not row_hit:
            failures.append(
                f"DTC lookup did not return a row matching {row_matchers}"
            )
        else:
            failures.append(f"no relevant evidence in the top {top_k}")

    return CaseResult(
        case_id=case["id"],
        shape=case.get("shape", "unspecified"),
        question=question,
        route=result.route,
        hit=first_rank is not None,
        first_relevant_rank=first_rank,
        # Clamped: a metric above 1.0 is always a bug in the harness, not a
        # remarkable result, and it should be visibly impossible rather than
        # quietly reported.
        recall_at_k=min(1.0, relevant_found / total_relevant) if total_relevant else 0.0,
        # DTC-row evidence counts as a single returned item for precision, so
        # a lookup that returns one correct row plus no chunks scores 1.0
        # rather than being divided by an empty passage list.
        precision_at_k=(
            (relevant_found / len(passages)) if passages
            else (1.0 if row_hit else 0.0)
        ),
        reciprocal_rank=(1.0 / first_rank) if first_rank else 0.0,
        confidence=result.confidence,
        sufficient=result.sufficient,
        took_ms=result.took_ms,
        failures=failures,
        retrieved=[
            f"[{p.chunk.doc_type}] {p.chunk.citation}"[:140] for p in passages[:5]
        ],
    )


def aggregate(results: list[CaseResult]) -> dict:
    """Overall and per-shape. Cases with no `relevant` matchers (the negative
    and applicability cases) are excluded from the ranking averages — they
    assert a behaviour, not a ranking, and averaging a zero in would make the
    headline numbers meaningless."""
    ranked = [r for r in results if _is_ranking_case(r)]
    return {
        "cases": len(results),
        "passed": sum(1 for r in results if r.passed),
        "failed": sum(1 for r in results if not r.passed),
        "hit_rate": _mean([r.hit for r in ranked]),
        "mrr": _mean([r.reciprocal_rank for r in ranked]),
        "recall_at_k": _mean([r.recall_at_k for r in ranked]),
        "precision_at_k": _mean([r.precision_at_k for r in ranked]),
        "median_latency_ms": _median([r.took_ms for r in results]),
        "p95_latency_ms": _percentile([r.took_ms for r in results], 95),
    }


# Cases that assert behaviour rather than ranking are tagged by shape.
_BEHAVIOUR_SHAPES = {"negative", "applicability"}


def _is_ranking_case(result: CaseResult) -> bool:
    return result.shape not in _BEHAVIOUR_SHAPES


def by_shape(results: list[CaseResult]) -> dict[str, dict]:
    shapes: dict[str, list[CaseResult]] = {}
    for result in results:
        shapes.setdefault(result.shape, []).append(result)
    return {shape: aggregate(items) for shape, items in sorted(shapes.items())}


def _mean(values) -> float:
    values = [float(v) for v in values]
    return round(sum(values) / len(values), 4) if values else 0.0


def _median(values) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return float(ordered[mid])
    return (ordered[mid - 1] + ordered[mid]) / 2


def _percentile(values, pct: int) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, int(round(pct / 100 * (len(ordered) - 1))))
    return float(ordered[index])
