"""The entire relational schema — one document-model table (docs/DESIGN.md §7).

An analysis is edited and saved as a unit; the bracket tree lives in the
``document`` JSONField (shape per §3, validated by :func:`da.documents.
validate_document` on every write). ``owner`` stays null in v1's single-user
local mode; auth switches on at first real deployment.
"""

from django.conf import settings
from django.db import models


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
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]
        verbose_name_plural = "analyses"

    def __str__(self) -> str:
        return f"{self.title} ({self.passage_ref})" if self.passage_ref else self.title
