"""Score retrieval against the golden Q&A set.

    manage.py eval_retrieval
    manage.py eval_retrieval --k 5 --verbose
    manage.py eval_retrieval --shape bulletin
    manage.py eval_retrieval --json eval/results/baseline.json

Run this before touching a prompt. If retrieval precision and recall are not
where they need to be, no amount of prompt work will fix the answer — and
worse, prompt changes will appear to help by accident and then stop helping.
"""
import json
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from knowledge.evaluation import aggregate, by_shape, load_cases, run_case
from knowledge.ingestion.embeddings import get_embedding_backend
from knowledge.models import Chunk, Document
from knowledge.retrieval.service import RetrievalService

DEFAULT_SET = Path("eval/golden_qa.yaml")


class Command(BaseCommand):
    help = "Evaluate retrieval against the golden advisor Q&A set."

    def add_arguments(self, parser):
        parser.add_argument("--set", default=str(DEFAULT_SET),
                            help="Path to the golden Q&A YAML file.")
        parser.add_argument("--k", type=int, default=None,
                            help="Cutoff for hit/recall/precision (default RAG_TOP_K).")
        parser.add_argument("--shape", default=None,
                            help="Only run cases of this shape.")
        parser.add_argument("--verbose", action="store_true",
                            help="Print what each case retrieved.")
        parser.add_argument("--json", dest="json_path", default=None,
                            help="Also write the full report as JSON.")
        parser.add_argument("--fail-under", type=float, default=None,
                            help="Exit nonzero if hit rate falls below this.")

    def handle(self, *args, **options):
        path = Path(options["set"])
        if not path.exists():
            raise CommandError(f"golden set not found: {path}")

        top_k = options["k"] or settings.RAG_TOP_K
        cases, meta = load_cases(path)
        if options["shape"]:
            cases = [c for c in cases if c.get("shape") == options["shape"]]
        if not cases:
            raise CommandError("no cases to run")

        if not Chunk.objects.exists():
            raise CommandError(
                "the knowledge base is empty — run `manage.py ingest` first"
            )

        backend = get_embedding_backend()
        service = RetrievalService()

        self.stdout.write(self.style.MIGRATE_HEADING(
            f"\nGolden set: {path}  ({len(cases)} cases, k={top_k})"
        ))
        self.stdout.write(
            f"Embedding: {backend.name}/{backend.model} ({backend.dim}d)  |  "
            f"Reranker: {service.reranker.name}  |  "
            f"Corpus: {Document.objects.count()} docs / {Chunk.objects.count()} chunks"
        )
        synthetic = Document.objects.filter(is_synthetic=True).count()
        if synthetic:
            self.stdout.write(self.style.WARNING(
                f"{synthetic} of {Document.objects.count()} documents are synthetic "
                "samples. These numbers describe the harness, not production."
            ))

        results = [run_case(service, case, top_k) for case in cases]

        # --- per case -----------------------------------------------------
        self.stdout.write("")
        for result in results:
            mark = self.style.SUCCESS("PASS") if result.passed else self.style.ERROR("FAIL")
            rank = result.first_relevant_rank
            self.stdout.write(
                f"  {mark}  {result.case_id:<34} {result.shape:<13} "
                f"route={result.route:<10} "
                f"rank={rank if rank else '-':<4} "
                f"rr={result.reciprocal_rank:.3f}  {result.took_ms:>4}ms"
            )
            for failure in result.failures:
                self.stdout.write(self.style.ERROR(f"         ! {failure}"))
            if options["verbose"]:
                self.stdout.write(f"         q: {result.question}")
                for line in result.retrieved:
                    self.stdout.write(f"           - {line}")

        # --- aggregates ----------------------------------------------------
        overall = aggregate(results)
        shapes = by_shape(results)

        self.stdout.write(self.style.MIGRATE_HEADING("\nBy query shape"))
        self.stdout.write(
            f"  {'shape':<14}{'cases':>6}{'pass':>6}{'hit@k':>9}"
            f"{'MRR':>8}{'recall':>9}{'prec':>8}"
        )
        for shape, stats in shapes.items():
            self.stdout.write(
                f"  {shape:<14}{stats['cases']:>6}{stats['passed']:>6}"
                f"{stats['hit_rate']:>9.3f}{stats['mrr']:>8.3f}"
                f"{stats['recall_at_k']:>9.3f}{stats['precision_at_k']:>8.3f}"
            )

        self.stdout.write(self.style.MIGRATE_HEADING("\nOverall"))
        self.stdout.write(f"  cases            {overall['cases']}")
        self.stdout.write(f"  passed           {overall['passed']}")
        self.stdout.write(f"  failed           {overall['failed']}")
        self.stdout.write(f"  hit@{top_k}           {overall['hit_rate']:.3f}")
        self.stdout.write(f"  MRR              {overall['mrr']:.3f}")
        self.stdout.write(f"  recall@{top_k}        {overall['recall_at_k']:.3f}")
        self.stdout.write(f"  precision@{top_k}     {overall['precision_at_k']:.3f}")
        self.stdout.write(f"  latency median   {overall['median_latency_ms']:.0f}ms")
        self.stdout.write(f"  latency p95      {overall['p95_latency_ms']:.0f}ms")
        self.stdout.write(
            "\n  (hit/MRR/recall/precision exclude applicability and negative "
            "cases,\n   which assert behaviour rather than ranking.)"
        )

        if options["json_path"]:
            out = Path(options["json_path"])
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(json.dumps(
                {
                    "set": str(path),
                    "meta": meta,
                    "k": top_k,
                    "embedding_backend": backend.name,
                    "embedding_model": backend.model,
                    "reranker": service.reranker.name,
                    "corpus": {
                        "documents": Document.objects.count(),
                        "chunks": Chunk.objects.count(),
                        "synthetic_documents": synthetic,
                    },
                    "overall": overall,
                    "by_shape": shapes,
                    "cases": [r.as_dict() for r in results],
                },
                indent=2,
            ))
            self.stdout.write(f"\n  wrote {out}")

        if options["fail_under"] is not None and overall["hit_rate"] < options["fail_under"]:
            raise CommandError(
                f"hit rate {overall['hit_rate']:.3f} is below the "
                f"--fail-under threshold of {options['fail_under']}"
            )
        if overall["failed"]:
            raise CommandError(f"{overall['failed']} case(s) failed")

        self.stdout.write(self.style.SUCCESS("\nAll cases passed."))
