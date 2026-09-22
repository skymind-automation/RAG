from django.contrib import admin

from knowledge.models import Chunk, DTCCode, Document


@admin.register(Document)
class DocumentAdmin(admin.ModelAdmin):
    list_display = ("title", "doc_type", "model", "year_label", "system",
                    "tsb_number", "is_synthetic", "ingested_at")
    list_filter = ("doc_type", "model", "system", "is_synthetic", "access_level")
    search_fields = ("title", "source_file", "tsb_number")


@admin.register(Chunk)
class ChunkAdmin(admin.ModelAdmin):
    list_display = ("id", "document", "ordinal", "model", "system", "doc_type",
                    "content_chars", "contains_table")
    list_filter = ("doc_type", "model", "system", "contains_table")
    search_fields = ("content",)
    raw_id_fields = ("document",)


@admin.register(DTCCode)
class DTCCodeAdmin(admin.ModelAdmin):
    list_display = ("code", "description", "severity", "system", "is_generic")
    list_filter = ("severity", "system", "is_generic")
    search_fields = ("code", "description")
