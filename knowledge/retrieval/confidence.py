"""Retrieval confidence, for the safety gate.

The fused RRF score cannot serve as confidence, and using it is a trap worth
naming. RRF scores depend only on *rank*, so the top result of a search over a
corpus containing nothing relevant scores almost exactly the same as the top
result of a search that found the right bulletin. A threshold on the fused
score therefore fires at random.

Confidence has to come from the absolute signals underneath the fusion:

  dense    cosine similarity, already in [0, 1], means "how close in embedding
           space" and is comparable across queries
  lexical  ts_rank_cd with rank/(rank+1) normalization, also in [0, 1], means
           "how well and how densely the query terms matched"
  agreement both retrievers independently putting the same chunk first is
           strong evidence; either one alone is weaker

The output feeds the gate the Notion doc calls for: below the floor, answer
"insufficient documentation" rather than letting a model fill the gap.
"""
from __future__ import annotations

from dataclasses import dataclass

# Weight on the stronger of the two retrievers vs. the weaker one. Deliberately
# lopsided: one retriever being certain is meaningful on its own (an exact TSB
# number match is lexical-only; a paraphrased symptom is dense-only), so the
# blend must not punish a confident single-retriever hit.
_STRONG_WEIGHT = 0.75
_WEAK_WEIGHT = 0.25
# Both retrievers independently ranking the same chunk first.
_AGREEMENT_BONUS = 0.10


@dataclass
class ConfidenceReport:
    score: float
    dense: float
    lexical: float
    agreement: bool
    basis: str

    def as_dict(self) -> dict:
        return {
            "score": round(self.score, 4),
            "dense": round(self.dense, 4),
            "lexical": round(self.lexical, 4),
            "retriever_agreement": self.agreement,
            "basis": self.basis,
        }


def _clamp(value: float | None) -> float:
    if value is None:
        return 0.0
    return max(0.0, min(1.0, float(value)))


def score_confidence(passages: list) -> ConfidenceReport:
    """Confidence in the top result, in [0, 1]."""
    if not passages:
        return ConfidenceReport(0.0, 0.0, 0.0, False, "no results")

    top = passages[0]
    dense = _clamp(top.dense_score)
    lexical = _clamp(top.lexical_score)
    agreement = top.lexical_rank == 1 and top.dense_rank == 1

    strong, weak = (dense, lexical) if dense >= lexical else (lexical, dense)
    score = _STRONG_WEIGHT * strong + _WEAK_WEIGHT * weak
    if agreement:
        score += _AGREEMENT_BONUS

    if dense and lexical:
        basis = "both retrievers"
    elif dense:
        basis = "dense only"
    elif lexical:
        basis = "lexical only"
    else:
        basis = "neither retriever scored the top result"

    return ConfidenceReport(
        score=min(1.0, score), dense=dense, lexical=lexical,
        agreement=agreement, basis=basis,
    )
