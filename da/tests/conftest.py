"""Shared fixtures for the API tests.

Everything under ``/api/`` needs a session now (docs/accounts-spec.md §3), so
``client`` is an APIClient already signed in as an ordinary INDIVIDUAL account
— the experience the tests were written against, minus the anonymity. Tests
that care about who is asking take ``client_for``, ``anon_client`` or the
``classroom`` fixture instead.

``force_login`` skips CSRF (``APIClient`` is built with
``enforce_csrf_checks=False``), which is right here: the CSRF handshake is the
browser's business and is tested on its own in ``test_accounts.py``.
"""

import pytest
from django.contrib.auth import get_user_model
from django.core.mail.backends.base import BaseEmailBackend
from rest_framework.test import APIClient

from da.models import Membership, Organization, TeachingPolicy

#: Long enough for the validators, and obviously not a real password.
PASSWORD = "analysis-pass-1"


@pytest.fixture(autouse=True)
def empty_throttle_history():
    """DRF keeps its rate-limit history in the Django cache, which — unlike the
    database — is NOT rolled back between tests. One test that sends its
    allowance of invitations would otherwise refuse the next test's first."""
    from django.core.cache import cache

    cache.clear()
    yield
    cache.clear()


@pytest.fixture(autouse=True)
def fast_password_hashing(settings):
    """These tests make and check dozens of passwords; the production hasher
    (a million PBKDF2 rounds, by design) would make the suite minutes long."""
    settings.PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]


class BrokenEmailBackend(BaseEmailBackend):
    """A mailer that always fails — the production state until the analyst
    picks an SMTP provider (§10.1). Point ``settings.EMAIL_BACKEND`` here to
    test what the API hands back when mail cannot go out."""

    def send_messages(self, email_messages):
        raise OSError("no mail host configured")


JOHN_1_1 = "Ἐν ἀρχῇ ἦν ὁ λόγος, καὶ ὁ λόγος ἦν πρὸς τὸν θεόν, καὶ θεὸς ἦν ὁ λόγος."


@pytest.fixture(scope="session")
def john_1_1():
    """Real corpus indexes for the CRUD document, located via align."""
    from da.corpus import align

    alignment = align(JOHN_1_1)
    assert alignment is not None and alignment.exact
    return alignment


def small_document(alignment) -> dict:
    """Two corpus-sourced propositions covering John 1:1, in a Series."""
    start, end = alignment.start, alignment.end
    return {
        "schemaVersion": 2,
        "propositions": [
            {"id": "p1", "label": "1a",
             "source": {"kind": "corpus", "start": start, "end": start + 4}},
            {"id": "p2", "label": "1b",
             "source": {"kind": "corpus", "start": start + 5, "end": end}},
        ],
        "forest": [
            {
                "kind": "bracket", "rel": "Ser", "prominent": None,
                "children": [
                    {"kind": "prop", "ref": "p1"},
                    {"kind": "prop", "ref": "p2"},
                ],
            },
        ],
    }


@pytest.fixture
def make_user(db):
    """Make an account. A handle-only user (no ``email``) is a LEARNING
    account; passing an email makes an ordinary one, whose handle IS the
    address, exactly as the API's own provisioning does."""

    def make(handle: str, *, email: str = "", name: str = "", password: str = PASSWORD,
             is_staff: bool = False):
        User = get_user_model()
        user = User(
            username=(email or handle).lower(),
            email=email,
            first_name=name,
            is_staff=is_staff,
        )
        user.set_password(password)
        user.save()
        return user

    return make


@pytest.fixture
def client_for():
    """``client_for(user)`` — an APIClient signed in as that account."""

    def sign_in(user) -> APIClient:
        client = APIClient()
        client.force_login(user)
        return client

    return sign_in


@pytest.fixture
def anon_client() -> APIClient:
    """Nobody signed in — for the public endpoints and the 401 boundary."""
    return APIClient()


@pytest.fixture
def individual(make_user):
    """A self-registered individual: no organization, no policy."""
    return make_user("solo", email="solo@example.com", name="Sol Ita")


@pytest.fixture
def client(individual, client_for) -> APIClient:
    """The default caller for the API tests: a signed-in individual."""
    return client_for(individual)


@pytest.fixture
def classroom(make_user):
    """One organization with every role in it, plus an outsider.

    ``student`` is assigned to ``professor``; ``other_student`` is assigned to
    ``other_professor`` in the same org (so "not YOUR student" is testable);
    ``stranger`` belongs to a different org entirely.

    Every membership in Greek 101 is ``provisioned``: these are the accounts
    the organization itself made, which is what lets an admin reset their
    passwords and what makes deactivating one a lockout (see
    :class:`da.models.Membership`). An individual who merely joined is the
    ``joiner`` fixture below.
    """
    from types import SimpleNamespace

    org = Organization.objects.create(name="Greek 101", slug="greek-101")
    other_org = Organization.objects.create(name="Hebrew 101", slug="hebrew-101")

    admin = make_user("dean", email="dean@example.com", name="Dee Ann")
    professor = make_user("prof", email="prof@example.com", name="Pro Fessor")
    other_professor = make_user("prof2", email="prof2@example.com", name="Second Prof")
    student = make_user("greek101-smith", name="Sam Smith")
    other_student = make_user("greek101-jones", name="Jo Jones")
    stranger = make_user("stranger", email="stranger@example.com", name="Stran Ger")

    admin_m = Membership.objects.create(
        user=admin, organization=org, role=Membership.ADMIN, provisioned=True
    )
    professor_m = Membership.objects.create(
        user=professor, organization=org, role=Membership.PROFESSOR, provisioned=True
    )
    other_professor_m = Membership.objects.create(
        user=other_professor,
        organization=org,
        role=Membership.PROFESSOR,
        provisioned=True,
    )
    student_m = Membership.objects.create(
        user=student,
        organization=org,
        role=Membership.STUDENT,
        professor=professor_m,
        provisioned=True,
    )
    other_student_m = Membership.objects.create(
        user=other_student,
        organization=org,
        role=Membership.STUDENT,
        professor=other_professor_m,
        provisioned=True,
    )
    stranger_m = Membership.objects.create(
        user=stranger, organization=other_org, role=Membership.ADMIN, provisioned=True
    )

    return SimpleNamespace(
        org=org,
        other_org=other_org,
        admin=admin,
        professor=professor,
        other_professor=other_professor,
        student=student,
        other_student=other_student,
        stranger=stranger,
        admin_m=admin_m,
        professor_m=professor_m,
        other_professor_m=other_professor_m,
        student_m=student_m,
        other_student_m=other_student_m,
        stranger_m=stranger_m,
    )


@pytest.fixture
def set_policy():
    """``set_policy(professor_membership, {...})`` — the professor's default."""

    def store(professor_membership, policy: dict) -> TeachingPolicy:
        from da.policies import validate_policy

        stored, _ = TeachingPolicy.objects.get_or_create(
            professor_membership=professor_membership
        )
        stored.policy = validate_policy(policy)
        stored.save()
        return stored

    return store
