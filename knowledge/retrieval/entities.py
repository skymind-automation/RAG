"""Entity extraction pre-filter.

The single highest-leverage piece of the retrieval flow. An advisor always has
the vehicle in front of them, so model/year is structural context, not
something an LLM should infer from a vague sentence. Cheap regex + a normalized
alias table, no model call: this runs on every query and must cost nothing.

Precedence: an explicitly supplied vehicle context (from the ERP screen the
advisor is already looking at) always beats anything parsed out of the query
text. The text parse is the fallback for when the caller sends nothing.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from knowledge.constants import VehicleSystem
from knowledge.ingestion.metadata import MODEL_ALIASES, normalize_model

DTC_RE = re.compile(r"\b([PBCU][0-9][0-9A-F][0-9A-F]{2})\b", re.IGNORECASE)
YEAR_RE = re.compile(r"\b(19[89]\d|20[0-4]\d)\b")
# "60k", "60,000 miles", "60000 mi", "at 90k"
MILEAGE_RE = re.compile(
    r"\b(\d{1,3}(?:,\d{3})+|\d{1,3}\s*k|\d{4,7})\s*(?:miles|mile|mi\b|km\b)?",
    re.IGNORECASE,
)
MILEAGE_CONTEXT_RE = re.compile(r"\b(?:miles|mile|mi|km|service|interval|due)\b",
                                re.IGNORECASE)

_ALIAS_PATTERNS: list[tuple[re.Pattern, str]] = sorted(
    (
        (re.compile(rf"\b{re.escape(alias)}\b", re.IGNORECASE), canon)
        for canon, aliases in MODEL_ALIASES.items()
        for alias in aliases
    ),
    key=lambda pair: -len(pair[0].pattern),
)


@dataclass
class QueryEntities:
    """What we could pin down about the query before searching anything."""

    dtc_codes: list[str] = field(default_factory=list)
    model: str = ""
    model_year: int | None = None
    mileage: int | None = None
    systems: list[str] = field(default_factory=list)
    tsb_numbers: list[str] = field(default_factory=list)
    # Where each value came from, so the API response can show the advisor
    # what the filter actually did.
    sources: dict[str, str] = field(default_factory=dict)

    @property
    def has_dtc(self) -> bool:
        return bool(self.dtc_codes)

    @property
    def primary_system(self) -> str | None:
        return self.systems[0] if self.systems else None

    def as_dict(self) -> dict:
        return {
            "dtc_codes": self.dtc_codes,
            "model": self.model,
            "model_year": self.model_year,
            "mileage": self.mileage,
            "systems": self.systems,
            "tsb_numbers": self.tsb_numbers,
            "sources": self.sources,
        }


def extract_entities(query: str, vehicle_context: dict | None = None) -> QueryEntities:
    """Parse a query, then let explicit vehicle context override it."""
    entities = QueryEntities()
    text = query or ""

    codes = [m.group(1).upper() for m in DTC_RE.finditer(text)]
    entities.dtc_codes = list(dict.fromkeys(codes))
    if entities.dtc_codes:
        entities.sources["dtc_codes"] = "query"

    for pattern, canon in _ALIAS_PATTERNS:
        if pattern.search(text):
            entities.model = canon
            entities.sources["model"] = "query"
            break

    # A 4-digit year and a DTC code can look alike to a loose regex; strip the
    # codes out before looking for years.
    year_text = DTC_RE.sub(" ", text)
    years = [int(m.group(1)) for m in YEAR_RE.finditer(year_text)]
    if years:
        entities.model_year = years[0]
        entities.sources["model_year"] = "query"

    entities.mileage = _extract_mileage(year_text)
    if entities.mileage is not None:
        entities.sources["mileage"] = "query"

    entities.systems = _extract_systems(text)
    if entities.systems:
        entities.sources["systems"] = "query"

    entities.tsb_numbers = _extract_tsb_numbers(text)
    if entities.tsb_numbers:
        entities.sources["tsb_numbers"] = "query"

    if vehicle_context:
        _apply_vehicle_context(entities, vehicle_context)
    return entities


def _apply_vehicle_context(entities: QueryEntities, context: dict) -> None:
    """Structural context wins. The advisor's screen is ground truth; the
    sentence they typed is a guess."""
    model = normalize_model(context.get("model"))
    if model:
        entities.model = model
        entities.sources["model"] = "vehicle_context"

    year = context.get("model_year") or context.get("year")
    if year:
        try:
            entities.model_year = int(year)
            entities.sources["model_year"] = "vehicle_context"
        except (TypeError, ValueError):
            pass

    # An explicitly supplied system (the advisor picked it, or the caller is
    # the Incident Investigator which knows what subsystem flagged) is
    # trustworthy enough to gate on. An inferred one is not -- see filters.py.
    system = context.get("system")
    if system:
        from knowledge.ingestion.metadata import normalize_system

        entities.systems = [normalize_system(system)]
        entities.sources["systems"] = "vehicle_context"

    mileage = context.get("mileage") or context.get("odometer")
    if mileage:
        try:
            entities.mileage = int(mileage)
            entities.sources["mileage"] = "vehicle_context"
        except (TypeError, ValueError):
            pass


def _extract_mileage(text: str) -> int | None:
    if not MILEAGE_CONTEXT_RE.search(text):
        # Without a mileage word nearby, a bare number is far more likely to
        # be a quantity, a bay number or a part count.
        if not re.search(r"\b\d{1,3}\s*k\b", text, re.IGNORECASE):
            return None
    for match in MILEAGE_RE.finditer(text):
        raw = match.group(1).strip().lower()
        if raw.endswith("k"):
            try:
                return int(float(raw[:-1].strip()) * 1000)
            except ValueError:
                continue
        value = int(raw.replace(",", ""))
        # Reject anything that is obviously a model year rather than an odometer.
        if 1980 <= value <= 2100 and "," not in raw:
            continue
        if value >= 1000:
            return value
    return None


def _extract_systems(text: str) -> list[str]:
    """Rank systems by keyword hits. Returns strongest first; the caller
    decides whether to apply it as a hard filter or a soft boost."""
    lowered = text.lower()
    scored: list[tuple[str, int]] = []
    for system, keywords in VehicleSystem.KEYWORDS.items():
        hits = sum(1 for kw in keywords if re.search(rf"\b{re.escape(kw)}\b", lowered))
        if hits:
            scored.append((system, hits))
    scored.sort(key=lambda kv: (-kv[1], kv[0]))
    return [system for system, _ in scored]


def _extract_tsb_numbers(text: str) -> list[str]:
    matches = re.findall(
        r"\b(?:TSB|bulletin)\s*(?:no\.?|#|number)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-/]{3,})",
        text, re.IGNORECASE,
    )
    return list(dict.fromkeys(m.upper() for m in matches))
