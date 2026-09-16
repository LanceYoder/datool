"""The account JSON on the wire — camelCase, like da/serializers.py.

Plain functions, not DRF serializers: these shapes are read-only projections
of two or three model rows at a time, and the input validation they would
otherwise carry lives in the views next to the error messages it produces.
"""

from ..models import Membership
from ..policies import effective_policy


def user_json(user) -> dict:
    """The person: ``email`` is the login (every account has one)."""
    return {
        "id": user.id,
        "email": user.email,
        "name": (user.get_full_name() or "").strip(),
    }


def invited_json(user) -> dict:
    """The same three keys for somebody who has been INVITED and has not
    accepted: the address the invitation was sent to, and nothing else.

    An organization's roster is not a directory. Anyone signed in may make an
    org and type an address into it; if the answer came back carrying the
    holder's name and user id, that would be a lookup service for every
    account on the site. Their own name appears here the moment they accept.
    """
    return {"id": None, "email": user.email, "name": ""}


def professor_json(professor: Membership | None) -> dict | None:
    """A professor named from a student's side: their MEMBERSHIP id — the one
    ``/students/<mid>`` and the PATCH body use — never their user id.

    The same object on both listings, so one type covers both. Note the
    asymmetry with INPUT: a request assigns a professor by bare membership id
    (``{"professor": 12}``), because that is all it can know.
    """
    if professor is None:
        return None
    return {"id": professor.id, "name": professor.display_name}


def membership_json(membership: Membership) -> dict:
    """One of the caller's OWN memberships (``me.memberships``, ``orgs/mine``)."""
    return {
        "membershipId": membership.id,
        "org": {
            "id": membership.organization_id,
            "name": membership.organization.name,
            "slug": membership.organization.slug,
        },
        "role": membership.role,
        "professor": professor_json(membership.professor),
        "active": membership.active,
    }


def member_json(membership: Membership) -> dict:
    """One row of ``GET /api/orgs/<id>/members`` — somebody else, seen by an
    admin or by their professor.

    ``policyOverride`` rides along because §6 gives no endpoint that READS one:
    without it the teaching page could only ever show "uses your default", even
    for a student who has an override set.

    ``pending`` is the one key beyond §6's list: a row that is waiting to be
    accepted is not a member yet, and the page has to be able to say so rather
    than show a person who has agreed to nothing as though they had.
    """
    return {
        "membershipId": membership.id,
        "user": (
            invited_json(membership.user)
            if membership.pending
            else user_json(membership.user)
        ),
        "role": membership.role,
        "professor": professor_json(membership.professor),
        "active": membership.active,
        "policyOverride": membership.policy_override,
        "pending": membership.pending,
        # Whether this organization made the account — which decides whether
        # its password is the org's to reset (da/api/orgs.py). The roster is
        # where an admin chooses what to do, so it has to know.
        "provisioned": membership.provisioned,
    }


def invitation_json(membership: Membership) -> dict:
    """One unanswered invitation, as the invitee's own ``auth/me`` lists it."""
    return {
        "membershipId": membership.id,
        "org": {
            "id": membership.organization_id,
            "name": membership.organization.name,
            "slug": membership.organization.slug,
        },
        "role": membership.role,
    }


def me_json(user) -> dict:
    """``GET /api/auth/me`` — the session in one object, policy included so
    the editor can gate itself on the first paint.

    ``memberships`` holds only the ones this person has ACCEPTED; an
    invitation waiting to be answered is listed apart, under ``invitations``,
    so nothing an org typed into a form can appear as a role somebody holds.
    """
    rows = (
        Membership.objects.filter(user=user, active=True)
        .select_related("organization", "professor", "professor__user")
        .order_by("organization__name", "id")
    )
    return {
        **user_json(user),
        "memberships": [membership_json(m) for m in rows if not m.pending],
        "invitations": [invitation_json(m) for m in rows if m.pending],
        "policy": effective_policy(user),
        "isStaff": bool(user.is_staff),
    }
