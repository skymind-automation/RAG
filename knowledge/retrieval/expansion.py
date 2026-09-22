"""Lexical query expansion.

Narrow and deterministic on purpose. This is not query rewriting with an LLM;
it is closing specific, known vocabulary gaps between how advisors type and how
OEM documents are written. Each rule below exists because a real query missed a
document it should have found.

Dense retrieval does not need these -- embeddings handle paraphrase. The
lexical half does, because `to_tsquery('60k')` and `to_tsquery('60,000')` share
no lexeme at all.
"""
from __future__ import annotations

import re

from knowledge.retrieval.entities import QueryEntities

# Advisor shorthand -> the spellings a manual actually uses.
_ABBREVIATIONS = {
    "ac": ["a/c", "air conditioning"],
    "a/c": ["air conditioning"],
    "trans": ["transmission"],
    "regen": ["regeneration"],
    "def": ["diesel exhaust fluid", "reductant"],
    "dpf": ["diesel particulate filter"],
    "egr": ["exhaust gas recirculation"],
    "epb": ["electric parking brake"],
    "cel": ["check engine light", "malfunction indicator"],
    "tsb": ["bulletin"],
    "pm": ["scheduled maintenance"],
}


def mileage_variants(mileage: int) -> list[str]:
    """Every way a mileage is written across a query and a manual.

    An advisor types "60k". The maintenance table says "60,000 mi" and
    "96,000 km". Without this the lexical retriever scores zero on the one
    chunk that answers the question.
    """
    variants = {
        f"{mileage}",
        f"{mileage:,}",
    }
    if mileage % 1000 == 0:
        variants.add(f"{mileage // 1000}k")
    # The same interval in kilometres, since fleet manuals print both and
    # round to the nearest thousand.
    km = round(mileage * 1.609344 / 1000) * 1000
    variants.add(f"{km}")
    variants.add(f"{km:,}")
    return sorted(variants)


def expand_lexical_query(query: str, entities: QueryEntities) -> str:
    """Return the text handed to `websearch_to_tsquery`.

    Terms are appended, never substituted: the advisor's own wording stays in
    the query, so an expansion can add recall but cannot take any away.
    """
    additions: list[str] = []

    if entities.mileage:
        additions.extend(mileage_variants(entities.mileage))

    lowered = query.lower()
    for short, longs in _ABBREVIATIONS.items():
        if re.search(rf"\b{re.escape(short)}\b", lowered):
            additions.extend(longs)

    # A DTC code that survived to the hybrid path (no table row) is still worth
    # searching for as a literal string in bulletin text.
    additions.extend(entities.dtc_codes)
    additions.extend(entities.tsb_numbers)

    if not additions:
        return query
    unique = [a for a in dict.fromkeys(additions) if a.lower() not in lowered]
    return f"{query} {' '.join(unique)}" if unique else query
