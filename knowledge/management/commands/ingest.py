"""Ingest a corpus into the knowledge base.

    manage.py ingest                        # ingest settings.RAG_DATA_DIR
    manage.py ingest --path data/tsbs       # one directory or one file
    manage.py ingest --dry-run              # parse and report, write nothing
    manage.py ingest --force                # re-ingest unchanged documents
    manage.py ingest --reembed              # re-embed rows from an older model

`--dry-run` is the chunk-quality loop: it prints what each file would produce
without touching the database, which is how you look at chunking before you
build retrieval logic on top of it.
"""
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from knowledge.ingestion.embeddings import get_embedding_backend
from knowledge.ingestion.pipeline import ingest_path, reembed_stale


class Command(BaseCommand):
    help = "Parse, chunk, embed and store manuals, TSBs and DTC tables."

    def add_arguments(self, parser):
        parser.add_argument("--path", default=None,
                            help="File or directory to ingest (default: RAG_DATA_DIR).")
        parser.add_argument("--dry-run", action="store_true",
                            help="Parse and report without writing.")
        parser.add_argument("--force", action="store_true",
                            help="Re-ingest documents whose content hash is unchanged.")
        parser.add_argument("--reembed", action="store_true",
                            help="Re-embed rows whose vectors predate the current model.")

    def handle(self, *args, **options):
        backend = get_embedding_backend()
        self.stdout.write(
            f"Embedding backend: {backend.name} / {backend.model} ({backend.dim}d)"
        )
        if backend.name == "hashing":
            self.stdout.write(self.style.WARNING(
                "  This is the deterministic offline backend. Dense recall "
                "measured against it is a floor, not a production forecast."
            ))

        if options["reembed"]:
            count = reembed_stale()
            self.stdout.write(self.style.SUCCESS(f"Re-embedded {count} row(s)."))
            return

        root = Path(options["path"]) if options["path"] else Path(settings.RAG_DATA_DIR)
        if not root.exists():
            raise CommandError(f"path does not exist: {root}")

        stats = ingest_path(root, force=options["force"], dry_run=options["dry_run"])

        prefix = "[dry-run] " if options["dry_run"] else ""
        self.stdout.write("")
        self.stdout.write(f"{prefix}documents created   {stats.documents_created}")
        self.stdout.write(f"{prefix}documents updated   {stats.documents_updated}")
        self.stdout.write(f"{prefix}documents skipped   {stats.documents_skipped}")
        self.stdout.write(f"{prefix}chunks written      {stats.chunks_written}")
        self.stdout.write(f"{prefix}DTC rows written    {stats.dtc_rows_written}")
        self.stdout.write(f"{prefix}embeddings computed {stats.embeddings_computed}")

        if stats.errors:
            self.stdout.write("")
            for error in stats.errors:
                self.stdout.write(self.style.ERROR(f"  {error}"))
            # Nonzero exit: a corpus that half-ingested is not a success, and a
            # scheduled re-index needs to fail loudly rather than drift.
            raise CommandError(f"{len(stats.errors)} file(s) failed to ingest")

        self.stdout.write(self.style.SUCCESS(f"{prefix}Ingest complete."))
