"""The §9 walkthrough, driven through the API exactly as the SPA drives it.

docs/accounts-spec.md §9 names the one scenario that decides whether accounts
work: an analyst registers, site staff set their class up for them and they
accept it, they provision a professor and a student — both by email, the one
way there is (ruled 2026-09-16) — the professor sets rules, and the student
then lives inside them while the
professor reads over their shoulder and no one else sees anything at all.

The unit tests next door cover each endpoint alone. This one covers the SEAMS —
the places the two halves of the feature have to agree:

* the CSRF handshake `frontend/src/api.ts` performs (bootstrap the cookie, echo
  it in ``X-CSRFToken`` on every write) is enough to drive the whole flow;
* the JSON on the wire is the camelCase shape ``frontend/src/types.ts``
  declares — asserted as whole key sets, so a field that quietly appears or
  disappears fails here rather than in the browser;
* an invitation mail carries a link to the SPA's own ``/reset-password``
  route, and that link ends in a working password;
* a first-pass tier the class rules withhold is refused with 403, and the
  tier and the policy in force are recorded on the analysis that is made;
* a professor's read is a READ: PUT and DELETE answer 404, and the ownerId on
  the row is how the page knows to lock itself before offering a Save.
"""

from io import StringIO

import pytest
from django.conf import settings
from django.core import mail
from django.core.management import call_command

from da.models import Analysis, Organization
from da.policies import DEFAULT_POLICY

from .conftest import JOHN_1_1
from .test_accounts import link_in, uid_and_token

pytestmark = pytest.mark.django_db

#: Distinct, validator-clean passwords — the walk has to tell them apart when
#: it checks that an old one has stopped working.
ANALYST_PASSWORD = "greek-analyst-42"
PROFESSOR_PASSWORD = "koine-professor-77"
PROFESSOR_NEW_PASSWORD = "koine-professor-88"
STUDENT_PASSWORD = "sams-first-word-19"
STUDENT_CHOSEN_PASSWORD = "sams-own-word-19"


class Spa:
    """One browser tab, behaving as ``frontend/src/api.ts`` does.

    The session cookie rides on every request; a mutating one carries the CSRF
    token, bootstrapping it from ``GET /api/auth/csrf`` when the cookie is not
    there yet — which is the very thing api.ts does before its first POST. CSRF
    checks are ENFORCED here (unlike the other test clients), because half the
    point of this file is that the handshake is sufficient.
    """

    def __init__(self):
        from rest_framework.test import APIClient

        self.client = APIClient(enforce_csrf_checks=True)

    def _token(self) -> str:
        cookie = self.client.cookies.get("csrftoken")
        if cookie is None:
            self.client.get("/api/auth/csrf")
            cookie = self.client.cookies.get("csrftoken")
        return cookie.value

    def get(self, path):
        return self.client.get(path)

    def _write(self, method: str, path: str, payload=None):
        return getattr(self.client, method)(
            path,
            {} if payload is None else payload,
            format="json",
            HTTP_X_CSRFTOKEN=self._token(),
        )

    def post(self, path, payload=None):
        return self._write("post", path, payload)

    def put(self, path, payload=None):
        return self._write("put", path, payload)

    def patch(self, path, payload=None):
        return self._write("patch", path, payload)

    def delete(self, path):
        return self.client.delete(path, HTTP_X_CSRFTOKEN=self._token())


#: ``invitations`` is beyond §6's list for /auth/me: an invitation to an
#: account that already exists is not a membership until it is accepted, and
#: the two must not be shown in one array (see da/models.Membership).
ME_KEYS = {"id", "email", "name", "memberships", "invitations", "policy", "isStaff"}
MEMBERSHIP_KEYS = {"membershipId", "org", "role", "professor", "active"}
#: ``pending`` likewise: a roster has to be able to say "invited, not yet a
#: member" rather than show somebody who has agreed to nothing.
MEMBER_KEYS = {
    "membershipId", "user", "role", "professor", "active",
    "policyOverride", "pending", "provisioned",
}
MEMBER_USER_KEYS = {"id", "email", "name"}
#: What provisioning answers — the same three keys whether or not the
#: address already had an account, so the form cannot look people up.
INVITED_KEYS = {"invited", "membershipId", "inviteLink"}
ANALYSIS_ROW_KEYS = {"id", "title", "passageRef", "updatedAt", "ownerId"}
ANALYSIS_DETAIL_KEYS = ANALYSIS_ROW_KEYS | {"document", "notes"}


def test_spec9_walkthrough(john_1_1):
    """Every step of §9, in order, through the HTTP API and nothing else."""
    pytest.importorskip("da.firstpass")

    # -- 1. the bootstrap ---------------------------------------------------
    # The SPA's first call of a cold page load. It sets the cookie every write
    # below depends on.
    analyst = Spa()
    bootstrap = analyst.get("/api/auth/csrf")
    assert bootstrap.status_code == 200
    assert bootstrap.json() == {"ok": True}
    assert "csrftoken" in analyst.client.cookies

    # -- 2. register -------------------------------------------------------
    registered = analyst.post(
        "/api/auth/register",
        {"email": "Dean@Example.com", "password": ANALYST_PASSWORD, "name": "Dee Ann"},
    )
    assert registered.status_code == 201
    me = registered.json()
    assert set(me) == ME_KEYS
    # An INDIVIDUAL account (§2): the address is the login, and there are no
    # rules over them at all. Django normalizes only the DOMAIN half of an
    # address, so `email` keeps the case it was typed in; it signs in in any
    # case (§3).
    assert me["email"] == "Dean@example.com"
    assert me["name"] == "Dee Ann"
    assert me["memberships"] == []
    assert me["policy"] is None
    assert me["isStaff"] is False
    # Registering signs you in — the SPA navigates straight to the home page.
    assert analyst.get("/api/auth/me").json()["id"] == me["id"]
    # And the address signs in whatever case it is typed in.
    case_check = Spa()
    assert case_check.post(
        "/api/auth/login", {"email": "DEAN@EXAMPLE.COM", "password": ANALYST_PASSWORD}
    ).status_code == 200

    # -- 3. the organization is set up FOR them ----------------------------
    # There is no way to make one from the app (§2, ruled 2026-09-12): the
    # school reached out, and site staff ran the command with the dean's
    # address. The dean already has an account, so what they get is an
    # INVITATION — nothing about their account changes until they accept it.
    assert analyst.post("/api/orgs", {"name": "Greek 101"}).status_code == 404
    mail.outbox.clear()
    call_command("create_org", name="Greek 101", admin="dean@example.com", stdout=StringIO())
    org_row = Organization.objects.get(slug="greek-101")
    org = {"id": org_row.id, "name": "Greek 101", "slug": "greek-101"}
    org_url = f"/api/orgs/{org['id']}"
    assert len(mail.outbox) == 1
    assert "Greek 101" in mail.outbox[0].subject

    me = analyst.get("/api/auth/me").json()
    assert me["memberships"] == []  # not yet: an invitation is not a membership
    assert [i["org"] for i in me["invitations"]] == [org]
    invitation_id = me["invitations"][0]["membershipId"]

    # The handshake is not decorative: the same write without the header is
    # refused, which is why api.ts bootstraps the cookie before its first POST.
    naked = analyst.client.post(
        f"/api/invitations/{invitation_id}/accept", {}, format="json"
    )
    assert naked.status_code == 403
    assert naked.json()["errors"]

    accepted = analyst.post(f"/api/invitations/{invitation_id}/accept")
    assert accepted.status_code == 200
    assert set(accepted.json()) == ME_KEYS

    mine = analyst.get("/api/orgs/mine").json()
    assert len(mine) == 1
    assert set(mine[0]) == MEMBERSHIP_KEYS
    assert mine[0]["role"] == "admin"  # the account the staff named is the first admin
    assert mine[0]["org"] == org
    assert mine[0]["professor"] is None
    assert mine[0]["active"] is True
    # …and /auth/me says the same thing, which is what the header renders from.
    assert analyst.get("/api/auth/me").json()["memberships"] == mine

    # -- 4. provision the professor by email -------------------------------
    mail.outbox.clear()
    provisioned = analyst.post(
        f"{org_url}/members",
        {"role": "professor", "email": "prof@example.com", "name": "Pro Fessor"},
    )
    assert provisioned.status_code == 201
    invited = provisioned.json()
    assert set(invited) == INVITED_KEYS
    assert invited["invited"] is True
    # The mail went, so there is nothing for the admin to hand over.
    assert invited["inviteLink"] is None
    professor_mid = invited["membershipId"]
    # The roster shows the row the answer did not describe.
    professor_row = next(
        m for m in analyst.get(f"{org_url}/members").json()
        if m["membershipId"] == professor_mid
    )
    assert set(professor_row) == MEMBER_KEYS
    assert professor_row["role"] == "professor"
    assert professor_row["provisioned"] is True
    assert professor_row["professor"] is None
    assert professor_row["policyOverride"] is None

    assert len(mail.outbox) == 1
    invitation = mail.outbox[0]
    assert invitation.to == ["prof@example.com"]
    link = link_in(invitation)
    # The link points at the SPA's own route (App.tsx: /reset-password/:uid/:token).
    assert link.startswith(f"{settings.FRONTEND_ORIGIN.rstrip('/')}/reset-password/")
    uid, token = uid_and_token(link)

    # The professor opens the link in a tab of their own and sets a password.
    professor = Spa()
    accepted = professor.post(
        "/api/auth/password/reset",
        {"uid": uid, "token": token, "password": PROFESSOR_PASSWORD},
    )
    assert accepted.status_code == 200
    assert accepted.json() == {"ok": True}

    signed_in = professor.post(
        "/api/auth/login",
        {"email": "prof@example.com", "password": PROFESSOR_PASSWORD},
    )
    assert signed_in.status_code == 200
    professor_me = signed_in.json()
    assert set(professor_me) == ME_KEYS
    assert professor_me["memberships"][0]["membershipId"] == professor_mid
    assert professor_me["memberships"][0]["role"] == "professor"
    # A professor has no policy of their own; the editor treats null as
    # "everything allowed".
    assert professor_me["policy"] is None

    # -- 5. provision the student, by email too ----------------------------
    mail.outbox.clear()
    provisioned = analyst.post(
        f"{org_url}/members",
        {"role": "student", "email": "smith@example.com", "name": "Sam Smith"},
    )
    assert provisioned.status_code == 201
    invited = provisioned.json()
    assert set(invited) == INVITED_KEYS
    assert invited["inviteLink"] is None  # the mail went
    student_mid = invited["membershipId"]
    student_row = next(
        m for m in analyst.get(f"{org_url}/members").json()
        if m["membershipId"] == student_mid
    )
    assert set(student_row) == MEMBER_KEYS
    assert student_row["role"] == "student"
    assert student_row["provisioned"] is True
    # The nested user object, whole (types.ts: MemberUser).
    assert set(student_row["user"]) == MEMBER_USER_KEYS
    assert student_row["user"]["name"] == "Sam Smith"
    assert student_row["user"]["email"] == "smith@example.com"
    assert student_row["professor"] is None  # not assigned yet
    # The set-password mail is the student's one way in; it names the login.
    assert len(mail.outbox) == 1
    assert mail.outbox[0].to == ["smith@example.com"]
    assert "Your login is smith@example.com" in mail.outbox[0].body
    student_uid, student_token = uid_and_token(link_in(mail.outbox[0]))

    # -- 6. assign the student to the professor ----------------------------
    assigned = analyst.patch(
        f"{org_url}/members/{student_mid}", {"professor": professor_mid}
    )
    assert assigned.status_code == 200
    assert set(assigned.json()) == MEMBER_KEYS
    # The professor comes back NAMED, not as a bare id: that is what the
    # roster's "with Pro Fessor" line reads.
    # Note the asymmetry the SPA has to know about: a professor is ASSIGNED by
    # bare membership id, and comes back as an object (types.ts: ProfessorRef).
    assert assigned.json()["professor"] == {"id": professor_mid, "name": "Pro Fessor"}

    # The professor's own roster now shows themselves and that one student —
    # and not the dean who made them (§6).
    roster = professor.get(f"{org_url}/members")
    assert roster.status_code == 200
    assert {row["membershipId"] for row in roster.json()} == {
        professor_mid, student_mid
    }
    assert all(set(row) == MEMBER_KEYS for row in roster.json())

    # -- 7. the rules ------------------------------------------------------
    # Untouched, a professor's default is the permissive one — an individual's
    # experience — which is what the switches on /teach open showing.
    opened = professor.get(f"{org_url}/policy")
    assert opened.status_code == 200
    assert opened.json() == {"policy": DEFAULT_POLICY}

    # §9's policy: one tier only, no English line. Sent partially, exactly as
    # a professor who flipped two switches would send it.
    stored = professor.put(
        f"{org_url}/policy",
        {
            "policy": {
                "firstPass": {"allowed": ["minimal"]},
                "aids": {"english": False},
            }
        },
    )
    assert stored.status_code == 200
    default_policy = stored.json()["policy"]
    assert default_policy["firstPass"] == {"allowed": ["minimal"]}
    assert default_policy["aids"] == {
        "english": False, "verses": True, "verbs": True, "colorCoding": True
    }
    # A partial PUT is filled in from the permissive default, never emptied —
    # and these two groups are the WHOLE policy (§5, ruled 2026-09-12): the
    # gestures are not in it, because they are not a professor's to withhold.
    assert set(default_policy) == set(DEFAULT_POLICY) == {"firstPass", "aids"}
    assert professor.get(f"{org_url}/policy").json()["policy"] == default_policy

    # The switches the first build had for the gestures are gone for good: a
    # stale tab sending one is told why, not merely "unknown key".
    stale = professor.put(f"{org_url}/policy", {"policy": {"tree": {"delete": False}}})
    assert stale.status_code == 400
    assert stale.json()["errors"] == [
        "tree is no longer a class rule — it is always available"
    ]
    assert professor.get(f"{org_url}/policy").json()["policy"] == default_policy

    # And one thing for this student alone.
    overridden = professor.put(
        f"{org_url}/members/{student_mid}/policy",
        {"override": {"aids": {"verbs": False}}},
    )
    assert overridden.status_code == 200
    assert set(overridden.json()) == {"override", "policy"}
    assert overridden.json()["override"] == {"aids": {"verbs": False}}
    effective = overridden.json()["policy"]
    assert effective["aids"]["verbs"] is False  # the override wins
    assert effective["aids"]["english"] is False  # the default still shows through
    # The override reads back on the roster row, which is where /teach finds it.
    row = next(
        r for r in professor.get(f"{org_url}/members").json()
        if r["membershipId"] == student_mid
    )
    assert row["policyOverride"] == {"aids": {"verbs": False}}

    # -- 8. the student sets a password from the link, and signs in --------
    student = Spa()
    assert student.post(
        "/api/auth/password/reset",
        {"uid": student_uid, "token": student_token, "password": STUDENT_PASSWORD},
    ).status_code == 200
    signed_in = student.post(
        "/api/auth/login", {"email": "smith@example.com", "password": STUDENT_PASSWORD}
    )
    assert signed_in.status_code == 200
    student_me = signed_in.json()
    assert set(student_me) == ME_KEYS
    assert student_me["email"] == "smith@example.com"
    assert student_me["memberships"][0]["professor"] == {
        "id": professor_mid, "name": "Pro Fessor"
    }
    # The whole point: /auth/me carries the EFFECTIVE policy, so the editor can
    # gate itself on the first paint without a second round trip.
    policy = student_me["policy"]
    assert policy is not None
    assert set(policy) == set(DEFAULT_POLICY)
    assert policy["firstPass"]["allowed"] == ["minimal"]
    assert policy["aids"]["english"] is False
    assert policy["aids"]["verbs"] is False

    # -- 9. the first pass is held to those rules --------------------------
    refused = student.post("/api/first-pass", {"text": JOHN_1_1, "tier": "full"})
    assert refused.status_code == 403
    assert refused.json() == {
        "errors": [
            "your class rules do not allow the 'full' first pass (allowed: minimal)"
        ]
    }
    # 'none' is withheld too — the picker on the home page is hidden entirely
    # when a policy allows exactly one tier.
    assert student.post(
        "/api/first-pass", {"text": JOHN_1_1, "tier": "none"}
    ).status_code == 403
    # Nonsense is a 400, not a 403: the request is wrong, not disallowed.
    assert student.post(
        "/api/first-pass", {"text": JOHN_1_1, "tier": "wizardry"}
    ).status_code == 400

    allowed = student.post("/api/first-pass", {"text": JOHN_1_1, "tier": "minimal"})
    assert allowed.status_code == 200
    assert set(allowed.json()) == {"document", "alignment"}
    document = allowed.json()["document"]
    assert document["schemaVersion"] == 2

    # -- 10. the student makes and saves an analysis -----------------------
    made = student.post(
        "/api/analyses",
        {"title": "John 1:1", "document": document, "firstPassTier": "minimal"},
    )
    assert made.status_code == 201
    analysis = made.json()
    assert set(analysis) == ANALYSIS_DETAIL_KEYS
    assert analysis["ownerId"] == student_me["id"]
    analysis_url = f"/api/analyses/{analysis['id']}"

    # The row remembers which first pass it started from AND the rules that
    # were in force (§6) — the audit trail, never on the wire.
    row = Analysis.objects.get(pk=analysis["id"])
    assert row.owner_id == student_me["id"]
    assert row.first_pass_tier == "minimal"
    assert row.policy_snapshot["aids"]["english"] is False
    assert row.policy_snapshot["aids"]["verbs"] is False

    # A withheld tier is refused at creation too, not only at the first pass.
    denied = student.post(
        "/api/analyses",
        {"title": "sneaky", "document": document, "firstPassTier": "full"},
    )
    assert denied.status_code == 403
    assert Analysis.objects.filter(title="sneaky").count() == 0

    # Saving is the ordinary PUT the editor makes.
    saved = student.put(
        analysis_url, {"title": "John 1:1 — the Word", "notes": "and the Word was God"}
    )
    assert saved.status_code == 200
    assert saved.json()["title"] == "John 1:1 — the Word"

    # It is the student's own listing, and nobody else's is in it.
    listing = student.get("/api/analyses").json()
    assert [r["id"] for r in listing] == [analysis["id"]]
    assert set(listing[0]) == ANALYSIS_ROW_KEYS

    # -- 11. the professor reads it, and only reads it ---------------------
    students_work = professor.get(f"{org_url}/students/{student_mid}/analyses")
    assert students_work.status_code == 200
    assert [r["id"] for r in students_work.json()] == [analysis["id"]]
    assert set(students_work.json()[0]) == ANALYSIS_ROW_KEYS

    opened = professor.get(analysis_url)
    assert opened.status_code == 200
    assert opened.json()["notes"] == "and the Word was God"
    # How the page knows to lock itself BEFORE offering a Save the server would
    # refuse: the row says whose it is.
    assert opened.json()["ownerId"] != professor_me["id"]

    assert professor.put(analysis_url, {"title": "mine now"}).status_code == 404
    assert professor.delete(analysis_url).status_code == 404
    # Reading a student's work does not put it in the professor's own list.
    assert professor.get("/api/analyses").json() == []
    # Nor does the admin who provisioned everybody get to read it (§2).
    assert analyst.get(analysis_url).status_code == 404
    assert analyst.get(f"{org_url}/students/{student_mid}/analyses").status_code == 403

    # -- 12. a stranger, and nobody at all ---------------------------------
    stranger = Spa()
    assert stranger.post(
        "/api/auth/register",
        {"email": "stranger@example.com", "password": "outside-the-class-31"},
    ).status_code == 201
    assert stranger.get(analysis_url).status_code == 404  # 404, never 403: no id leaks
    assert stranger.put(analysis_url, {"title": "mine"}).status_code == 404
    assert stranger.get(f"{org_url}/members").status_code == 403
    assert stranger.get(f"{org_url}/students/{student_mid}/analyses").status_code == 403
    assert stranger.put(f"{org_url}/policy", {"policy": {}}).status_code == 403

    from rest_framework.test import APIClient

    nobody = APIClient()
    unauthenticated = nobody.get("/api/analyses")
    # 401, not DRF's bare 403 — it is the signal the SPA redirects to /login on.
    assert unauthenticated.status_code == 401
    assert unauthenticated.json()["errors"]  # the project's error shape, always
    assert nobody.get("/api/auth/me").status_code == 401
    # Including the org endpoints, whose own permission class replaces the
    # project default: a session that expires while a professor is on /teach
    # must BOUNCE them to /login, not tell them they lack a role they have.
    assert nobody.get(f"{org_url}/members").status_code == 401
    assert nobody.get(f"{org_url}/policy").status_code == 401

    # -- 13. the student changes their own password ------------------------
    changed = student.post(
        "/api/auth/password/change",
        {"current": STUDENT_PASSWORD, "password": STUDENT_CHOSEN_PASSWORD},
    )
    assert changed.status_code == 200
    # Changing it does not sign them out of the tab they did it in.
    assert student.get("/api/auth/me").status_code == 200
    assert student.post(
        "/api/auth/password/change",
        {"current": STUDENT_PASSWORD, "password": "another-one-52"},
    ).status_code == 400

    fresh_tab = Spa()
    assert fresh_tab.post(
        "/api/auth/login",
        {"email": "smith@example.com", "password": STUDENT_CHOSEN_PASSWORD},
    ).status_code == 200

    # -- 14. the password-reset round trip ---------------------------------
    mail.outbox.clear()
    forgot = Spa()
    asked = forgot.post("/api/auth/password/forgot", {"email": "prof@example.com"})
    assert asked.status_code == 200
    assert asked.json() == {"ok": True}
    assert len(mail.outbox) == 1
    uid, token = uid_and_token(link_in(mail.outbox[0]))

    reset = forgot.post(
        "/api/auth/password/reset",
        {"uid": uid, "token": token, "password": PROFESSOR_NEW_PASSWORD},
    )
    assert reset.status_code == 200
    # The old password is dead and the new one works.
    assert forgot.post(
        "/api/auth/login",
        {"email": "prof@example.com", "password": PROFESSOR_PASSWORD},
    ).status_code == 400
    back_in = forgot.post(
        "/api/auth/login",
        {"email": "prof@example.com", "password": PROFESSOR_NEW_PASSWORD},
    )
    assert back_in.status_code == 200
    assert back_in.json()["memberships"][0]["membershipId"] == professor_mid
    # A spent token cannot be replayed.
    assert forgot.post(
        "/api/auth/password/reset",
        {"uid": uid, "token": token, "password": "third-time-lucky-63"},
    ).status_code == 400
