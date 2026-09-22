"""Print the chunks a file would produce, without writing anything.

This is the tool for the "see actual chunking quality before building
retrieval logic around it" step. Reading twenty chunks out of a real manual
tells you more about whether the chunker works than any metric does.

    manage.py inspect_chunks data/manuals/transit-brakes-2021-2024.md
    manage.py inspect_chunks data/tsbs --preview 400
"""
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from knowledge.ingestion.parsers import ParseError, parse_file
from knowledge.ingestion.pipeline import discover


class Command(BaseCommand):
    help = "Show how a source file chunks, without writing to the database."

    def add_arguments(self, parser):
        parser.add_argument("path")
        parser.add_argument("--preview", type=int, default=240,
                            help="Characters of each chunk body to print.")
        parser.add_argument("--full", action="store_true",
                            help="Print whole chunk bodies.")

    def handle(self, *args, **options):
        root = Path(options["path"])
        if not root.exists():
            raise CommandError(f"path does not exist: {root}")

        for path in discover(root):
            self.stdout.write(self.style.MIGRATE_HEADING(f"\n=== {path}"))
            try:
                parsed = parse_file(path)
            except (ParseError, ValueError) as exc:
                self.stdout.write(self.style.ERROR(f"  parse failed: {exc}"))
                continue

            if isinstance(parsed, list):
                self.stdout.write(f"  DTC table: {len(parsed)} row(s)")
                for row in parsed[:5]:
                    self.stdout.write(
                        f"    {row.code}  {row.description}  "
                        f"[{row.severity}/{row.system}] "
                        f"causes={len(row.likely_causes)}"
                    )
                if len(parsed) > 5:
                    self.stdout.write(f"    ... {len(parsed) - 5} more")
                continue

            meta = parsed.meta
            self.stdout.write(
                f"  {meta.doc_type} | model={meta.model or '(none)'} "
                f"| years={meta.model_year_start}-{meta.model_year_end} "
                f"| system={meta.system}"
                + (f" | TSB {meta.tsb_number}" if meta.tsb_number else "")
            )
            sizes = [len(c.content) for c in parsed.chunks]
            self.stdout.write(
                f"  {len(parsed.chunks)} chunk(s), "
                f"chars min={min(sizes)} median={sorted(sizes)[len(sizes)//2]} "
                f"max={max(sizes)}, "
                f"{sum(1 for c in parsed.chunks if c.contains_table)} with tables"
            )

            for index, chunk in enumerate(parsed.chunks):
                self.stdout.write("")
                self.stdout.write(self.style.HTTP_INFO(
                    f"  [{index}] {' > '.join(chunk.heading_path) or '(no heading)'}"
                ))
                flags = []
                if chunk.contains_table:
                    flags.append("table")
                if chunk.dtc_codes:
                    flags.append("dtc=" + ",".join(chunk.dtc_codes))
                if chunk.symptom_keywords:
                    flags.append("symptoms=" + ",".join(chunk.symptom_keywords[:5]))
                self.stdout.write(
                    f"      {len(chunk.content)} chars | system={chunk.system}"
                    + (f" | {' | '.join(flags)}" if flags else "")
                )
                body = chunk.content if options["full"] else (
                    chunk.content[: options["preview"]]
                    + ("..." if len(chunk.content) > options["preview"] else "")
                )
                for line in body.splitlines():
                    self.stdout.write(f"      | {line}")
