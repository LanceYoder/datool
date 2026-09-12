"""The public edge: CSRF, registration, login, logout, me, passwords (§3, §6).

Everything here goes through the HTTP API, because the contract these tests
hold is the one the SPA reads.
"""

import re

import pytest
from django.contrib.auth import get_user_model
from django.core import mail
from rest_framework.test import APIClient

from da.models import Membership, Organization
from da.policies import DEFAULT_POLICY

from .conftest import PASSWORD

User = get_user_model()

pytestmark = pytest.mark.django_db


def link_in(message) -> str:
    """The reset/invitation link out of a mail body."""
    found = re.search(r"https?://\S+/reset-password/\S+", message.body)
    assert found, message.body
    return found.group(0).rstrip(".")


def uid_and_token(link: str) -> tuple[str, str]:
    uid, token = link.rsplit("/", 2)[-2:]
    return uid, token


class TestCsrfAndSession:
    def test_csrf_bootstrap_sets_the_cookie_and_guards_mutations(self, individual):
        """The handshake §3 describes: fetch the cookie once, then echo it in
        X-CSRFToken on everything that writes."""
        client = APIClient(enforce_csrf_checks=True)
        bootstrap = client.get("/api/auth/csrf")
        assert bootstrap.status_code == 200
        assert bootstrap.json() == {"ok": True}
        assert "csrftoken" in client.cookies

        # Logging in is public — no session yet, so no token is demanded.
        signed_in = client.post(
            "/api/auth/login",
            {"login": "solo@example.com", "password": PASSWORD},
            format="json",
        )
        assert signed_in.status_code == 200

        # With a session, a mutating call without the header is refused…
        assert client.post("/api/auth/logout").status_code == 403
        # …and goes through with it (login rotated the token, so re-read it).
        token = client.cookies["csrftoken"].value
        assert client.post("/api/auth/logout", HTTP_X_CSRFTOKEN=token).status_code == 204

    def test_everything_else_is_401_until_you_sign_in(self, anon_client):
        """401, not 403: the SPA redirects to /login on it (§8)."""
        for path in (
            "/api/auth/me",
            "/api/analyses",
            "/api/analyses/deleted",
            "/api/taxonomy",
            "/api/corpus/words?start=0&end=3",
            "/api/corpus/verses?start=0&end=3",
            "/api/text-flow?start=0&end=3",
            "/api/orgs/mine",
        ):
            response = anon_client.get(path)
            assert response.status_code == 401, path
            assert response.json()["errors"], path
        assert anon_client.post("/api/first-pass", {"text": "x"}, format="json").status_code == 401


class TestThrottles:
    """The endpoints a stranger can hammer are rated (da/api/throttles.py);
    the throttle history is cleared between tests by conftest."""

    def test_login_guessing_is_rated_per_account(self, individual, anon_client):
        for _ in range(10):
            response = anon_client.post(
                "/api/auth/login",
                {"login": "solo@example.com", "password": "wrong-every-time"},
                format="json",
            )
            assert response.status_code == 400
        eleventh = anon_client.post(
            "/api/auth/login",
            {"login": "solo@example.com", "password": PASSWORD},  # even the RIGHT one
            format="json",
        )
        assert eleventh.status_code == 429
        assert eleventh.json()["errors"]

    def test_registration_is_rated_per_address(self, anon_client):
        for i in range(5):
            response = anon_client.post(
                "/api/auth/register",
                {"email": f"burst{i}@example.com", "password": "a-good-password-9"},
                format="json",
            )
            assert response.status_code == 201
        assert (
            anon_client.post(
                "/api/auth/register",
                {"email": "burst5@example.com", "password": "a-good-password-9"},
                format="json",
            ).status_code
            == 429
        )

    def test_forgot_password_cannot_flood_an_inbox(self, individual, anon_client):
        for _ in range(5):
            assert (
                anon_client.post(
                    "/api/auth/password/forgot", {"email": "solo@example.com"}, format="json"
                ).status_code
                == 200
            )
        assert (
            anon_client.post(
                "/api/auth/password/forgot", {"email": "solo@example.com"}, format="json"
            ).status_code
            == 429
        )
        assert len(mail.outbox) == 5


class TestRegister:
    def test_an_over_long_address_is_refused_not_stored(self, anon_client):
        """SQLite ignores varchar limits and PostgreSQL raises on them; the
        one public endpoint must refuse in the project's error shape."""
        too_long = "a" * 200 + "@example.com"
        response = anon_client.post(
            "/api/auth/register",
            {"email": too_long, "password": "a-good-password-9"},
            format="json",
        )
        assert response.status_code == 400
        assert "at most" in response.json()["errors"][0]
        assert not User.objects.filter(email=too_long).exists()

    def test_registering_makes_an_individual_and_signs_them_in(self, anon_client):
        response = anon_client.post(
            "/api/auth/register",
            {"email": "New.Person@example.com", "password": "a-good-password-9", "name": "New Person"},
            format="json",
        )
        assert response.status_code == 201
        me = response.json()
        assert set(me) == {
            "id", "email", "handle", "name", "memberships", "invitations",
            "policy", "isStaff",
        }
        assert me["invitations"] == []
        assert me["email"] == "New.Person@example.com"
        # The handle of an email account IS its address, lowercased (§3).
        assert me["handle"] == "new.person@example.com"
        assert me["name"] == "New Person"
        assert me["memberships"] == []
        assert me["policy"] is None  # an individual has no class rules
        assert me["isStaff"] is False
        # The session is live: no second call needed.
        assert anon_client.get("/api/auth/me").json()["id"] == me["id"]

    def test_the_password_validators_apply(self, anon_client):
        response = anon_client.post(
            "/api/auth/register",
            {"email": "weak@example.com", "password": "pass"},
            format="json",
        )
        assert response.status_code == 400
        assert any("too short" in e for e in response.json()["errors"])
        assert not User.objects.filter(email="weak@example.com").exists()

    @pytest.mark.parametrize(
        "payload, expected",
        [
            ({"password": "a-good-password-9"}, "email is required"),
            ({"email": "not-an-email", "password": "a-good-password-9"},
             "that does not look like an email address"),
        ],
    )
    def test_bad_input(self, anon_client, payload, expected):
        response = anon_client.post("/api/auth/register", payload, format="json")
        assert response.status_code == 400
        assert expected in response.json()["errors"][0]

    def test_an_address_is_taken_only_once(self, anon_client, individual):
        response = anon_client.post(
            "/api/auth/register",
            {"email": "SOLO@example.com", "password": "a-good-password-9"},
            format="json",
        )
        assert response.status_code == 400
        assert "already exists" in response.json()["errors"][0]


class TestLogin:
    def test_by_email_case_insensitively(self, anon_client, individual):
        response = anon_client.post(
            "/api/auth/login",
            {"login": "SOLO@Example.com", "password": PASSWORD},
            format="json",
        )
        assert response.status_code == 200
        assert response.json()["handle"] == "solo@example.com"

    def test_by_handle(self, anon_client, make_user):
        """A learning account has no address — the handle is the whole login."""
        make_user("greek101-smith", name="Sam Smith")
        response = anon_client.post(
            "/api/auth/login",
            {"login": "greek101-smith", "password": PASSWORD},
            format="json",
        )
        assert response.status_code == 200
        me = response.json()
        assert me["handle"] == "greek101-smith"
        assert me["email"] == ""

    def test_a_wrong_password_says_nothing_about_the_account(self, anon_client, individual):
        for credential in ("solo@example.com", "nobody@example.com"):
            response = anon_client.post(
                "/api/auth/login", {"login": credential, "password": "wrong"},
                format="json",
            )
            assert response.status_code == 400
            assert response.json()["errors"] == [
                "that login and password do not match an account"
            ]

    def test_a_deactivated_account_cannot_get_in(self, anon_client, individual):
        individual.is_active = False
        individual.save(update_fields=["is_active"])
        response = anon_client.post(
            "/api/auth/login", {"login": "solo@example.com", "password": PASSWORD},
            format="json",
        )
        assert response.status_code == 400

    def test_logout_ends_the_session(self, client):
        assert client.post("/api/auth/logout").status_code == 204
        assert client.get("/api/auth/me").status_code == 401


class TestMe:
    def test_a_student_carries_their_effective_policy(self, classroom, client_for):
        me = client_for(classroom.student).get("/api/auth/me").json()
        assert me["handle"] == "greek101-smith"
        assert me["policy"] == DEFAULT_POLICY  # no professor policy set yet
        assert len(me["memberships"]) == 1
        membership = me["memberships"][0]
        assert membership["org"] == {
            "id": classroom.org.id, "name": "Greek 101", "slug": "greek-101"
        }
        assert membership["role"] == "student"
        assert membership["professor"] == {
            "id": classroom.professor_m.id, "name": "Pro Fessor"
        }
        assert membership["membershipId"] == classroom.student_m.id

    def test_a_professor_has_no_policy_of_their_own(self, classroom, client_for):
        me = client_for(classroom.professor).get("/api/auth/me").json()
        assert me["policy"] is None
        assert me["memberships"][0]["role"] == "professor"

    def test_a_deactivated_membership_drops_out(self, classroom, client_for):
        classroom.student_m.active = False
        classroom.student_m.save()
        me = client_for(classroom.student).get("/api/auth/me").json()
        assert me["memberships"] == []
        assert me["policy"] is None

    def test_patching_the_display_name(self, client):
        response = client.patch("/api/auth/me", {"name": "Solo Renamed"}, format="json")
        assert response.status_code == 200
        assert response.json()["name"] == "Solo Renamed"
        assert client.get("/api/auth/me").json()["name"] == "Solo Renamed"


class TestPasswordReset:
    def test_forgot_then_reset_then_sign_in(self, anon_client, individual):
        forgot = anon_client.post(
            "/api/auth/password/forgot", {"email": "Solo@example.com"}, format="json"
        )
        assert forgot.status_code == 200
        assert forgot.json() == {"ok": True}
        assert len(mail.outbox) == 1
        link = link_in(mail.outbox[0])
        assert link.startswith("http://localhost:5173/reset-password/")

        uid, token = uid_and_token(link)
        reset = anon_client.post(
            "/api/auth/password/reset",
            {"uid": uid, "token": token, "password": "a-brand-new-one-7"},
            format="json",
        )
        assert reset.status_code == 200

        signed_in = anon_client.post(
            "/api/auth/login",
            {"login": "solo@example.com", "password": "a-brand-new-one-7"},
            format="json",
        )
        assert signed_in.status_code == 200
        # The token is single use: Django's generator keys on the password.
        again = anon_client.post(
            "/api/auth/password/reset",
            {"uid": uid, "token": token, "password": "another-good-one-7"},
            format="json",
        )
        assert again.status_code == 400

    def test_an_unknown_address_still_answers_200(self, anon_client):
        response = anon_client.post(
            "/api/auth/password/forgot", {"email": "nobody@example.com"}, format="json"
        )
        assert response.status_code == 200
        assert mail.outbox == []

    def test_a_learning_account_gets_no_mail(self, anon_client, make_user):
        """No address, so no reset by mail — a professor resets it (§2)."""
        make_user("greek101-smith")
        anon_client.post("/api/auth/password/forgot", {"email": ""}, format="json")
        assert mail.outbox == []

    @pytest.mark.parametrize(
        "payload",
        [
            {"uid": "bogus", "token": "bogus", "password": "a-good-password-9"},
            {"uid": "", "token": "", "password": "a-good-password-9"},
            {"password": "a-good-password-9"},
        ],
    )
    def test_a_bad_link_is_refused(self, anon_client, payload):
        response = anon_client.post("/api/auth/password/reset", payload, format="json")
        assert response.status_code == 400
        assert "invalid or has expired" in response.json()["errors"][0]

    def test_a_disabled_accounts_token_is_dead(self, anon_client, individual):
        """The forgot endpoint already filters ``is_active``; the reset one
        did not, so a token minted before an account was switched off still
        set its password. Django's own PasswordResetForm filters for exactly
        this reason."""
        anon_client.post(
            "/api/auth/password/forgot", {"email": "solo@example.com"}, format="json"
        )
        uid, token = uid_and_token(link_in(mail.outbox[0]))
        User.objects.filter(pk=individual.pk).update(is_active=False)

        response = anon_client.post(
            "/api/auth/password/reset",
            {"uid": uid, "token": token, "password": "back-in-again-8"},
            format="json",
        )
        assert response.status_code == 400
        assert "invalid or has expired" in response.json()["errors"][0]
        individual.refresh_from_db()
        assert individual.check_password(PASSWORD)

    def test_the_validators_apply_to_the_new_password(self, anon_client, individual):
        anon_client.post(
            "/api/auth/password/forgot", {"email": "solo@example.com"}, format="json"
        )
        uid, token = uid_and_token(link_in(mail.outbox[0]))
        response = anon_client.post(
            "/api/auth/password/reset",
            {"uid": uid, "token": token, "password": "12345678"},
            format="json",
        )
        assert response.status_code == 400
        assert any("numeric" in e or "common" in e for e in response.json()["errors"])


class TestPasswordChange:
    def test_changing_your_own_password_keeps_you_signed_in(self, client, individual):
        response = client.post(
            "/api/auth/password/change",
            {"current": PASSWORD, "password": "the-next-password-8"},
            format="json",
        )
        assert response.status_code == 200
        # The session survives its own password change.
        assert client.get("/api/auth/me").status_code == 200
        individual.refresh_from_db()
        assert individual.check_password("the-next-password-8")

    def test_the_current_password_is_checked(self, client, individual):
        response = client.post(
            "/api/auth/password/change",
            {"current": "not-it", "password": "the-next-password-8"},
            format="json",
        )
        assert response.status_code == 400
        assert response.json()["errors"] == ["your current password is not right"]
        individual.refresh_from_db()
        assert individual.check_password(PASSWORD)

    def test_it_needs_a_session(self, anon_client):
        response = anon_client.post(
            "/api/auth/password/change",
            {"current": PASSWORD, "password": "the-next-password-8"},
            format="json",
        )
        assert response.status_code == 401


class TestOrgCreation:
    """§2 (ruled 2026-09-12): an organization is set up by site staff at the
    school's request — ``manage.py create_org``, tested in test_create_org.py.
    The app offers no way to make one."""

    def test_there_is_no_self_serve_endpoint(self, client):
        response = client.post("/api/orgs", {"name": "Greek 101"}, format="json")
        assert response.status_code == 404
        assert not Organization.objects.exists()
