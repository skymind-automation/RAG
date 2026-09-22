"""Metadata extraction and normalization for ingestion.

Every chunk is tagged with model / model_year / system / doc_type before it is
embedded, because those tags are the hard pre-filter at retrieval time. This
module is where a source file's front matter (or, failing that, its filename
and body) is turned into those tags.

Normalization is strict and one-way: "Ford Transit 350HD" and "transit-350"
must both land on the same `model` string, or the pre-filter silently hides
half the corpus.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date

import yaml

from knowledge.constants import AccessLevel, DocType, VehicleSystem

FRONT_MATTER_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*\n", re.DOTALL)
YEAR_RANGE_RE = re.compile(r"\b(19|20)\d{2}\b")
DTC_RE = re.compile(r"\b([PBCU])([0-9])([0-9A-F])([0-9A-F]{2})\b", re.IGNORECASE)

# Canonical model slug -> the spellings an OEM, a fleet spreadsheet and an
# advisor each use for the same vehicle.
MODEL_ALIASES: dict[str, list[str]] = {
    "transit": ["transit", "ford transit", "transit 250", "transit 350",
                "transit-350", "t-350", "transit350"],
    "promaster": ["promaster", "ram promaster", "pro master", "promaster 2500",
                  "promaster 3500"],
    "cascadia": ["cascadia", "freightliner cascadia", "new cascadia"],
    "npr": ["npr", "isuzu npr", "npr-hd", "npr hd", "n-series"],
    "f-650": ["f-650", "f650", "ford f-650", "f 650"],
}

# Reverse index, longest alias first so "ram promaster" wins over "promaster".
_ALIAS_LOOKUP: list[tuple[str, str]] = sorted(
    ((alias, canon) for canon, aliases in MODEL_ALIASES.items() for alias in aliases),
    key=lambda pair: -len(pair[0]),
)


def normalize_model(raw: str | None) -> str:
    if not raw:
        return ""
    text = re.sub(r"[^a-z0-9\- ]+", " ", raw.lower()).strip()
    text = re.sub(r"\s+", " ", text)
    for alias, canon in _ALIAS_LOOKUP:
        if alias == text:
            return canon
    for alias, canon in _ALIAS_LOOKUP:
        if re.search(rf"\b{re.escape(alias)}\b", text):
            return canon
    # Unknown model: keep a slug rather than dropping it, so the corpus is
    # still filterable and the gap shows up in the eval report.
    return re.sub(r"\s+", "-", text)


def normalize_system(raw: str | None) -> str:
    if not raw:
        return VehicleSystem.GENERAL
    key = raw.strip().lower().replace(" ", "_").replace("-", "_")
    if key in VehicleSystem.ALL:
        return key
    for system, keywords in VehicleSystem.KEYWORDS.items():
        if key in keywords:
            return system
    return VehicleSystem.GENERAL


def infer_system(text: str, default: str = VehicleSystem.GENERAL) -> str:
    """Score the body against the system keyword lists. Used only when front
    matter does not declare a system -- a declared value always wins."""
    lowered = text.lower()
    scores: dict[str, int] = {}
    for system, keywords in VehicleSystem.KEYWORDS.items():
        hits = sum(len(re.findall(rf"\b{re.escape(k)}\b", lowered)) for k in keywords)
        if hits:
            scores[system] = hits
    if not scores:
        return default
    return max(scores.items(), key=lambda kv: kv[1])[0]


def extract_dtc_codes(text: str) -> list[str]:
    """Pull DTC codes out of prose, preserving document order, de-duplicated."""
    seen: dict[str, None] = {}
    for match in DTC_RE.finditer(text):
        seen.setdefault(match.group(0).upper(), None)
    return list(seen)


# Symptom vocabulary. Deliberately advisor-phrasing, not technician-phrasing:
# advisors type what the customer said.
SYMPTOM_TERMS = [
    "shudder", "shake", "vibration", "cold start", "hard start", "no start",
    "no crank", "stall", "stalling", "rough idle", "hesitation", "surging",
    "misfire", "knock", "tick", "ticking", "squeal", "squeak", "grinding",
    "pulling", "pulsation", "smell", "smoke", "leak", "leaking", "overheat",
    "overheating", "warning light", "check engine light", "limp mode",
    "derate", "loss of power", "poor fuel economy", "rattle", "clunk",
    "whine", "hum", "won't shift", "slipping", "delayed engagement",
    "no heat", "no cooling", "blows warm", "water in fuel", "regen",
]


# Word-boundary patterns, built once. Substring matching is not good enough
# here: "stall" is inside "Installation" and "leak" is inside "leakage", and
# both would tag half a manual with symptoms it does not describe.
_SYMPTOM_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(rf"\b{re.escape(term)}\b"), term) for term in SYMPTOM_TERMS
]


def extract_symptom_keywords(text: str) -> list[str]:
    lowered = text.lower()
    return [term for pattern, term in _SYMPTOM_PATTERNS if pattern.search(lowered)]


@dataclass
class DocumentMeta:
    """Normalized metadata for one source document."""

    title: str
    doc_type: str
    source_file: str
    source_uri: str = ""
    oem: str = ""
    model: str = ""
    model_year_start: int | None = None
    model_year_end: int | None = None
    system: str = VehicleSystem.GENERAL
    tsb_number: str = ""
    revision: str = ""
    issued_on: date | None = None
    access_level: str = AccessLevel.ADVISOR
    is_synthetic: bool = False
    extra: dict = field(default_factory=dict)

    def validate(self) -> list[str]:
        problems = []
        if self.doc_type not in DocType.ALL:
            problems.append(f"unknown doc_type {self.doc_type!r}")
        if self.system not in VehicleSystem.ALL:
            problems.append(f"unknown system {self.system!r}")
        if self.access_level not in AccessLevel.ALL:
            problems.append(f"unknown access_level {self.access_level!r}")
        if (
            self.model_year_start
            and self.model_year_end
            and self.model_year_end < self.model_year_start
        ):
            problems.append("model_year_end precedes model_year_start")
        if self.doc_type == DocType.TSB and not self.tsb_number:
            problems.append("TSB is missing a tsb_number, which citations require")
        return problems


def parse_front_matter(raw: str) -> tuple[dict, str]:
    """Split optional YAML front matter off the top of a markdown file."""
    match = FRONT_MATTER_RE.match(raw)
    if not match:
        return {}, raw
    try:
        data = yaml.safe_load(match.group(1)) or {}
    except yaml.YAMLError as exc:
        raise ValueError(f"invalid YAML front matter: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError("front matter must be a YAML mapping")
    return data, raw[match.end():]


def parse_year_range(value) -> tuple[int | None, int | None]:
    """Accept 2021, '2021', '2021-2024', '2021+', [2021, 2024]."""
    if value is None or value == "":
        return None, None
    if isinstance(value, int):
        return value, value
    if isinstance(value, (list, tuple)) and value:
        years = [int(v) for v in value if v]
        return min(years), max(years)
    text = str(value).strip()
    if text.endswith("+"):
        return int(text[:-1]), None
    years = [int(y) for y in re.findall(r"(?:19|20)\d{2}", text)]
    if not years:
        return None, None
    if len(years) == 1:
        return years[0], years[0]
    return min(years), max(years)
