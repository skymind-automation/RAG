"""Metadata normalization. A wrong tag here is an invisible document later."""
import pytest

from knowledge.ingestion.metadata import (
    extract_dtc_codes,
    extract_symptom_keywords,
    infer_system,
    normalize_model,
    parse_front_matter,
    parse_year_range,
)


@pytest.mark.parametrize("raw", [
    "Ford Transit", "transit", "TRANSIT 350", "Transit-350", "t-350", " transit  ",
])
def test_model_aliases_normalize_to_one_slug(raw):
    assert normalize_model(raw) == "transit"


def test_longer_alias_wins():
    assert normalize_model("RAM ProMaster 2500") == "promaster"


def test_unknown_model_is_slugged_not_dropped():
    # Dropping it would make the document unfilterable and silently invisible.
    assert normalize_model("Hino 195h") == "hino-195h"


@pytest.mark.parametrize("value,expected", [
    (2021, (2021, 2021)),
    ("2021-2024", (2021, 2024)),
    ("2021+", (2021, None)),
    ([2019, 2023], (2019, 2023)),
    (None, (None, None)),
    ("", (None, None)),
])
def test_year_ranges(value, expected):
    assert parse_year_range(value) == expected


def test_dtc_extraction_is_ordered_and_deduped():
    text = "Sets P0299, then P2263, and P0299 again."
    assert extract_dtc_codes(text) == ["P0299", "P2263"]


def test_symptom_keywords_use_word_boundaries():
    # "Installation" contains "stall"; substring matching would tag every
    # procedure in every manual as a stalling complaint.
    assert "stall" not in extract_symptom_keywords("Installation of the caliper")
    assert "stall" in extract_symptom_keywords("The engine will stall at idle")


def test_system_inference_picks_the_dominant_system():
    assert infer_system("brake pad rotor caliper squeal") == "brakes"
    assert infer_system("no discernible content", default="general") == "general"


def test_front_matter_round_trip():
    data, body = parse_front_matter("---\nmodel: Ford Transit\n---\n# Title\n")
    assert data == {"model": "Ford Transit"}
    assert body.strip() == "# Title"


def test_front_matter_absent_is_not_an_error():
    data, body = parse_front_matter("# Title\n")
    assert data == {}
    assert body == "# Title\n"


def test_malformed_front_matter_raises():
    with pytest.raises(ValueError):
        parse_front_matter("---\n: : :\nmodel: [unclosed\n---\nbody\n")
