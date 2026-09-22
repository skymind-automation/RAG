"""End-to-end tests against a real Postgres with pgvector.

These exercise the parts that cannot be tested in isolation: the generated
tsvector column, the RRF fusion over two live retrievers, and the pre-filter
actually excluding rows.
"""
import pytest
from django.urls import reverse

from knowledge.constants import AccessLevel
from knowledge.ingestion.parsers import parse_dtc_table, parse_manual, parse_tsb
from knowledge.ingestion.pipeline import _ingest_document, _ingest_dtc_rows, IngestStats
from knowledge.models import Chunk, DTCCode, Document
from knowledge.retrieval.service import Route, RetrievalService
from pathlib import Path

DATA = Path("data")

pytestmark = pytest.mark.django_db


@pytest.fixture
def corpus():
    stats = IngestStats()
    for path in sorted((DATA / "manuals").glob("*.md")):
        _ingest_document(parse_manual(path), stats, force=True, dry_run=False)
    for path in sorted((DATA / "tsbs").glob("*.md")):
        _ingest_document(parse_tsb(path), stats, force=True, dry_run=False)
    csv_path = DATA / "dtc" / "dtc_codes.csv"
    _ingest_dtc_rows(parse_dtc_table(csv_path), csv_path, stats, dry_run=False)
    return stats


@pytest.fixture
def service():
    return RetrievalService()


def test_corpus_ingests(corpus):
    assert Document.objects.count() >= 9
    assert Chunk.objects.count() >= 25
    assert DTCCode.objects.count() == 29
    # Every chunk must be embedded; an un-embedded chunk is invisible to the
    # dense retriever and silently halves recall.
    assert not Chunk.objects.filter(embedding__isnull=True).exists()


def test_search_vector_is_populated_by_postgres(corpus):
    # Never written by application code -- if this is NULL the GENERATED
    # column definition is broken and lexical search returns nothing.
    assert not Chunk.objects.filter(search_vector__isnull=True).exists()


def test_search_vector_updates_when_content_changes(corpus):
    chunk = Chunk.objects.first()
    chunk.content = "a completely different body mentioning frobnicator widgets"
    chunk.save()
    chunk.refresh_from_db()
    # Stored as stemmed lexemes, so look for the stem rather than the word.
    assert "frobnic" in chunk.search_vector


def test_search_vector_weights_headings_above_body(corpus):
    """Heading terms go in at weight A, body text at weight B, so a query
    matching a procedure title outranks the same words buried in a table."""
    chunk = Chunk.objects.filter(heading_path__len__gt=0).first()
    vector = chunk.search_vector
    assert ":" in vector
    assert "A" in vector and "B" in vector
    heading_word = chunk.heading_path[-1].split()[0].lower()[:5]
    # The heading's own terms must carry the A weight.
    assert any(
        entry.split(":")[0].strip("'").startswith(heading_word[:4]) and "A" in entry
        for entry in vector.split()
    )


def test_dtc_shortcut_skips_vector_search(corpus, service):
    result = service.search("what is P0299", vehicle_context={"model": "Freightliner Cascadia"})
    assert result.route == Route.DTC_EXACT
    assert [m.code.code for m in result.dtc_matches] == ["P0299"]
    assert result.confidence == 1.0


def test_dtc_family_fallback(corpus, service):
    # P0307 is not in the table; the P030x misfire family carries the answer.
    result = service.search("P0307")
    assert result.route == Route.DTC_EXACT
    assert result.dtc_matches
    assert all(m.match_type == "family" for m in result.dtc_matches)
    assert result.dtc_matches[0].code.code.startswith("P030")


def test_dtc_duplicate_codes_return_each_chunk_once(corpus, service):
    # P0299 and P2263 both point at TSB 23-0412.
    result = service.search("P0299 and P2263 together")
    ids = [p.chunk.pk for p in result.passages]
    assert len(ids) == len(set(ids))


def test_hybrid_uses_both_retrievers(corpus, service):
    result = service.search(
        "brakes squeal at low speed",
        vehicle_context={"model": "Ford Transit", "model_year": 2021},
    )
    assert result.route == Route.HYBRID
    top = result.passages[0]
    assert top.lexical_rank is not None
    assert top.dense_rank is not None
    assert top.chunk.tsb_number == "21-0918"


def test_year_filter_is_never_relaxed(corpus, service):
    """A 2019 vehicle must not be shown a 2021-2023 bulletin.

    This is the failure that matters most: an inapplicable bulletin produces a
    confident, billable recommendation for work that will not fix the vehicle.
    """
    result = service.search(
        "shudder on cold start",
        vehicle_context={"model": "Ford Transit", "model_year": 2019},
    )
    assert all(p.chunk.tsb_number != "22-2107" for p in result.passages)


def test_model_filter_excludes_other_models(corpus, service):
    result = service.search(
        "brake squeal bulletin",
        vehicle_context={"model": "RAM ProMaster", "model_year": 2021},
    )
    assert all(p.chunk.model in ("promaster", "") for p in result.passages)


def test_inferred_system_does_not_gate(corpus, service):
    """"Shudder on cold start" scores as `engine` on keywords, but the
    bulletin that answers it is filed under `transmission`."""
    result = service.search(
        "customer says shudder on cold start",
        vehicle_context={"model": "Ford Transit", "model_year": 2022},
    )
    assert any(p.chunk.tsb_number == "22-2107" for p in result.passages)


def test_mileage_expansion_bridges_60k_and_60000(corpus, service):
    result = service.search(
        "what's due at 60k miles",
        vehicle_context={"model": "Ford Transit", "model_year": 2022},
    )
    assert result.passages
    assert any("60,000" in p.chunk.content for p in result.passages[:3])


def test_out_of_scope_query_reports_insufficient(corpus, service):
    result = service.search(
        "what is the warranty claim procedure for a windshield chip",
        vehicle_context={"model": "Ford Transit", "model_year": 2022},
    )
    assert not result.sufficient


def test_access_control_hides_restricted_chunks(corpus, service):
    Chunk.objects.filter(tsb_number="21-0918").update(
        access_level=AccessLevel.INTERNAL
    )
    result = service.search(
        "brakes squeal at low speed",
        vehicle_context={"model": "Ford Transit", "model_year": 2021},
        role=AccessLevel.ADVISOR,
    )
    assert all(p.chunk.tsb_number != "21-0918" for p in result.passages)


def test_idempotent_reingest_is_a_noop(corpus):
    before = Chunk.objects.count()
    stats = IngestStats()
    for path in sorted((DATA / "manuals").glob("*.md")):
        _ingest_document(parse_manual(path), stats, force=False, dry_run=False)
    assert stats.documents_skipped == len(list((DATA / "manuals").glob("*.md")))
    assert Chunk.objects.count() == before


# --- HTTP surface -----------------------------------------------------------

def test_retrieve_endpoint(client, corpus):
    response = client.post(
        reverse("knowledge:retrieve"),
        data={
            "query": "brakes squeal at low speed",
            "vehicle_context": {"model": "Ford Transit", "model_year": 2021},
            "top_k": 3,
        },
        content_type="application/json",
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["route"] == "hybrid"
    assert payload["passages"]
    citation = payload["passages"][0]["citation"]
    # Citations are mandatory: doc name + section + TSB number.
    assert citation["document_title"]
    assert citation["source_file"]
    assert citation["tsb_number"] == "21-0918"


def test_retrieve_rejects_an_empty_query(client, corpus):
    response = client.post(
        reverse("knowledge:retrieve"), data={"query": "  "},
        content_type="application/json",
    )
    assert response.status_code == 400


def test_retrieve_rejects_an_unknown_role(client, corpus):
    response = client.post(
        reverse("knowledge:retrieve"),
        data={"query": "brakes", "role": "root"},
        content_type="application/json",
    )
    assert response.status_code == 400


def test_dtc_endpoint(client, corpus):
    response = client.get(reverse("knowledge:dtc-detail", args=["p0299"]))
    assert response.status_code == 200
    payload = response.json()
    assert payload["code"] == "P0299"
    assert payload["matches"][0]["severity"] == "high"
    assert payload["matches"][0]["likely_causes"]


def test_dtc_endpoint_404s_for_an_unknown_code(client, corpus):
    response = client.get(reverse("knowledge:dtc-detail", args=["P9999"]))
    assert response.status_code == 404


def test_dtc_description_search(client, corpus):
    response = client.get(reverse("knowledge:dtc-search"), {"q": "misfire"})
    assert response.status_code == 200
    assert response.json()["results"]


def test_healthz_reports_corpus_and_embedding_model(client, corpus):
    payload = client.get(reverse("knowledge:healthz")).json()
    assert payload["status"] == "ok"
    assert payload["chunks_missing_embedding"] == 0
    assert payload["embedding_backend"] == "hashing"
    assert payload["synthetic_documents"] > 0
