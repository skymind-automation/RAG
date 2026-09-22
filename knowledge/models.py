"""Postgres schema for the Delta RAG knowledge base.

Three tables, deliberately shaped around the retrieval flow rather than around
the source documents:

  documents   one row per source file (a manual, a TSB, a DTC table release)
  chunks      the retrievable unit, with a pgvector embedding and denormalized
              filter columns so the pre-filter never needs a join
  dtc_codes   a plain lookup table, NOT chunked and NOT embedded as prose

The denormalization on `chunks` is intentional. Every advisor query filters on
model / model_year / system / doc_type before it does anything else, and a join
to `documents` on every vector scan is the difference between a filter Postgres
can push into the index and one it applies after.
"""
from django.conf import settings
from django.contrib.postgres.fields import ArrayField
from django.contrib.postgres.indexes import GinIndex
from django.contrib.postgres.search import SearchVectorField
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import F, Func
from pgvector.django import VectorField

from knowledge.constants import AccessLevel, DocType, Severity, VehicleSystem

EMBEDDING_DIM = settings.RAG_EMBEDDING_DIM


class Document(models.Model):
    """One source file. Chunks hang off this; citations resolve back to it."""

    # --- identity -------------------------------------------------------
    title = models.CharField(max_length=512)
    doc_type = models.CharField(max_length=32, choices=DocType.CHOICES, db_index=True)
    source_file = models.CharField(
        max_length=1024,
        help_text="Path or object key of the file this was ingested from.",
    )
    source_uri = models.URLField(
        max_length=1024, blank=True, default="",
        help_text="Canonical OEM location, surfaced in citations when present.",
    )

    # --- vehicle applicability ------------------------------------------
    oem = models.CharField(max_length=64, blank=True, default="", db_index=True)
    model = models.CharField(
        max_length=128, blank=True, default="", db_index=True,
        help_text="Normalized vehicle model, e.g. 'transit'. Blank = applies to all.",
    )
    model_year_start = models.IntegerField(
        null=True, blank=True,
        validators=[MinValueValidator(1980), MaxValueValidator(2100)],
    )
    model_year_end = models.IntegerField(
        null=True, blank=True,
        validators=[MinValueValidator(1980), MaxValueValidator(2100)],
    )
    system = models.CharField(
        max_length=32, choices=VehicleSystem.CHOICES,
        default=VehicleSystem.GENERAL, db_index=True,
    )

    # --- bulletin-specific ----------------------------------------------
    tsb_number = models.CharField(max_length=64, blank=True, default="", db_index=True)
    revision = models.CharField(max_length=32, blank=True, default="")
    issued_on = models.DateField(null=True, blank=True)

    # --- governance ------------------------------------------------------
    access_level = models.CharField(
        max_length=16, choices=AccessLevel.CHOICES, default=AccessLevel.ADVISOR,
    )
    is_synthetic = models.BooleanField(
        default=False,
        help_text="True for representative sample corpora, so eval numbers "
                  "measured on them are never mistaken for production numbers.",
    )

    # --- ingestion bookkeeping -------------------------------------------
    content_hash = models.CharField(
        max_length=64, db_index=True,
        help_text="SHA-256 of the raw source bytes. Drives idempotent re-ingest.",
    )
    ingested_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = "rag_documents"
        constraints = [
            models.UniqueConstraint(
                fields=["source_file", "content_hash"], name="uniq_doc_source_hash",
            ),
            models.CheckConstraint(
                check=models.Q(model_year_end__isnull=True)
                | models.Q(model_year_start__isnull=True)
                | models.Q(model_year_end__gte=models.F("model_year_start")),
                name="ck_doc_year_range",
            ),
        ]
        indexes = [
            models.Index(fields=["model", "doc_type"], name="ix_doc_model_type"),
            models.Index(fields=["model", "system"], name="ix_doc_model_system"),
        ]

    def __str__(self) -> str:
        return f"[{self.doc_type}] {self.title}"

    def covers_year(self, year: int | None) -> bool:
        if year is None:
            return True
        if self.model_year_start and year < self.model_year_start:
            return False
        if self.model_year_end and year > self.model_year_end:
            return False
        return True

    @property
    def year_label(self) -> str:
        if not self.model_year_start and not self.model_year_end:
            return "all years"
        if self.model_year_start == self.model_year_end:
            return str(self.model_year_start)
        return f"{self.model_year_start or '?'}-{self.model_year_end or 'present'}"


class Chunk(models.Model):
    """The retrievable unit.

    Manuals chunk by procedure/section heading; a TSB is a single chunk. Never
    by fixed token count -- a procedure split in half retrieves as two useless
    halves.
    """

    document = models.ForeignKey(
        Document, on_delete=models.CASCADE, related_name="chunks",
    )
    ordinal = models.IntegerField(help_text="Position within the source document.")

    # --- content ---------------------------------------------------------
    heading_path = ArrayField(
        models.CharField(max_length=256), default=list, blank=True,
        help_text="Heading breadcrumb, outermost first. Used in citations.",
    )
    content = models.TextField(help_text="Markdown. Tables stay tables.")
    content_chars = models.IntegerField(default=0)
    contains_table = models.BooleanField(default=False)

    embedding = VectorField(dimensions=EMBEDDING_DIM, null=True, blank=True)
    embedding_model = models.CharField(max_length=64, blank=True, default="")

    # --- denormalized pre-filter columns (mirror Document) ----------------
    doc_type = models.CharField(max_length=32, choices=DocType.CHOICES, db_index=True)
    model = models.CharField(max_length=128, blank=True, default="", db_index=True)
    model_year_start = models.IntegerField(null=True, blank=True)
    model_year_end = models.IntegerField(null=True, blank=True)
    system = models.CharField(
        max_length=32, choices=VehicleSystem.CHOICES,
        default=VehicleSystem.GENERAL, db_index=True,
    )
    tsb_number = models.CharField(max_length=64, blank=True, default="", db_index=True)
    access_level = models.CharField(
        max_length=16, choices=AccessLevel.CHOICES, default=AccessLevel.ADVISOR,
    )

    # --- retrieval aids ---------------------------------------------------
    symptom_keywords = ArrayField(
        models.CharField(max_length=64), default=list, blank=True,
        help_text="Advisor-phrasing symptom terms, e.g. 'shudder', 'cold start'.",
    )
    dtc_codes = ArrayField(
        models.CharField(max_length=16), default=list, blank=True,
        help_text="DTC codes mentioned in this chunk, for code -> narrative lookup.",
    )
    # Lexical (BM25-ish) half of hybrid search, as a Postgres GENERATED
    # column: Postgres recomputes it on every write, so no application code
    # path can leave it stale, and Django never includes it in an INSERT.
    # The weighting lives in the `rag_chunk_search_vector` SQL function
    # created by migration 0001 -- heading, TSB number, DTC codes and symptom
    # keywords at weight A, body text at weight B.
    search_vector = models.GeneratedField(
        expression=Func(
            F("heading_path"),
            F("content"),
            F("dtc_codes"),
            F("symptom_keywords"),
            F("tsb_number"),
            function="rag_chunk_search_vector",
            output_field=SearchVectorField(),
        ),
        output_field=SearchVectorField(),
        db_persist=True,
    )

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "rag_chunks"
        constraints = [
            models.UniqueConstraint(
                fields=["document", "ordinal"], name="uniq_chunk_doc_ordinal",
            ),
        ]
        indexes = [
            # The pre-filter path. Order matters: model is the most selective
            # column an advisor always supplies.
            models.Index(fields=["model", "doc_type", "system"], name="ix_chunk_prefilter"),
            models.Index(fields=["model", "model_year_start", "model_year_end"],
                         name="ix_chunk_model_years"),
            GinIndex(fields=["dtc_codes"], name="ix_chunk_dtc_codes"),
            GinIndex(fields=["symptom_keywords"], name="ix_chunk_symptoms"),
        ]

    def __str__(self) -> str:
        return f"{self.document_id}#{self.ordinal} {' > '.join(self.heading_path)}"

    @property
    def citation(self) -> str:
        """Mandatory citation string: doc name + section + TSB number."""
        parts = [self.document.title]
        if self.tsb_number:
            parts.append(f"TSB {self.tsb_number}")
        if self.heading_path:
            parts.append(" > ".join(self.heading_path))
        return " - ".join(parts)


class DTCCode(models.Model):
    """Diagnostic trouble codes as a plain lookup table.

    Explicitly NOT part of `chunks`. Advisors asking "what is P0299 on a
    Transit" want an exact row, not the nearest neighbour in embedding space.
    The only embedding here is on `description`, so that "check engine light
    for a misfire" can resolve to the P0300 series.
    """

    code = models.CharField(
        max_length=16, unique=True,
        help_text="Canonical uppercase code, e.g. 'P0299'.",
    )
    description = models.CharField(max_length=512)
    likely_causes = ArrayField(models.CharField(max_length=256), default=list, blank=True)
    severity = models.CharField(
        max_length=16, choices=Severity.CHOICES, default=Severity.MODERATE, db_index=True,
    )
    applicable_models = ArrayField(
        models.CharField(max_length=128), default=list, blank=True,
        help_text="Empty list = generic OBD-II code, applies to every model.",
    )
    applicable_year_start = models.IntegerField(null=True, blank=True)
    applicable_year_end = models.IntegerField(null=True, blank=True)
    system = models.CharField(
        max_length=32, choices=VehicleSystem.CHOICES,
        default=VehicleSystem.GENERAL, db_index=True,
    )
    is_generic = models.BooleanField(
        default=True, help_text="Generic OBD-II code vs. OEM-specific.",
    )
    advisor_guidance = models.TextField(
        blank=True, default="",
        help_text="Plain-language line an advisor can say to a customer.",
    )

    description_embedding = VectorField(dimensions=EMBEDDING_DIM, null=True, blank=True)
    embedding_model = models.CharField(max_length=64, blank=True, default="")

    source_document = models.ForeignKey(
        Document, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="dtc_codes",
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "rag_dtc_codes"
        indexes = [
            GinIndex(fields=["applicable_models"], name="ix_dtc_models"),
            models.Index(fields=["system", "severity"], name="ix_dtc_system_severity"),
        ]

    def __str__(self) -> str:
        return f"{self.code}: {self.description}"

    def applies_to(self, model: str | None, year: int | None) -> bool:
        if model and self.applicable_models:
            if model.lower() not in [m.lower() for m in self.applicable_models]:
                return False
        if year is not None:
            if self.applicable_year_start and year < self.applicable_year_start:
                return False
            if self.applicable_year_end and year > self.applicable_year_end:
                return False
        return True
