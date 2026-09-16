"""The relational schema: analyses, and who they belong to.

An analysis is edited and saved as a unit; the bracket tree lives in the
``document`` JSONField (shape per docs/DESIGN.md §3, validated by
:func:`da.documents.validate_document` on every write).

Accounts came second (docs/accounts-spec.md). ``owner`` is set on every
analysis made from now on, but stays NULLABLE at the database level: the rows
made in single-user local mode keep loading for site staff until
``assign_orphans`` gives them away (§7).

:class:`Organization` / :class:`Membership` / :class:`TeachingPolicy` carry the
classroom: an org has members with a role, a student membership points at its
professor's membership, and a professor has one default policy plus an
optional override per student. Resolving those two into the rules actually in
force is :func:`da.policies.effective_policy` — never re-derived here.

Deleting is SOFT: ``deleted_at`` is stamped and the row drops out of the
listing into Recently Deleted, where it can be restored until it ages past
:data:`TRASH_DAYS` and is purged for good.
"""

from datetime import timedelta

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone
from django.utils.text import slugify

from .policies import default_policy

#: How long a deleted analysis stays restorable.
TRASH_DAYS = 30


class Organization(models.Model):
    """A school, class group or institution. Set up by site staff at the
    school's request, together with its first admin account — ``manage.py
    create_org`` or the Django admin; there is no self-serve creation (§2,
    ruled 2026-09-12). ``created_by`` is the staff account that did it, when
    one was signed in (the command leaves it empty)."""

    name = models.CharField(max_length=200)
    slug = models.SlugField(max_length=120, unique=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="organizations_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name

    @staticmethod
    def unique_slug(name: str) -> str:
        """A URL-safe slug for ``name``, suffixed until it is free."""
        base = slugify(name)[:100] or "org"
        slug, n = base, 2
        while Organization.objects.filter(slug=slug).exists():
            suffix = f"-{n}"
            slug = f"{base[:120 - len(suffix)]}{suffix}"
            n += 1
        return slug


class Membership(models.Model):
    """One user's place in one organization: their role, and — for a student —
    which professor they learn under and what that professor changed for them.

    ``policy_override`` is PARTIAL by design: only the keys the professor
    pinned for this student, so the UI can show "uses your default" for the
    rest (§4).

    Two fields beyond §4's list carry the CONSENT boundary, which the spec's
    "individuals may later be added to an org" (§2) leaves open:

    * ``accepted_at`` — when the person agreed to this membership. An account
      the organization created has nothing to agree to and is accepted the
      moment it is made; an address that ALREADY belongs to somebody gets a
      PENDING row (``accepted_at`` null) that confers nothing at all until
      they accept it. Without this an admin could pull a stranger's account
      into their classroom and impose a policy on it.
    * ``provisioned`` — this organization created the account. Only such an
      account may be sent a password-reset link by an admin or professor,
      and only such an account is locked out when its membership is
      deactivated: an individual who merely joined keeps their own account.
    """

    ADMIN = "admin"
    PROFESSOR = "professor"
    STUDENT = "student"
    ROLE_CHOICES = [
        (ADMIN, "Admin"),
        (PROFESSOR, "Professor"),
        (STUDENT, "Student"),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="memberships"
    )
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, related_name="memberships"
    )
    role = models.CharField(max_length=20, choices=ROLE_CHOICES)
    #: The professor's MEMBERSHIP (never a bare user): students only, same org.
    professor = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="students",
    )
    active = models.BooleanField(default=True)
    #: Partial policy JSON (§5) or null — "uses the professor's default".
    policy_override = models.JSONField(null=True, blank=True, default=None)
    #: When the member agreed to belong here; null while the invitation is
    #: still PENDING. Defaults to "now" so every membership made in code (a
    #: provisioned account, the creator's own admin row) is accepted outright
    #: — only an invitation to an existing account sets it to None.
    accepted_at = models.DateTimeField(null=True, blank=True, default=timezone.now)
    #: True when this organization CREATED the account behind this membership.
    provisioned = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["organization_id", "role", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "organization"], name="one_membership_per_org"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.user} — {self.role} in {self.organization}"

    def clean(self):
        """The professor link's three rules, for the admin and any code that
        calls full_clean(); the API checks the same things itself so it can
        answer with the project's ``{"errors": [...]}`` shape."""
        if self.professor_id is None:
            return
        if self.role != self.STUDENT:
            raise ValidationError({"professor": "only a student has a professor"})
        if self.professor_id == self.id:
            raise ValidationError({"professor": "a membership cannot teach itself"})
        professor = self.professor
        if professor.role != self.PROFESSOR:
            raise ValidationError({"professor": "that member is not a professor"})
        if professor.organization_id != self.organization_id:
            raise ValidationError(
                {"professor": "the professor must be in the same organization"}
            )

    @property
    def display_name(self) -> str:
        """What to show for the member: their name, else their login."""
        user = self.user
        full = (user.get_full_name() or "").strip()
        return full or user.username

    @property
    def pending(self) -> bool:
        """An invitation the person has not accepted yet: the row exists, and
        it grants NOTHING — no role, no policy, no reading of their work."""
        return self.accepted_at is None


class TeachingPolicy(models.Model):
    """One professor's DEFAULT rules for all their students (§4). Per-student
    changes live on ``Membership.policy_override``, not here."""

    professor_membership = models.OneToOneField(
        Membership, on_delete=models.CASCADE, related_name="teaching_policy"
    )
    policy = models.JSONField(default=default_policy)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = "teaching policies"

    def __str__(self) -> str:
        return f"policy of {self.professor_membership}"


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
    #: Which first pass the analysis started from ('none'/'minimal'/'full'),
    #: empty for the rows made before tiers existed.
    first_pass_tier = models.CharField(max_length=10, blank=True, default="")
    #: The effective policy at creation — the audit trail §5 asks for, so a
    #: later version can diff gestures against the rules that were in force.
    policy_snapshot = models.JSONField(null=True, blank=True, default=None)

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
