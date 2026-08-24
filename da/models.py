"""The entire relational schema — one document-model table (docs/DESIGN.md §7).

An analysis is edited and saved as a unit; the bracket tree lives in the
``document`` JSONField (shape per §3, validated by :func:`da.documents.
validate_document` on every write). ``owner`` stays null in v1's single-user
local mode; auth switches on at first real deployment.

Deleting is SOFT: ``deleted_at`` is stamped and the row drops out of the
listing into Recently Deleted, where it can be restored until it ages past
:data:`TRASH_DAYS` and is purged for good.
"""

from datetime import timedelta

from django.conf import settings
from django.db import models
from django.utils import timezone

#: How long a deleted analysis stays restorable.
TRASH_DAYS = 30


class Analysis(models.Model):
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="analyses",
    )
    title = models.CharField(max_length=200)
    passage_ref = models.CharField(max_length=100, blank=True)  # set by alignment
    schema_version = models.PositiveSmallIntegerField(default=1)
    document = models.JSONField()
    #: Exegetical comments on the analysis as a whole — free text, never parsed.
    notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    #: Set when the analysis is deleted; null for a live one.
    deleted_at = models.DateTimeField(null=True, blank=True, default=None)

    class Meta:
        ordering = ["-updated_at"]
        verbose_name_plural = "analyses"

    def __str__(self) -> str:
        return f"{self.title} ({self.passage_ref})" if self.passage_ref else self.title

    @property
    def purge_at(self):
        """When this deleted analysis is purged; None while it is live."""
        return None if self.deleted_at is None else self.deleted_at + timedelta(days=TRASH_DAYS)

    @property
    def days_left(self) -> int:
        """Whole days before purge, floored at 0. Meaningless while live."""
        if self.deleted_at is None:
            return 0
        remaining = self.purge_at - timezone.now()
        return max(0, remaining.days + (1 if remaining.seconds else 0))


def purge_expired() -> int:
    """Delete for real every analysis whose Recently Deleted window has run
    out. Called whenever the trash is listed — no scheduler needed for a
    single-user app. Returns how many rows went."""
    cutoff = timezone.now() - timedelta(days=TRASH_DAYS)
    count, _ = Analysis.objects.filter(deleted_at__isnull=False, deleted_at__lt=cutoff).delete()
    return count
