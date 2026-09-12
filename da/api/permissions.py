"""Role checks for the organization endpoints (docs/accounts-spec.md §2, §6).

Every one of these resolves the CALLER's membership in the organization named
in the URL and stashes it on the view as ``view.membership`` — the handler
needs it anyway (a professor's listing is filtered by it, a created student is
assigned to it), and resolving it twice is how the two halves drift apart.

Site staff get NO bypass here. Staff read orphaned analyses through the Django
admin (§7); they do not silently become admins of other people's classrooms.
"""

from rest_framework.permissions import BasePermission

from ..models import Membership


class HasOrgRole(BasePermission):
    """Base: an ACTIVE membership in ``org_id`` whose role is in ``roles``."""

    roles: tuple[str, ...] = ()
    message = "you do not have that role in this organization"

    def has_permission(self, request, view) -> bool:
        org_id = view.kwargs.get("org_id")
        if org_id is None or not request.user.is_authenticated:
            return False
        membership = (
            Membership.objects.filter(
                organization_id=org_id,
                user=request.user,
                active=True,
                # A PENDING invitation is not a membership: until the person
                # accepts it, it gives its holder no role here at all.
                accepted_at__isnull=False,
            )
            .select_related("organization")
            .first()
        )
        if membership is None or membership.role not in self.roles:
            return False
        view.membership = membership
        return True


class IsOrgAdmin(HasOrgRole):
    roles = (Membership.ADMIN,)
    message = "only an administrator of this organization may do that"


class IsOrgProfessor(HasOrgRole):
    roles = (Membership.PROFESSOR,)
    message = "only a professor in this organization may do that"


class IsOrgAdminOrProfessor(HasOrgRole):
    roles = (Membership.ADMIN, Membership.PROFESSOR)
    message = "only an administrator or professor of this organization may do that"


def teaches(professor_membership: Membership, student_membership: Membership) -> bool:
    """Is that student one of this professor's own, and still in the class?

    ``active`` is part of the question, not a detail of one caller: a member
    who has been deactivated has been taken out of the class, and every
    endpoint that asks "is this my student?" has to answer the same way —
    :func:`professor_of`, which guards the analysis itself, requires it too.
    """
    return (
        student_membership.role == Membership.STUDENT
        and student_membership.professor_id == professor_membership.id
        and student_membership.active
    )


def may_read_work(
    professor_membership: Membership, student_membership: Membership
) -> bool:
    """May this professor OPEN that student's analyses? Teaching them is not
    enough: an invitation the student has not accepted gives nobody a way into
    the work they did before it was sent."""
    return teaches(professor_membership, student_membership) and not (
        student_membership.pending
    )


def professor_of(user, owner) -> bool:
    """May ``user`` READ ``owner``'s analyses — i.e. is ``user`` the professor
    of an active, ACCEPTED student membership held by ``owner``? (§2, §6:
    read-only.) The same three conditions as :func:`may_read_work`, asked of
    the analysis's owner instead of a known membership row."""
    if owner is None or not getattr(user, "is_authenticated", False):
        return False
    return Membership.objects.filter(
        user=owner,
        role=Membership.STUDENT,
        active=True,
        accepted_at__isnull=False,
        professor__user=user,
        professor__role=Membership.PROFESSOR,
        professor__active=True,
        professor__accepted_at__isnull=False,
    ).exists()
