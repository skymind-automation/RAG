"""Entity extraction: the pre-filter's input, so precision matters more than
recall here. A wrong model tag returns a confident page of wrong documents."""
from knowledge.retrieval.entities import extract_entities


def test_dtc_code_extracted_and_uppercased():
    e = extract_entities("customer says p0299 keeps coming back")
    assert e.dtc_codes == ["P0299"]
    assert e.has_dtc


def test_model_and_year_from_query_text():
    e = extract_entities("2022 Ford Transit with a brake noise")
    assert e.model == "transit"
    assert e.model_year == 2022


def test_vehicle_context_overrides_the_query_text():
    # The advisor's screen is ground truth; the sentence they typed is a guess.
    e = extract_entities(
        "I think it's a transit", {"model": "RAM ProMaster", "model_year": 2021}
    )
    assert e.model == "promaster"
    assert e.sources["model"] == "vehicle_context"


def test_dtc_code_is_not_mistaken_for_a_year():
    e = extract_entities("P0299 on the truck")
    assert e.model_year is None


def test_mileage_shorthand():
    assert extract_entities("due at 60k miles").mileage == 60000
    assert extract_entities("customer is at 60,000 miles").mileage == 60000


def test_bare_number_without_mileage_context_is_ignored():
    assert extract_entities("we have 3000 of these in stock").mileage is None


def test_model_year_is_not_read_as_mileage():
    assert extract_entities("2022 model, needs service").mileage is None


def test_system_inferred_from_query_is_marked_as_such():
    e = extract_entities("brakes are squealing")
    assert e.primary_system == "brakes"
    assert e.sources["systems"] == "query"


def test_explicit_system_is_marked_as_context():
    e = extract_entities("noise", {"system": "brakes"})
    assert e.primary_system == "brakes"
    assert e.sources["systems"] == "vehicle_context"


def test_tsb_number_extraction():
    assert extract_entities("anything on TSB 22-2107?").tsb_numbers == ["22-2107"]
