"""Read every stored analysis and report it against the TIGHTENED validator.

    uv run python da/scripts/check_binary.py

Run this before the one-time cleanup the analyst ruled for (docs/tree-engine-
spec.md §9, Q2: documents that violate the model are DELETABLE, and there is
no binarization path back). The validator now demands strictly binary
brackets — exactly two children, always — where it used to accept ">= 2", so
an analysis saved by the old editor may hold a three-way bracket the app can
no longer open. This script names those rows.

IT IS READ-ONLY, deliberately and by construction: it opens no transaction,
touches no ``save``/``delete``/``update``, and reports rows in a table for a
human to act on. So it is HALF of §7.6's third clause: this half names the
rows, and deleting them is the other half — a separate, human-approved step.
The analyst decides which non-conforming analyses go, not this script.

Soft-deleted rows (in Recently Deleted, see :data:`da.models.TRASH_DAYS`) are
listed too, marked ``trashed``: they are still stored, and one of them may be
the row someone means to restore. A trashed row also needs no manual delete —
:func:`da.models.purge_expired` removes it once it is past ``TRASH_DAYS``, so
a failing row that is already trashed resolves itself on that clock.

The EXIT CODE carries the verdict: 0 when every stored analysis validates,
1 when any does not, so a shell loop or a CI step can ask "did anything fail?"
without parsing the table.
"""

import os
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(BASE_DIR))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django  # noqa: E402

django.setup()

from da.corpus import load_words  # noqa: E402
from da.documents import DocumentError, validate_document  # noqa: E402
from da.models import Analysis  # noqa: E402

#: The problem text the tightened bracket rule produces. Reported separately
#: because it is the ONE failure this pass introduced: everything else on the
#: list was already invalid before today.
BINARY_PROBLEM = "must be a list of exactly 2 nodes"

COLUMNS = (("id", 6), ("title", 40), ("state", 8), ("verdict", 8))


def _row(cells: tuple[str, ...]) -> str:
    """One table line: fixed-width columns, then the first error, untruncated
    (an error is the reason to run this at all — it does not get clipped)."""
    head = "  ".join(
        text[: width - 1] + "…" if len(text) > width else text.ljust(width)
        for text, (_, width) in zip(cells, COLUMNS)
    )
    return f"{head}  {cells[len(COLUMNS)]}".rstrip()


def check() -> int:
    """Print the table; return the number of invalid analyses."""
    corpus_size = len(load_words())
    analyses = Analysis.objects.order_by("id")

    print(_row(tuple(name for name, _ in COLUMNS) + ("first error",)))
    print("-" * 78)

    invalid: list[tuple[int, str]] = []
    binary_failures: list[int] = []
    self_clearing: list[str] = []
    total = 0
    for analysis in analyses.iterator():
        total += 1
        state = "trashed" if analysis.deleted_at is not None else "live"
        try:
            validate_document(analysis.document, corpus_size=corpus_size)
        except DocumentError as err:
            first = err.problems[0] if err.problems else "(no problem reported)"
            invalid.append((analysis.id, first))
            if any(BINARY_PROBLEM in p for p in err.problems):
                binary_failures.append(analysis.id)
            if analysis.deleted_at is not None:
                # Already in the trash: purge_expired() takes it on its own.
                self_clearing.append(
                    f"{analysis.id} (purges {analysis.purge_at:%Y-%m-%d})"
                )
            verdict = "INVALID"
        else:
            first = ""
            verdict = "valid"
        print(_row((str(analysis.id), analysis.title, state, verdict, first)))

    print()
    if total == 0:
        print("no stored analyses in this database")
        return 0
    print(f"{total} analyses: {total - len(invalid)} valid, {len(invalid)} invalid")
    if binary_failures:
        print(f"non-binary brackets in: {binary_failures}")
        print("These cannot be opened by the rebuilt editor. Deleting them is "
              "the ruled remedy (spec §9, Q2) — a separate, human-approved step; "
              "this script changed nothing.")
    elif invalid:
        print("None of the failures is the binary rule: these documents were "
              "already invalid before the tightening.")
    if self_clearing:
        print(f"already trashed, no manual delete needed: {', '.join(self_clearing)}")
    return len(invalid)


if __name__ == "__main__":
    # The verdict, not just the table: 1 if any stored analysis is invalid.
    sys.exit(1 if check() else 0)
