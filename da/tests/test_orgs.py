"""Organizations: the roster, provisioning, assignment, and who may do what.

The role boundaries of docs/accounts-spec.md §2 and §6, endpoint by endpoint:
an admin manages membership and reads no analyses; a professor sees only their
own students; a student and an outsider see nothing at all.
"""

import pytest
from django.contrib.auth import get_user_model
from django.core import mail

from da.models import Membership, Organization, TeachingPolicy

from .conftest import PASSWORD, small_document
from .test_accounts import link_in, uid_and_token

User = get_user_model()

pytestmark = pytest.mark.django_db


@pytest.fixture
def as_admin(classroom, client_for):
    return client_for(classroom.admin)


@pytest.fixture
def as_professor(classroom, client_for):
    return client_for(classroom.professor)


def members_url(classroom) -> str:
    return f"/api/orgs/{classroom.org.id}/members"


class TestRoster:
    def test_an_admin_sees_everyone(self, classroom, as_admin):
        rows = as_admin.get(members_url(classroom)).json()
        assert {row["user"]["email"] for row in rows} == {
            "dean@example.com", "prof@example.com", "prof2@example.com",
            "smith@example.com", "jones@example.com",
        }
        student = next(r for r in rows if r["user"]["email"] == "smith@example.com")
        assert set(student) == {
            "membershipId", "user", "role", "professor", "active",
            "policyOverride", "pending", "provisioned",
        }
        assert set(student["user"]) == {"id", "email", "name"}
        assert student["pending"] is False
        assert student["role"] == "student"
        # A professor is named, not just numbered — the same object the
        # student's own /auth/me carries.
        assert student["professor"] == {
            "id": classroom.professor_m.id, "name": "Pro Fessor"
        }
        assert student["policyOverride"] is None
        assert student["active"] is True
        assert student["user"]["name"] == "Sam Smith"

    def test_a_professor_sees_only_their_own_students_and_themselves(
        self, classroom, as_professor
    ):
        rows = as_professor.get(members_url(classroom)).json()
        assert {row["user"]["email"] for row in rows} == {
            "prof@example.com", "smith@example.com",
        }

    @pytest.mark.parametrize("who", ["student", "stranger"])
    def test_nobody_else_sees_the_roster(self, classroom, client_for, who):
        response = client_for(getattr(classroom, who)).get(members_url(classroom))
        assert response.status_code == 403
        assert response.json()["errors"]

    def test_it_needs_a_session(self, classroom, anon_client):
        assert anon_client.get(members_url(classroom)).status_code == 401


class TestProvisioning:
    def test_an_email_account_is_invited_by_mail(self, classroom, as_admin):
        response = as_admin.post(
            members_url(classroom),
            {"role": "professor", "email": "New.Prof@example.com", "name": "New Prof"},
            format="json",
        )
        assert response.status_code == 201
        body = response.json()
        # The answer is the same three keys whether or not the address
        # already had an account — nothing here says which.
        assert set(body) == {"invited", "membershipId", "inviteLink"}
        assert body["invited"] is True
        # The mail went, so the admin is handed nothing to pass on.
        assert body["inviteLink"] is None
        # The row itself is on the roster.
        row = next(
            m for m in as_admin.get(members_url(classroom)).json()
            if m["membershipId"] == body["membershipId"]
        )
        assert row["role"] == "professor"
        assert row["provisioned"] is True
        assert row["user"]["email"] == "New.Prof@example.com"
        # The login of record is the address, lowercased.
        assert User.objects.get(email="New.Prof@example.com").username == "new.prof@example.com"

        assert len(mail.outbox) == 1
        assert mail.outbox[0].to == ["New.Prof@example.com"]
        assert "Greek 101" in mail.outbox[0].subject
        assert "Your login is New.Prof@example.com" in mail.outbox[0].body

        # The invitation is a password reset that was never set: following it
        # is how the new professor gets in.
        uid, token = uid_and_token(link_in(mail.outbox[0]))
        from rest_framework.test import APIClient

        visitor = APIClient()
        assert visitor.post(
            "/api/auth/password/reset",
            {"uid": uid, "token": token, "password": "chosen-by-them-4"},
            format="json",
        ).status_code == 200
        assert visitor.post(
            "/api/auth/login",
            {"email": "new.prof@example.com", "password": "chosen-by-them-4"},
            format="json",
        ).status_code == 200

    def test_when_mail_cannot_go_the_link_comes_back(self, classroom, as_admin, settings):
        """§3, §10.1: an unconfigured mailer must not block provisioning."""
        settings.EMAIL_BACKEND = "da.tests.conftest.BrokenEmailBackend"
        body = as_admin.post(
            members_url(classroom),
            {"role": "student", "email": "shown@example.com"},
            format="json",
        ).json()
        assert body["inviteLink"].startswith("http://localhost:5173/reset-password/")

    def test_a_student_is_assigned_at_creation(self, classroom, as_admin):
        body = as_admin.post(
            members_url(classroom),
            {"role": "student", "email": "brown@example.com", "name": "Bo Brown",
             "professor": classroom.professor_m.id},
            format="json",
        ).json()
        row = next(
            m for m in as_admin.get(members_url(classroom)).json()
            if m["membershipId"] == body["membershipId"]
        )
        assert row["professor"]["id"] == classroom.professor_m.id
        assert row["user"]["name"] == "Bo Brown"

    def test_nobody_sets_a_provisioned_accounts_first_password(
        self, classroom, as_admin
    ):
        """The set-password link in the mail is the ONLY way in: a password in
        the body is not a field this endpoint has, so it is not applied."""
        body = as_admin.post(
            members_url(classroom),
            {"role": "student", "email": "green@example.com", "password": "chosen-here-6"},
            format="json",
        ).json()
        assert set(body) == {"invited", "membershipId", "inviteLink"}
        user = User.objects.get(email="green@example.com")
        assert not user.has_usable_password()

        from rest_framework.test import APIClient

        assert APIClient().post(
            "/api/auth/login",
            {"email": "green@example.com", "password": "chosen-here-6"},
            format="json",
        ).status_code == 400

    def test_an_existing_individual_is_INVITED_not_enrolled(
        self, classroom, as_admin, individual, client_for
    ):
        """§2: individuals may later be added to an org — but an account that
        already exists is somebody's, and joining is theirs to agree to.

        The row that appears is a PENDING invitation: it holds no role, shows
        the org nothing about them, and imposes nothing on their editor until
        they answer it themselves.
        """
        response = as_admin.post(
            members_url(classroom),
            {"role": "professor", "email": "solo@example.com"},
            format="json",
        )
        assert response.status_code == 201
        body = response.json()
        # The POST answers exactly what it answers for an unknown address —
        # nothing about whether an account existed, let alone whose.
        assert set(body) == {"invited", "membershipId", "inviteLink"}
        assert body["inviteLink"] is None
        # On the roster the row is PENDING, and carries the address only —
        # their name and user id are not handed to whoever typed it in.
        row = next(
            m for m in as_admin.get(members_url(classroom)).json()
            if m["membershipId"] == body["membershipId"]
        )
        assert row["pending"] is True
        assert row["user"] == {"id": None, "email": "solo@example.com", "name": ""}
        # The mail that goes out carries no way into the account — no token,
        # no set-password link.
        assert len(mail.outbox) == 1
        assert mail.outbox[0].to == ["solo@example.com"]
        assert "/reset-password/" not in mail.outbox[0].body
        individual.refresh_from_db()
        assert individual.check_password(PASSWORD)

        # Nothing has changed for them: no membership, no policy, no role.
        me = client_for(individual).get("/api/auth/me").json()
        assert me["memberships"] == []
        assert me["policy"] is None
        assert me["invitations"] == [
            {
                "membershipId": body["membershipId"],
                "org": {"id": classroom.org.id, "name": "Greek 101",
                        "slug": "greek-101"},
                "role": "professor",
            }
        ]
        # …and the pending row gives them no access to the organization.
        assert client_for(individual).get(members_url(classroom)).status_code == 403

        again = as_admin.post(
            members_url(classroom), {"role": "student", "email": "solo@example.com"},
            format="json",
        )
        assert again.status_code == 400
        assert "already a member" in again.json()["errors"][0]

    def test_an_invitation_becomes_a_membership_when_it_is_accepted(
        self, classroom, as_admin, individual, client_for
    ):
        mid = as_admin.post(
            members_url(classroom),
            {"role": "professor", "email": "solo@example.com"},
            format="json",
        ).json()["membershipId"]
        joiner = client_for(individual)

        accepted = joiner.post(f"/api/invitations/{mid}/accept", {}, format="json")
        assert accepted.status_code == 200
        assert accepted.json()["invitations"] == []
        assert accepted.json()["memberships"][0]["role"] == "professor"
        # Now — and only now — the org sees who they are, and they can work.
        row = next(
            r for r in as_admin.get(members_url(classroom)).json()
            if r["membershipId"] == mid
        )
        assert row["pending"] is False
        assert row["user"]["name"] == "Sol Ita"
        assert joiner.get(f"/api/orgs/{classroom.org.id}/policy").status_code == 200
        # An answered invitation cannot be answered twice.
        assert joiner.post(
            f"/api/invitations/{mid}/accept", {}, format="json"
        ).status_code == 400

    def test_only_the_invitee_answers_an_invitation(
        self, classroom, as_admin, individual, client_for
    ):
        mid = as_admin.post(
            members_url(classroom),
            {"role": "student", "email": "solo@example.com"},
            format="json",
        ).json()["membershipId"]
        # Not even the admin who sent it: a 404, because it is not theirs.
        assert as_admin.post(
            f"/api/invitations/{mid}/accept", {}, format="json"
        ).status_code == 404
        assert Membership.objects.get(pk=mid).pending is True

        declined = client_for(individual).post(
            f"/api/invitations/{mid}/decline", {}, format="json"
        )
        assert declined.status_code == 204
        assert not Membership.objects.filter(pk=mid).exists()

    def test_an_invitation_can_never_impose_a_policy(
        self, classroom, as_admin, individual, client_for, set_policy, john_1_1
    ):
        """The takeover this consent step exists to stop: a stranger's org
        must not be able to decide what somebody else's editor may do."""
        set_policy(classroom.professor_m, {"firstPass": {"allowed": ["none"]},
                                           "aids": {"english": False}})
        as_admin.post(
            members_url(classroom),
            {"role": "student", "email": "solo@example.com",
             "professor": classroom.professor_m.id},
            format="json",
        )
        joiner = client_for(individual)
        assert joiner.get("/api/auth/me").json()["policy"] is None
        # The tier that policy withholds is still theirs to start from.
        made = joiner.post(
            "/api/analyses",
            {"title": "mine", "document": small_document(john_1_1), "tier": "full"},
            format="json",
        )
        assert made.status_code == 201
        # And their work stays their own: the professor named in the pending
        # invitation cannot open it.
        assert client_for(classroom.professor).get(
            f"/api/analyses/{made.json()['id']}"
        ).status_code == 404

    def test_a_professor_may_only_make_students_and_they_are_theirs(
        self, classroom, as_professor
    ):
        made = as_professor.post(
            members_url(classroom),
            {"role": "student", "email": "white@example.com"},
            format="json",
        )
        assert made.status_code == 201
        stolen = as_professor.post(
            members_url(classroom),
            {"role": "student", "email": "black@example.com",
             "professor": classroom.other_professor_m.id},
            format="json",
        )
        assert stolen.status_code == 201
        # Assigned to the professor who made them, whatever the body says.
        rows = {m["membershipId"]: m for m in as_professor.get(members_url(classroom)).json()}
        assert rows[made.json()["membershipId"]]["professor"]["id"] == classroom.professor_m.id
        assert rows[stolen.json()["membershipId"]]["professor"]["id"] == classroom.professor_m.id

        refused = as_professor.post(
            members_url(classroom), {"role": "professor", "email": "no@example.com"},
            format="json",
        )
        assert refused.status_code == 403
        assert "only create students" in refused.json()["errors"][0]

    @pytest.mark.parametrize(
        "payload, expected",
        [
            ({"role": "wizard", "email": "x@example.com"}, "role must be one of"),
            ({"role": "student"}, "an email is required"),
            ({"role": "student", "email": ""}, "an email is required"),
            ({"role": "student", "email": "   "}, "an email is required"),
            ({"role": "student", "email": "not-an-email"},
             "that does not look like an email address"),
            ({"role": "student", "email": "smith@example.com"},
             "already a member of this organization"),
            ({"role": "professor", "email": "prof-x@example.com", "professor": 999},
             "only a student has a professor"),
            ({"role": "student", "email": "s-x@example.com", "professor": 999},
             "not a professor in this organization"),
        ],
    )
    def test_bad_input(self, classroom, as_admin, payload, expected):
        response = as_admin.post(members_url(classroom), payload, format="json")
        assert response.status_code == 400
        assert expected in " ".join(response.json()["errors"])

    def test_a_value_the_database_would_refuse_is_refused_here(
        self, classroom, as_admin
    ):
        """SQLite ignores a varchar limit and PostgreSQL — production — raises
        DataError. A length nothing checked would 201 in development and 500
        in the deployment, leaving a row that cannot be migrated."""
        payload = {"role": "student", "email": "a" * 300 + "@example.com"}
        response = as_admin.post(members_url(classroom), payload, format="json")
        assert response.status_code == 400
        assert "an email address may be at most" in " ".join(response.json()["errors"])
        assert User.objects.filter(username__startswith="a" * 20).count() == 0

    def test_invitations_are_rate_limited(self, classroom, as_admin, settings):
        """§10.1's mail provider is the app's reputation. Provisioning by mail
        is a message this app sends to an address of the caller's choosing, and
        volume is the only thing that separates it from a relay."""
        settings.REST_FRAMEWORK = {
            **settings.REST_FRAMEWORK,
            "DEFAULT_THROTTLE_RATES": {"invitations": "3/day"},
        }
        codes = [
            as_admin.post(
                members_url(classroom),
                {"role": "student", "email": f"target{n}@example.com"},
                format="json",
            ).status_code
            for n in range(5)
        ]
        assert codes[:3] == [201, 201, 201]
        assert codes[3:] == [429, 429]
        assert len(mail.outbox) == 3

    def test_one_address_cannot_be_invited_by_a_crowd(
        self, classroom, as_admin, as_professor, settings
    ):
        settings.REST_FRAMEWORK = {
            **settings.REST_FRAMEWORK,
            "DEFAULT_THROTTLE_RATES": {"invitations": "1/day"},
        }
        first = as_admin.post(
            members_url(classroom),
            {"role": "student", "email": "popular@example.com"},
            format="json",
        )
        assert first.status_code == 201
        # A different caller, the same address: the target's limit is what
        # answers, not the sender's.
        second = as_professor.post(
            members_url(classroom),
            {"role": "student", "email": "popular@example.com"},
            format="json",
        )
        assert second.status_code == 429

    def test_the_invitation_mail_names_no_inviter_and_cuts_the_org_name(
        self, client, individual
    ):
        """The copy is not a place for a stranger's prose: an invitation is
        mail from datool's own domain to an unverified address. Staff make
        the organization (§2), but its name is still the school's own words."""
        long_name = "Password Services — action required, click here " * 4
        org = Organization.objects.create(
            name=long_name[:200], slug=Organization.unique_slug(long_name[:200])
        )
        Membership.objects.create(user=individual, organization=org, role=Membership.ADMIN)
        client.patch("/api/auth/me", {"name": "IT Support"}, format="json")
        sent = client.post(
            f"/api/orgs/{org.id}/members",
            {"role": "student", "email": "victim@example.com"},
            format="json",
        )
        assert sent.status_code == 201
        assert len(mail.outbox) == 1
        assert "IT Support" not in mail.outbox[0].body
        assert len(mail.outbox[0].subject) < 130

    @pytest.mark.parametrize("who", ["student", "stranger"])
    def test_nobody_else_may_provision(self, classroom, client_for, who):
        response = client_for(getattr(classroom, who)).post(
            members_url(classroom), {"role": "student", "email": "x-y@example.com"},
            format="json",
        )
        assert response.status_code == 403
        assert not User.objects.filter(email="x-y@example.com").exists()


class TestMemberPatch:
    def test_an_admin_assigns_a_student_to_a_professor(self, classroom, as_admin):
        response = as_admin.patch(
            f"{members_url(classroom)}/{classroom.student_m.id}",
            {"professor": classroom.other_professor_m.id},
            format="json",
        )
        assert response.status_code == 200
        assert response.json()["professor"]["id"] == classroom.other_professor_m.id
        classroom.student_m.refresh_from_db()
        assert classroom.student_m.professor_id == classroom.other_professor_m.id

    def test_unassigning_and_deactivating(self, classroom, as_admin):
        url = f"{members_url(classroom)}/{classroom.student_m.id}"
        assert as_admin.patch(url, {"professor": None}, format="json").json()["professor"] is None
        assert as_admin.patch(url, {"active": False}, format="json").json()["active"] is False
        classroom.student_m.refresh_from_db()
        assert classroom.student_m.active is False

    def test_promoting_a_student_drops_their_professor(self, classroom, as_admin):
        body = as_admin.patch(
            f"{members_url(classroom)}/{classroom.student_m.id}",
            {"role": "professor"},
            format="json",
        ).json()
        assert body["role"] == "professor"
        assert body["professor"] is None

    @pytest.mark.parametrize(
        "payload, expected",
        [
            ({"role": "wizard"}, "role must be one of"),
            ({"active": "no"}, "active must be true or false"),
            ({"professor": 999999}, "not a professor in this organization"),
        ],
    )
    def test_bad_input(self, classroom, as_admin, payload, expected):
        response = as_admin.patch(
            f"{members_url(classroom)}/{classroom.student_m.id}", payload, format="json"
        )
        assert response.status_code == 400
        assert expected in " ".join(response.json()["errors"])

    def test_a_professor_may_not_reassign(self, classroom, as_professor):
        response = as_professor.patch(
            f"{members_url(classroom)}/{classroom.student_m.id}",
            {"professor": classroom.other_professor_m.id},
            format="json",
        )
        assert response.status_code == 403
        classroom.student_m.refresh_from_db()
        assert classroom.student_m.professor_id == classroom.professor_m.id

    def test_a_member_of_another_org_is_a_404(self, classroom, as_admin):
        response = as_admin.patch(
            f"{members_url(classroom)}/{classroom.stranger_m.id}",
            {"active": False},
            format="json",
        )
        assert response.status_code == 404

    def test_an_admin_cannot_lock_themselves_out(self, classroom, as_admin):
        response = as_admin.patch(
            f"{members_url(classroom)}/{classroom.admin_m.id}",
            {"active": False},
            format="json",
        )
        assert response.status_code == 400

    def test_the_last_administrator_cannot_be_demoted_either(
        self, classroom, as_admin
    ):
        """Deactivating yourself was refused; demoting yourself was not, and it
        left an organization nobody could administer — every endpoint 403 for
        everyone, and no way back but the Django admin."""
        response = as_admin.patch(
            f"{members_url(classroom)}/{classroom.admin_m.id}",
            {"role": "student"},
            format="json",
        )
        assert response.status_code == 400
        assert "no administrator" in " ".join(response.json()["errors"])
        classroom.admin_m.refresh_from_db()
        assert classroom.admin_m.role == "admin"
        assert as_admin.get(members_url(classroom)).status_code == 200

    def test_a_second_administrator_makes_it_allowed(self, classroom, as_admin):
        as_admin.patch(
            f"{members_url(classroom)}/{classroom.professor_m.id}",
            {"role": "admin"},
            format="json",
        )
        stepping_down = as_admin.patch(
            f"{members_url(classroom)}/{classroom.admin_m.id}",
            {"role": "professor"},
            format="json",
        )
        assert stepping_down.status_code == 200

    def test_deactivating_a_provisioned_account_stops_it_signing_in(
        self, classroom, as_admin, set_policy, client_for
    ):
        """§2 does not say what deactivation MEANS; unless it bars the login it
        is a promotion. A student whose membership is off resolves no policy at
        all, and the whole app reads "no policy" as "everything allowed" — so
        switching a student off used to hand them the tiers their class had
        withheld, unsupervised."""
        set_policy(classroom.professor_m, {"firstPass": {"allowed": ["minimal"]}})
        # Before: signed in, and held to the class rules.
        student = client_for(classroom.student)
        assert student.get("/api/auth/me").json()["policy"]["firstPass"] == {
            "allowed": ["minimal"]
        }

        assert as_admin.patch(
            f"{members_url(classroom)}/{classroom.student_m.id}",
            {"active": False},
            format="json",
        ).status_code == 200

        from rest_framework.test import APIClient

        refused = APIClient().post(
            "/api/auth/login",
            {"email": "smith@example.com", "password": PASSWORD},
            format="json",
        )
        assert refused.status_code == 400
        classroom.student.refresh_from_db()
        assert classroom.student.is_active is False

        # Reactivating gives the account back.
        assert as_admin.patch(
            f"{members_url(classroom)}/{classroom.student_m.id}",
            {"active": True},
            format="json",
        ).status_code == 200
        classroom.student.refresh_from_db()
        assert classroom.student.is_active is True
        assert APIClient().post(
            "/api/auth/login",
            {"email": "smith@example.com", "password": PASSWORD},
            format="json",
        ).status_code == 200

    def test_an_individual_who_joined_keeps_their_own_account(
        self, classroom, as_admin, individual, client_for
    ):
        """The limit of the rule above: deactivation removes somebody from a
        class, and an account the organization never made is not the
        organization's to switch off."""
        mid = as_admin.post(
            members_url(classroom),
            {"role": "student", "email": "solo@example.com"},
            format="json",
        ).json()["membershipId"]
        client_for(individual).post(f"/api/invitations/{mid}/accept", {}, format="json")

        assert as_admin.patch(
            f"{members_url(classroom)}/{mid}", {"active": False}, format="json"
        ).status_code == 200
        individual.refresh_from_db()
        assert individual.is_active is True
        assert client_for(individual).get("/api/auth/me").status_code == 200


class TestMemberPasswordReset:
    def url(self, classroom, membership) -> str:
        return f"{members_url(classroom)}/{membership.id}/reset-password"

    def test_a_professor_sends_their_own_student_the_reset_mail(
        self, classroom, as_professor
    ):
        response = as_professor.post(
            self.url(classroom, classroom.student_m), {}, format="json"
        )
        assert response.status_code == 200
        assert response.json() == {"sent": True, "resetLink": None}
        assert len(mail.outbox) == 1
        assert mail.outbox[0].to == ["smith@example.com"]
        # The old password stands until the student follows the link.
        classroom.student.refresh_from_db()
        assert classroom.student.check_password(PASSWORD)

        uid, token = uid_and_token(link_in(mail.outbox[0]))
        from rest_framework.test import APIClient

        visitor = APIClient()
        assert visitor.post(
            "/api/auth/password/reset",
            {"uid": uid, "token": token, "password": "sams-new-word-19"},
            format="json",
        ).status_code == 200
        assert visitor.post(
            "/api/auth/login",
            {"email": "smith@example.com", "password": "sams-new-word-19"},
            format="json",
        ).status_code == 200

    def test_nobody_is_given_a_password_outright(self, classroom, as_admin):
        """§6: a provisioned account gets the reset MAIL and nothing else.
        A password in the body is not a field this endpoint has — setting one
        from here would turn "add a member" into a takeover."""
        response = as_admin.post(
            self.url(classroom, classroom.professor_m),
            {"password": "taken-over-9"},
            format="json",
        )
        assert response.status_code == 200
        assert response.json() == {"sent": True, "resetLink": None}
        classroom.professor.refresh_from_db()
        assert classroom.professor.check_password(PASSWORD)
        assert not classroom.professor.check_password("taken-over-9")

    def test_an_account_the_org_did_not_make_is_not_touched_at_all(
        self, classroom, as_admin, individual, client_for
    ):
        """The other half of it: an individual who joined keeps their own
        account. No password is set for them, and no link into it comes back
        — not even in the default production state where mail cannot go."""
        mid = as_admin.post(
            members_url(classroom),
            {"role": "student", "email": "solo@example.com"},
            format="json",
        ).json()["membershipId"]
        client_for(individual).post(f"/api/invitations/{mid}/accept", {}, format="json")

        refused = as_admin.post(
            f"{members_url(classroom)}/{mid}/reset-password", {}, format="json"
        )
        assert refused.status_code == 403
        assert "account of their own" in " ".join(refused.json()["errors"])
        individual.refresh_from_db()
        assert individual.check_password(PASSWORD)

    def test_not_even_when_the_mailer_is_down(
        self, classroom, as_admin, individual, client_for, settings
    ):
        settings.EMAIL_BACKEND = "da.tests.conftest.BrokenEmailBackend"
        mid = as_admin.post(
            members_url(classroom),
            {"role": "student", "email": "solo@example.com"},
            format="json",
        ).json()["membershipId"]
        client_for(individual).post(f"/api/invitations/{mid}/accept", {}, format="json")
        refused = as_admin.post(
            f"{members_url(classroom)}/{mid}/reset-password", {}, format="json"
        )
        assert refused.status_code == 403
        assert "resetLink" not in refused.json()

    def test_an_email_account_gets_the_reset_mail(self, classroom, as_admin):
        body = as_admin.post(
            self.url(classroom, classroom.professor_m), {}, format="json"
        ).json()
        assert body == {"sent": True, "resetLink": None}
        assert len(mail.outbox) == 1
        assert mail.outbox[0].to == ["prof@example.com"]

    def test_when_the_mail_cannot_go_the_link_comes_back(
        self, classroom, as_admin, settings
    ):
        settings.EMAIL_BACKEND = "da.tests.conftest.BrokenEmailBackend"
        body = as_admin.post(
            self.url(classroom, classroom.professor_m), {}, format="json"
        ).json()
        assert body["sent"] is False
        assert "/reset-password/" in body["resetLink"]

    def test_a_professor_may_not_reset_another_professors_student(
        self, classroom, as_professor
    ):
        response = as_professor.post(
            self.url(classroom, classroom.other_student_m), {}, format="json"
        )
        assert response.status_code == 403
        classroom.other_student.refresh_from_db()
        assert classroom.other_student.check_password(PASSWORD)

    @pytest.mark.parametrize("who", ["student", "stranger"])
    def test_nobody_else_may_reset(self, classroom, client_for, who):
        response = client_for(getattr(classroom, who)).post(
            self.url(classroom, classroom.student_m), {}, format="json"
        )
        assert response.status_code == 403


class TestPolicyEndpoints:
    def policy_url(self, classroom) -> str:
        return f"/api/orgs/{classroom.org.id}/policy"

    def override_url(self, classroom, membership) -> str:
        return f"{members_url(classroom)}/{membership.id}/policy"

    def test_a_professor_reads_and_writes_their_default(self, classroom, as_professor):
        from da.policies import DEFAULT_POLICY

        first = as_professor.get(self.policy_url(classroom))
        assert first.status_code == 200
        assert first.json() == {"policy": DEFAULT_POLICY}

        saved = as_professor.put(
            self.policy_url(classroom),
            {"policy": {"firstPass": {"allowed": ["minimal"]},
                        "aids": {"english": False}}},
            format="json",
        )
        assert saved.status_code == 200
        policy = saved.json()["policy"]
        # A partial write is stored WHOLE: the rest keeps the default.
        assert policy["firstPass"]["allowed"] == ["minimal"]
        assert policy["aids"] == {"english": False, "verses": True,
                                  "verbs": True, "colorCoding": True}
        assert set(policy) == {"firstPass", "aids"}
        assert as_professor.get(self.policy_url(classroom)).json()["policy"] == policy

        # …and reaches the student's own /auth/me.
        stored = TeachingPolicy.objects.get(professor_membership=classroom.professor_m)
        assert stored.policy == policy

    def test_an_unknown_key_is_refused(self, classroom, as_professor):
        response = as_professor.put(
            self.policy_url(classroom),
            {"policy": {"aids": {"english": True}, "wizardry": {"on": True}}},
            format="json",
        )
        assert response.status_code == 400
        assert "unknown policy key 'wizardry'" in response.json()["errors"]
        assert not TeachingPolicy.objects.exists()

    def test_a_retired_gesture_switch_is_refused_with_its_reason(
        self, classroom, as_professor
    ):
        """§5 (ruled 2026-09-12): the gestures are always available. A tab
        still showing the first build's switches is answered in those words."""
        response = as_professor.put(
            self.policy_url(classroom),
            {"policy": {"split": {"enabled": False}}},
            format="json",
        )
        assert response.status_code == 400
        assert response.json()["errors"] == [
            "split is no longer a class rule — it is always available"
        ]
        assert not TeachingPolicy.objects.exists()

    @pytest.mark.parametrize("who", ["admin", "student", "stranger"])
    def test_only_a_professor_touches_the_default(self, classroom, client_for, who):
        client = client_for(getattr(classroom, who))
        assert client.get(self.policy_url(classroom)).status_code == 403
        assert client.put(
            self.policy_url(classroom), {"policy": {}}, format="json"
        ).status_code == 403

    def test_a_per_student_override_wins_and_can_be_cleared(
        self, classroom, as_professor, client_for, set_policy
    ):
        set_policy(classroom.professor_m, {"aids": {"english": False,
                                                    "verbs": False}})
        response = as_professor.put(
            self.override_url(classroom, classroom.student_m),
            {"override": {"aids": {"verbs": True}}},
            format="json",
        )
        assert response.status_code == 200
        body = response.json()
        assert body["override"] == {"aids": {"verbs": True}}
        assert body["policy"]["aids"]["verbs"] is True       # override wins
        assert body["policy"]["aids"]["english"] is False    # default stands

        me = client_for(classroom.student).get("/api/auth/me").json()
        assert me["policy"] == body["policy"]

        cleared = as_professor.put(
            self.override_url(classroom, classroom.student_m),
            {"override": None},
            format="json",
        )
        assert cleared.json()["override"] is None
        assert cleared.json()["policy"]["aids"]["verbs"] is False

    def test_only_your_own_students_have_overrides(self, classroom, as_professor):
        response = as_professor.put(
            self.override_url(classroom, classroom.other_student_m),
            {"override": {"aids": {"verbs": False}}},
            format="json",
        )
        assert response.status_code == 403
        classroom.other_student_m.refresh_from_db()
        assert classroom.other_student_m.policy_override is None

    def test_an_invalid_override_is_refused(self, classroom, as_professor):
        response = as_professor.put(
            self.override_url(classroom, classroom.student_m),
            {"override": {"aids": {"verbs": "no"}}},
            format="json",
        )
        assert response.status_code == 400
        assert "aids.verbs must be true or false" in response.json()["errors"]

    @pytest.mark.parametrize("who", ["admin", "student", "stranger"])
    def test_nobody_else_sets_an_override(self, classroom, client_for, who):
        response = client_for(getattr(classroom, who)).put(
            self.override_url(classroom, classroom.student_m),
            {"override": {}},
            format="json",
        )
        assert response.status_code == 403


class TestTheTakeoverPath:
    """The whole reported attack, replayed end to end.

    Organizations are staff-made now (§2), which narrows who can start this
    chain to somebody a school has handed an admin role — but an admin is
    still not to be trusted with a stranger's account. If adding an address
    that already has an account made a LIVE membership, that one permission
    chained into a total takeover: attach the victim, promote yourself to
    their professor, read their analyses, impose a policy on their editor,
    and — through the admin's reset — set their password and sign in as
    them. Every link of that chain is asserted broken here.
    """

    def test_a_stranger_cannot_take_over_an_account_by_its_address(
        self, individual, make_user, client_for, john_1_1
    ):
        from da.models import Analysis

        victim = individual
        private = Analysis.objects.create(
            owner=victim,
            title="the victim's own",
            document=small_document(john_1_1),
            notes="private thoughts",
        )
        attacker = make_user("mallory@example.com", name="Mal Lory")
        client = client_for(attacker)

        org = Organization.objects.create(name="Free Greek", slug="free-greek")
        mine = Membership.objects.create(
            user=attacker, organization=org, role=Membership.ADMIN
        ).id
        org_url = f"/api/orgs/{org.id}"
        # Make yourself a professor, so that "your students" would mean
        # something.
        client.patch(
            f"{org_url}/members/{mine}", {"role": "professor"}, format="json"
        )
        # …which the org may not do while it is the only administrator, so an
        # attacker has to leave one of their own accounts behind first.
        assert Membership.objects.get(pk=mine).role == "admin"
        client.post(
            f"{org_url}/members",
            {"role": "admin", "email": "second@example.com"},
            format="json",
        )
        client.patch(
            f"{org_url}/members/{mine}", {"role": "professor"}, format="json"
        )

        added = client.post(
            f"{org_url}/members",
            {"role": "student", "email": "solo@example.com", "professor": mine},
            format="json",
        )
        assert added.status_code == 201
        mid = added.json()["membershipId"]

        # 1. no live membership, so no policy is imposed on the victim.
        assert client_for(victim).get("/api/auth/me").json()["policy"] is None
        # 2. their work is not listed, and not readable.
        assert client.get(f"{org_url}/students/{mid}/analyses").status_code == 403
        assert client.get(f"/api/analyses/{private.id}").status_code == 404
        # 3. their password cannot be set, nor a link to it obtained.
        reset = client.post(
            f"{org_url}/members/{mid}/reset-password",
            {"password": "brand-new-pass-42"},
            format="json",
        )
        assert reset.status_code == 403
        victim.refresh_from_db()
        assert victim.check_password(PASSWORD)
        # 4. and the address discloses nothing about who holds it: the answer
        #    is the three neutral keys, the same as for an unknown address.
        assert set(added.json()) == {"invited", "membershipId", "inviteLink"}


class TestOrgIsolation:
    """An organization is a wall: a member of one is a stranger to the next."""

    def test_a_member_of_another_org_is_refused_everywhere(self, classroom, client_for):
        stranger = client_for(classroom.stranger)
        org = classroom.org.id
        student_m = classroom.student_m.id
        for method, path in (
            ("get", f"/api/orgs/{org}/members"),
            ("post", f"/api/orgs/{org}/members"),
            ("patch", f"/api/orgs/{org}/members/{student_m}"),
            ("post", f"/api/orgs/{org}/members/{student_m}/reset-password"),
            ("get", f"/api/orgs/{org}/policy"),
            ("put", f"/api/orgs/{org}/policy"),
            ("put", f"/api/orgs/{org}/members/{student_m}/policy"),
            ("get", f"/api/orgs/{org}/students/{student_m}/analyses"),
        ):
            call = getattr(stranger, method)
            response = call(path, {}, format="json") if method != "get" else call(path)
            assert response.status_code == 403, path

    def test_an_org_that_does_not_exist_is_refused_too(self, classroom, as_admin):
        assert as_admin.get("/api/orgs/999999/members").status_code == 403

    def test_a_deactivated_member_loses_their_role(self, classroom, client_for):
        Membership.objects.filter(pk=classroom.admin_m.id).update(active=False)
        assert client_for(classroom.admin).get(members_url(classroom)).status_code == 403
