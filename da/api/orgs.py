"""Organizations, membership, provisioning and policies (§2, §4, §5, §6).

An organization itself is never made here. Schools reach out, and site staff
set the org and its first admin up for them (``manage.py create_org``, or the
Django admin) — §2, ruled 2026-09-12. Everything below starts from a
membership that already exists.

Who may do what, in one place so it can be read at a glance:

* **admin** — sees every member, provisions accounts of any role, assigns
  students to professors, deactivates people. Reads NO analyses.
* **professor** — sees themselves and their own students, provisions students
  assigned to themselves, sends those students a password-reset link, sets the
  default policy and per-student overrides, and opens a student's analyses
  read-only.
* **student** — none of this; their editor is what the policy says.

Every handler gets ``self.membership`` — the CALLER's membership in this
organization — from the permission class (da/api/permissions.py).
"""

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from ..models import Analysis, Membership, TeachingPolicy
from ..policies import PolicyError, default_policy, policy_for_membership, validate_policy
from ..serializers import AnalysisListSerializer
from .auth import body, clean_email, email_taken, errors, set_name
from .mail import reset_link, send_invitation, send_org_invitation, send_password_reset
from .permissions import (
    IsOrgAdmin,
    IsOrgAdminOrProfessor,
    IsOrgProfessor,
    may_read_work,
    teaches,
)
from .shapes import me_json, member_json, membership_json
from .throttles import InvitationThrottle, InvitationTargetThrottle

User = get_user_model()

ROLES = (Membership.ADMIN, Membership.PROFESSOR, Membership.STUDENT)

#: The columns an address lands in. SQLite ignores a varchar limit and
#: PostgreSQL — what production runs (config/settings.py) — raises DataError,
#: so a value that fits neither database must be refused HERE, in the project's
#: error shape, rather than 500 in one deployment and corrupt the other.
from .auth import ADDRESS_MAX  # one definition, shared with register

class MyOrgsView(APIView):
    """``GET /api/orgs/mine`` — the caller's memberships, same shape as the
    ``memberships`` array of ``auth/me``."""

    def get(self, request):
        memberships = (
            Membership.objects.filter(
                user=request.user, active=True, accepted_at__isnull=False
            )
            .select_related("organization", "professor", "professor__user")
            .order_by("organization__name", "id")
        )
        return Response([membership_json(m) for m in memberships])


class MembersView(APIView):
    """``GET|POST /api/orgs/<org_id>/members`` — the roster, and provisioning."""

    permission_classes = [IsOrgAdminOrProfessor]

    def get_throttles(self):
        """Only the requests that SEND MAIL are rated (da/api/throttles.py):
        every POST here does, and reading the roster never does."""
        if self.request.method == "POST":
            return [InvitationThrottle(), InvitationTargetThrottle()]
        return super().get_throttles()

    def get(self, request, org_id: int):
        rows = Membership.objects.filter(organization_id=org_id).select_related(
            "user", "professor", "professor__user"
        )
        if self.membership.role == Membership.PROFESSOR:
            # A professor sees their own students and themselves — not the
            # rest of the faculty, and not another professor's class.
            rows = rows.filter(pk__in=self._visible_ids(rows))
        return Response(
            [member_json(m) for m in rows.order_by("role", "user__username")]
        )

    def _visible_ids(self, rows) -> list[int]:
        return [
            m.id
            for m in rows
            if m.id == self.membership.id or m.professor_id == self.membership.id
        ]

    def post(self, request, org_id: int):
        """``{role, email, name?, professor?}`` — one way to add somebody, by
        email (ruled 2026-09-16).

        Two quite different things wear this one request:

        * a NEW account, which this organization creates and owns — the
          invitation carries a set-password link, and the membership is live
          at once, because there is nobody yet to ask;
        * an address that ALREADY has an account, which is how an individual
          joins an org (§2). That account is not ours to enrol. The row we
          make is a PENDING INVITATION: it holds no role, imposes no policy
          and opens no analysis until its holder signs in as themselves and
          accepts it. Their name and their user id are withheld from the
          answer until they do — a stranger's roster must not be a place to
          look people up.
        """
        payload = body(request)
        caller = self.membership
        role = payload.get("role")
        if role not in ROLES:
            return errors([f"role must be one of {', '.join(ROLES)}"])
        if caller.role == Membership.PROFESSOR and role != Membership.STUDENT:
            return errors(
                ["a professor may only create students"], status.HTTP_403_FORBIDDEN
            )

        name = payload.get("name")
        if name is not None and not isinstance(name, str):
            return errors(["name must be a string"])

        raw_email = payload.get("email")
        if not isinstance(raw_email, str) or not raw_email.strip():
            return errors(["an email is required"])
        try:
            email = clean_email(raw_email)
        except ValidationError:
            return errors(["that does not look like an email address"])
        if len(email) > ADDRESS_MAX:
            return errors([f"an email address may be at most {ADDRESS_MAX} characters"])

        professor, problem = self._professor_for(role, payload, caller)
        if problem:
            return errors([problem])

        # WHAT THIS ENDPOINT ANSWERS: the same three keys whether the address
        # already had an account or not. The roster (GET) does distinguish a
        # pending invitation from a provisioned account — the teaching page
        # genuinely needs to — so an org admin can still learn, a page-load
        # later, that an address was already known; the throttles (40
        # invitations a day per caller and per target) are what keep that
        # from being a lookup service. The POST body itself gives nothing away.
        def invited(membership, link=None):
            return Response(
                {"invited": True, "membershipId": membership.id, "inviteLink": link},
                status=status.HTTP_201_CREATED,
            )

        existing = User.objects.filter(email__iexact=email).first()
        if existing is not None:
            if Membership.objects.filter(
                user=existing, organization_id=org_id
            ).exists():
                return errors(["that person is already a member of this organization"])
            membership = Membership.objects.create(
                user=existing,
                organization_id=org_id,
                role=role,
                professor=professor,
                accepted_at=None,  # PENDING: theirs to accept, not ours to take
                provisioned=False,
            )
            send_org_invitation(
                existing, organization_name=membership.organization.name
            )
            return invited(membership)

        if email_taken(email):
            return errors(["an account with that email already exists"])
        user = User(username=email.lower(), email=email)
        set_name(user, name)
        # No password yet: the invitation link is how they set one.
        user.set_unusable_password()
        user.save()

        membership = Membership.objects.create(
            user=user,
            organization_id=org_id,
            role=role,
            professor=professor,
            provisioned=True,
        )
        link = reset_link(user)
        sent = send_invitation(user, link, organization_name=membership.organization.name)
        if sent:
            link = None  # it is in their inbox; the admin needs nothing
        return invited(membership, link)

    def _professor_for(self, role, payload, caller):
        """The professor membership a new student is assigned to, or None."""
        if caller.role == Membership.PROFESSOR:
            # A professor's students are their own, whatever the body says.
            return caller, None
        raw = payload.get("professor")
        if raw is None:
            return None, None
        if role != Membership.STUDENT:
            return None, "only a student has a professor"
        professor = Membership.objects.filter(
            pk=raw, organization_id=caller.organization_id, role=Membership.PROFESSOR
        ).first()
        if professor is None:
            return None, "that professor is not a professor in this organization"
        return professor, None


class MemberDetailView(APIView):
    """``PATCH /api/orgs/<org_id>/members/<mid> {role?, professor?, active?}``
    — the admin's three levers: promote, assign, deactivate.

    Two invariants hold whatever the body says:

    * an organization is never left with NO active administrator — demoting
      the last one is the same lockout as deactivating them, and §6 gives no
      way back in but the Django admin;
    * DEACTIVATING is a revocation, not a discount. A provisioned account —
      one this org created — is barred from signing in at all when its last
      active membership goes, because a
      student whose membership is switched off but whose login still works
      would come back with NO policy, i.e. with more freedom than before
      (§2 is silent on what deactivation means; this is the reading that
      matches the word). An individual who merely joined keeps their own
      account and simply leaves the class.
    """

    permission_classes = [IsOrgAdmin]

    def patch(self, request, org_id: int, mid: int):
        member = get_object_or_404(
            Membership.objects.select_related("user", "professor"),
            pk=mid,
            organization_id=org_id,
        )
        payload = body(request)

        if "role" in payload:
            role = payload["role"]
            if role not in ROLES:
                return errors([f"role must be one of {', '.join(ROLES)}"])
            if role != Membership.STUDENT and "professor" not in payload:
                # No longer a student: the professor link goes with the role.
                member.professor = None
            member.role = role
        if "professor" in payload:
            raw = payload["professor"]
            if raw is None:
                member.professor = None
            else:
                professor = Membership.objects.filter(
                    pk=raw, organization_id=org_id, role=Membership.PROFESSOR
                ).first()
                if professor is None:
                    return errors(
                        ["that professor is not a professor in this organization"]
                    )
                if member.role != Membership.STUDENT:
                    return errors(["only a student has a professor"])
                if professor.pk == member.pk:
                    return errors(["a membership cannot teach itself"])
                member.professor = professor
        if "active" in payload:
            if not isinstance(payload["active"], bool):
                return errors(["active must be true or false"])
            if (
                payload["active"] is False
                and member.user_id == request.user.id
            ):
                return errors(["you cannot deactivate your own membership"])
            member.active = payload["active"]

        if self._would_orphan(member, org_id):
            return errors(["this organization would be left with no administrator"])

        with transaction.atomic():
            member.save()
            self._sync_account_access(member)
        return Response(member_json(member))

    @staticmethod
    def _would_orphan(member: Membership, org_id: int) -> bool:
        """Does the CHANGED (unsaved) membership leave the org adminless?"""
        others = Membership.objects.filter(
            organization_id=org_id,
            role=Membership.ADMIN,
            active=True,
            accepted_at__isnull=False,
        ).exclude(pk=member.pk)
        if others.exists():
            return False
        return not (
            member.role == Membership.ADMIN and member.active and not member.pending
        )

    @staticmethod
    def _sync_account_access(member: Membership) -> None:
        """A provisioned account exists FOR this organization: switch its last
        active membership off and the login goes with it (and comes back when
        the membership does)."""
        if not member.provisioned:
            return
        user = member.user
        still_in = (
            Membership.objects.filter(user=user, active=True, accepted_at__isnull=False)
            .exclude(pk=member.pk)
            .exists()
        )
        wanted = member.active or still_in
        if user.is_active != wanted:
            user.is_active = wanted
            user.save(update_fields=["is_active"])


class MemberResetPasswordView(APIView):
    """``POST /api/orgs/<org_id>/members/<mid>/reset-password`` (no body).

    What happens is decided by the ACCOUNT, never by what the caller sent:

    * an account this organization PROVISIONED gets the ordinary reset mail,
      and only when the mail cannot go out does the link come back for the
      admin to pass on (§3, §10.1). Nobody sets the password from here: §6
      gives the account the mail, and letting an admin set one outright would
      turn "add a member" into a way of taking an account over;
    * an account that belongs to somebody who merely JOINED this org is not
      touched at all. They have their own address and their own
      /forgot-password; nobody here gets a link into it.
    """

    permission_classes = [IsOrgAdminOrProfessor]

    def post(self, request, org_id: int, mid: int):
        member = get_object_or_404(
            Membership.objects.select_related("user"), pk=mid, organization_id=org_id
        )
        caller = self.membership
        if caller.role == Membership.PROFESSOR and not teaches(caller, member):
            return errors(
                ["you may only reset your own students' passwords"],
                status.HTTP_403_FORBIDDEN,
            )
        if not member.provisioned:
            return errors(
                [
                    "this member has an account of their own — they can reset "
                    "its password themselves from the sign-in page"
                ],
                status.HTTP_403_FORBIDDEN,
            )
        user = member.user
        link = reset_link(user)
        sent = send_password_reset(user, link)
        return Response({"sent": sent, "resetLink": None if sent else link})


class InvitationView(APIView):
    """``POST /api/invitations/<mid>/accept`` and ``…/decline`` — the other
    half of the consent fix, and the only way a membership over an EXISTING
    account ever becomes real.

    Beyond §6, which has no endpoint for it because it does not say how an
    individual joins an org. Only the invitee may answer, and answering
    'decline' removes the row outright rather than leaving a permanent
    invitation nobody can clear.
    """

    #: Which of the two routes this is; set by ``as_view(decision=…)``.
    decision = "accept"

    def post(self, request, mid: int):
        membership = get_object_or_404(
            Membership.objects.select_related("organization"),
            pk=mid,
            user=request.user,
        )
        if not membership.pending:
            return errors(["that invitation has already been answered"])
        if not membership.active:
            return errors(["that invitation is no longer open"])
        if self.decision == "decline":
            membership.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        membership.accepted_at = timezone.now()
        membership.save(update_fields=["accepted_at"])
        return Response(me_json(request.user))


class OrgPolicyView(APIView):
    """``GET|PUT /api/orgs/<org_id>/policy {policy}`` — the professor's DEFAULT
    rules for all their students."""

    permission_classes = [IsOrgProfessor]

    def get(self, request, org_id: int):
        stored, _ = TeachingPolicy.objects.get_or_create(
            professor_membership=self.membership,
            defaults={"policy": default_policy()},
        )
        return Response({"policy": stored.policy})

    def put(self, request, org_id: int):
        try:
            policy = validate_policy(body(request).get("policy"))
        except PolicyError as e:
            return errors(e.problems)
        stored, _ = TeachingPolicy.objects.get_or_create(
            professor_membership=self.membership,
            defaults={"policy": default_policy()},
        )
        stored.policy = policy
        stored.save(update_fields=["policy", "updated_at"])
        return Response({"policy": stored.policy})


class MemberPolicyView(APIView):
    """``PUT /api/orgs/<org_id>/members/<mid>/policy {override|null}`` — what
    this ONE student gets differently. ``null`` puts them back on the default."""

    permission_classes = [IsOrgProfessor]

    def put(self, request, org_id: int, mid: int):
        student = get_object_or_404(Membership, pk=mid, organization_id=org_id)
        if not teaches(self.membership, student):
            return errors(
                ["that student is not yours"], status.HTTP_403_FORBIDDEN
            )
        payload = body(request)
        raw = payload.get("override")
        if raw is None:
            student.policy_override = None
        else:
            try:
                student.policy_override = validate_policy(raw, partial=True)
            except PolicyError as e:
                return errors(e.problems)
        student.save(update_fields=["policy_override"])
        return Response(
            {
                "override": student.policy_override,
                "policy": policy_for_membership(student),
            }
        )


class StudentAnalysesView(APIView):
    """``GET /api/orgs/<org_id>/students/<mid>/analyses`` — one student's work,
    listed for their professor. Opening one is ``GET /api/analyses/<id>``,
    read-only (da/views.py)."""

    permission_classes = [IsOrgProfessor]

    def get(self, request, org_id: int, mid: int):
        student = get_object_or_404(
            Membership.objects.select_related("user"), pk=mid, organization_id=org_id
        )
        # The same question the analysis itself asks (permissions.professor_of),
        # so the listing and the opening can never disagree about one student.
        if not may_read_work(self.membership, student):
            return errors(["that student is not yours"], status.HTTP_403_FORBIDDEN)
        rows = Analysis.objects.filter(
            owner=student.user, deleted_at__isnull=True
        ).order_by("-updated_at")
        return Response(AnalysisListSerializer(rows, many=True).data)
