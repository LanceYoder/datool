"""Give every ownerless analysis to one account (docs/accounts-spec.md §7).

    uv run python manage.py assign_orphans --to lance@example.com
    uv run python manage.py assign_orphans --to lance@example.com --dry-run

The 43 analyses made in single-user local mode have ``owner = NULL``. Once the
analyst has an account, this hands them over in one move. Report FIRST with
``da/scripts/orphan_report.py`` (or ``--dry-run``): the assignment is one
statement and there is no undo but a second run at a different account.

Trashed orphans are taken too, deliberately — they are the analyst's rows as
much as the live ones, and one of them may be the row they mean to restore.
"""

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from da.models import Analysis


class Command(BaseCommand):
    help = "Assign every ownerless analysis to the account with the given email."

    def add_arguments(self, parser):
        parser.add_argument(
            "--to",
            required=True,
            metavar="EMAIL",
            help="the email of the account that is to own them",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="report what would move and change nothing",
        )

    def handle(self, *args, **options):
        user = self._find(options["to"])
        orphans = Analysis.objects.filter(owner__isnull=True)
        live = orphans.filter(deleted_at__isnull=True).count()
        trashed = orphans.filter(deleted_at__isnull=False).count()
        total = live + trashed

        if total == 0:
            self.stdout.write("no ownerless analyses — nothing to do")
            return
        summary = f"{total} ownerless analyses ({live} live, {trashed} trashed)"
        if options["dry_run"]:
            self.stdout.write(f"would give {summary} to {user.username}")
            return

        moved = orphans.update(owner=user)
        self.stdout.write(
            self.style.SUCCESS(f"gave {moved} analyses ({live} live, {trashed} trashed) "
                               f"to {user.username}")
        )

    def _find(self, email: str):
        User = get_user_model()
        matches = list(User.objects.filter(email__iexact=email.strip()))
        if not matches:
            raise CommandError(f"no account with the email {email!r}")
        if len(matches) > 1:
            names = ", ".join(u.username for u in matches)
            raise CommandError(
                f"{email!r} matches more than one account ({names}) — fix that "
                "in the Django admin first"
            )
        return matches[0]
