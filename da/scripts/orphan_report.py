"""Name every analysis that has no owner, before anyone is given them.

    uv run python da/scripts/orphan_report.py

The read-only half of docs/accounts-spec.md §7, in the pattern
``check_binary.py`` set: this script NAMES the rows, and moving them is the
other half — ``manage.py assign_orphans --to <email>``, a separate,
human-approved step. The analyst decides who inherits the 43 analyses made in
single-user local mode; this script decides nothing.

IT IS READ-ONLY, deliberately and by construction: it opens no transaction and
touches no ``save``/``delete``/``update``. Owned analyses are counted per
account at the end, so it doubles as "who has what" after an assignment.

The EXIT CODE carries the verdict: 0 when every analysis has an owner, 1 while
any is still orphaned — so a shell loop or a deployment check can ask "is the
migration finished?" without parsing the table.
"""

import os
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(BASE_DIR))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django  # noqa: E402

django.setup()

from django.contrib.auth import get_user_model  # noqa: E402
from django.db.models import Count  # noqa: E402

from da.models import Analysis  # noqa: E402

COLUMNS = (("id", 6), ("title", 40), ("passage", 18), ("state", 8))


def _row(cells: tuple[str, ...]) -> str:
    """One table line: fixed-width columns, then the date, untruncated."""
    head = "  ".join(
        text[: width - 1] + "…" if len(text) > width else text.ljust(width)
        for text, (_, width) in zip(cells, COLUMNS)
    )
    return f"{head}  {cells[len(COLUMNS)]}".rstrip()


def report() -> int:
    """Print the table; return the number of ownerless analyses."""
    orphans = Analysis.objects.filter(owner__isnull=True).order_by("id")
    total = Analysis.objects.count()

    print(_row(tuple(name for name, _ in COLUMNS) + ("updated",)))
    print("-" * 78)

    count = 0
    for analysis in orphans.iterator():
        count += 1
        state = "trashed" if analysis.deleted_at is not None else "live"
        print(_row((
            str(analysis.id),
            analysis.title,
            analysis.passage_ref or "—",
            state,
            f"{analysis.updated_at:%Y-%m-%d}",
        )))

    print()
    if total == 0:
        print("no stored analyses in this database")
        return 0
    print(f"{total} analyses: {total - count} owned, {count} ownerless")

    owners = (
        get_user_model()
        .objects.annotate(n=Count("analyses"))
        .filter(n__gt=0)
        .order_by("-n", "username")
    )
    for owner in owners:
        print(f"  {owner.username}: {owner.n}")
    if count:
        print()
        print("These are visible only to site staff, through the Django admin. "
              "To hand them over — a separate, human-approved step; this script "
              "changed nothing:")
        print("  uv run python manage.py assign_orphans --to <email>")
    return count


if __name__ == "__main__":
    # The verdict, not just the table: 1 while any analysis is still ownerless.
    sys.exit(1 if report() else 0)
