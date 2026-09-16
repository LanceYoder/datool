"""Whose analysis is it, and what may they start from (§5, §6, §7).

Three things at once, because they are one story: an analysis belongs to the
person who made it, a professor may read (never write) their own students', and
the first-pass tier a student may choose is what their policy says.
"""

import pytest
from django.core.management import CommandError, call_command

from da.models import Analysis, Membership
from da.policies import DEFAULT_POLICY

from .conftest import JOHN_1_1, small_document

pytestmark = pytest.mark.django_db


def make_analysis(owner, document, title="Theirs") -> Analysis:
    return Analysis.objects.create(owner=owner, title=title, document=document)


class TestOwnership:
    def test_the_listing_shows_only_your_own(
        self, classroom, client_for, individual, john_1_1
    ):
        document = small_document(john_1_1)
        make_analysis(classroom.student, document, "the student's")
        make_analysis(individual, document, "the individual's")

        assert [row["title"] for row in client_for(individual).get("/api/analyses").json()] == [
            "the individual's"
        ]
        assert [row["title"] for row in client_for(classroom.student).get("/api/analyses").json()] == [
            "the student's"
        ]

    def test_a_created_analysis_is_yours(self, client, individual, john_1_1):
        created = client.post(
            "/api/analyses", {"document": small_document(john_1_1)}, format="json"
        )
        assert created.status_code == 201
        assert Analysis.objects.get(pk=created.json()["id"]).owner_id == individual.id

    def test_someone_elses_analysis_reads_as_absent(
        self, classroom, client_for, individual, john_1_1
    ):
        """404, not 403 — a stranger must not learn that the id exists."""
        theirs = make_analysis(classroom.student, small_document(john_1_1))
        outsider = client_for(individual)
        assert outsider.get(f"/api/analyses/{theirs.id}").status_code == 404
        assert outsider.put(
            f"/api/analyses/{theirs.id}", {"title": "mine now"}, format="json"
        ).status_code == 404
        assert outsider.delete(f"/api/analyses/{theirs.id}").status_code == 404
        theirs.refresh_from_db()
        assert theirs.title == "Theirs"
        assert theirs.deleted_at is None

    def test_the_trash_is_yours_alone(self, classroom, client_for, individual, john_1_1):
        theirs = make_analysis(classroom.student, small_document(john_1_1))
        client_for(classroom.student).delete(f"/api/analyses/{theirs.id}")

        outsider = client_for(individual)
        assert outsider.get("/api/analyses/deleted").json() == []
        assert outsider.post(f"/api/analyses/{theirs.id}/restore").status_code == 404
        assert client_for(classroom.student).post(
            f"/api/analyses/{theirs.id}/restore"
        ).status_code == 200


class TestProfessorReadsTheirStudents:
    def test_a_professor_may_open_it_but_not_change_it(
        self, classroom, client_for, john_1_1
    ):
        """§2's default: read-only. The work stays the student's."""
        theirs = make_analysis(classroom.student, small_document(john_1_1))
        professor = client_for(classroom.professor)

        opened = professor.get(f"/api/analyses/{theirs.id}")
        assert opened.status_code == 200
        assert opened.json()["title"] == "Theirs"

        assert professor.put(
            f"/api/analyses/{theirs.id}", {"title": "corrected"}, format="json"
        ).status_code == 404
        assert professor.delete(f"/api/analyses/{theirs.id}").status_code == 404
        theirs.refresh_from_db()
        assert theirs.title == "Theirs"

    def test_and_it_does_not_join_their_own_listing(self, classroom, client_for, john_1_1):
        make_analysis(classroom.student, small_document(john_1_1))
        assert client_for(classroom.professor).get("/api/analyses").json() == []

    @pytest.mark.parametrize("who", ["other_professor", "admin", "stranger"])
    def test_nobody_else_may_open_it(self, classroom, client_for, john_1_1, who):
        """Not another professor, and NOT the admin — §2 says an admin manages
        membership and reads no one's analyses."""
        theirs = make_analysis(classroom.student, small_document(john_1_1))
        response = client_for(getattr(classroom, who)).get(f"/api/analyses/{theirs.id}")
        assert response.status_code == 404

    def test_a_deactivated_student_is_no_longer_read(self, classroom, client_for, john_1_1):
        theirs = make_analysis(classroom.student, small_document(john_1_1))
        Membership.objects.filter(pk=classroom.student_m.id).update(active=False)
        assert client_for(classroom.professor).get(
            f"/api/analyses/{theirs.id}"
        ).status_code == 404

    def test_the_listing_and_the_analysis_agree_about_a_deactivated_student(
        self, classroom, client_for, john_1_1
    ):
        """Two rules for one relationship used to give two answers: the
        professor saw a list of titles they could not open. One rule now
        (permissions.teaches / professor_of), so both doors shut together."""
        theirs = make_analysis(classroom.student, small_document(john_1_1), "closed")
        Membership.objects.filter(pk=classroom.student_m.id).update(active=False)
        professor = client_for(classroom.professor)
        listing = professor.get(
            f"/api/orgs/{classroom.org.id}/students/{classroom.student_m.id}/analyses"
        )
        assert listing.status_code == 403
        assert professor.get(f"/api/analyses/{theirs.id}").status_code == 404

    def test_an_unaccepted_invitation_opens_nothing(
        self, classroom, client_for, individual, john_1_1
    ):
        """An individual's own work stays theirs while an invitation to join
        the class is unanswered — the listing and the analysis alike."""
        theirs = make_analysis(individual, small_document(john_1_1), "before")
        pending = Membership.objects.create(
            user=individual,
            organization=classroom.org,
            role=Membership.STUDENT,
            professor=classroom.professor_m,
            accepted_at=None,
        )
        professor = client_for(classroom.professor)
        assert professor.get(
            f"/api/orgs/{classroom.org.id}/students/{pending.id}/analyses"
        ).status_code == 403
        assert professor.get(f"/api/analyses/{theirs.id}").status_code == 404


class TestStudentAnalysesListing:
    def url(self, classroom, membership) -> str:
        return f"/api/orgs/{classroom.org.id}/students/{membership.id}/analyses"

    def test_a_professor_lists_one_students_work(self, classroom, client_for, john_1_1):
        document = small_document(john_1_1)
        make_analysis(classroom.student, document, "first")
        trashed = make_analysis(classroom.student, document, "trashed")
        client_for(classroom.student).delete(f"/api/analyses/{trashed.id}")
        make_analysis(classroom.other_student, document, "not theirs")

        rows = client_for(classroom.professor).get(self.url(classroom, classroom.student_m))
        assert rows.status_code == 200
        assert [row["title"] for row in rows.json()] == ["first"]
        assert set(rows.json()[0]) == {"id", "title", "passageRef", "updatedAt", "ownerId"}

    def test_only_their_own_students(self, classroom, client_for):
        response = client_for(classroom.professor).get(
            self.url(classroom, classroom.other_student_m)
        )
        assert response.status_code == 403

    @pytest.mark.parametrize("who", ["admin", "student", "stranger"])
    def test_nobody_else_may_list(self, classroom, client_for, who):
        response = client_for(getattr(classroom, who)).get(
            self.url(classroom, classroom.student_m)
        )
        assert response.status_code == 403


class TestFirstPassTiers:
    def test_the_tier_field_replaces_the_boolean(self, client):
        """'maximal' survives as an alias, on the tier field and as the old
        boolean, so a client from before the rename keeps working."""
        pytest.importorskip("da.firstpass")
        forests = {}
        for payload in (
            {"text": JOHN_1_1, "tier": "full"},
            {"text": JOHN_1_1, "tier": "maximal"},
            {"text": JOHN_1_1, "maximal": True},
        ):
            response = client.post("/api/first-pass", payload, format="json")
            assert response.status_code == 200
            forests[str(payload)] = response.json()["document"]["forest"]
        assert len({str(f) for f in forests.values()}) == 1

    def test_the_none_tier_proposes_nothing(self, client):
        """Every proposition a root: the student builds the whole tree (§5)."""
        pytest.importorskip("da.firstpass")
        response = client.post(
            "/api/first-pass", {"text": "1 John 1:5-7", "tier": "none"}, format="json"
        )
        assert response.status_code == 200
        document = response.json()["document"]
        ids = [p["id"] for p in document["propositions"]]
        assert len(ids) > 1
        assert document["forest"] == [{"kind": "prop", "ref": i} for i in ids]

        # The alignment and the text flow are untouched by the tier.
        minimal = client.post(
            "/api/first-pass", {"text": "1 John 1:5-7", "tier": "minimal"}, format="json"
        ).json()
        assert response.json()["alignment"] == minimal["alignment"]
        assert document["textFlow"] == minimal["document"]["textFlow"]
        assert [p["id"] for p in minimal["document"]["propositions"]] == ids
        # …and 'minimal' does propose something, or this proves nothing.
        assert minimal["document"]["forest"] != document["forest"]

    def test_an_unknown_tier_is_a_400(self, client):
        response = client.post(
            "/api/first-pass", {"text": JOHN_1_1, "tier": "gentle"}, format="json"
        )
        assert response.status_code == 400
        assert response.json()["errors"] == ["tier must be one of none, minimal, full"]

    def test_a_policy_narrows_what_a_student_may_ask_for(
        self, classroom, client_for, set_policy
    ):
        pytest.importorskip("da.firstpass")
        set_policy(classroom.professor_m, {"firstPass": {"allowed": ["minimal"]}})
        student = client_for(classroom.student)

        refused = student.post(
            "/api/first-pass", {"text": JOHN_1_1, "tier": "full"}, format="json"
        )
        assert refused.status_code == 403
        assert "do not allow the 'full' first pass" in refused.json()["errors"][0]
        # The deprecated boolean cannot slip past it either.
        assert student.post(
            "/api/first-pass", {"text": JOHN_1_1, "maximal": True}, format="json"
        ).status_code == 403

        assert student.post(
            "/api/first-pass", {"text": JOHN_1_1, "tier": "minimal"}, format="json"
        ).status_code == 200

    def test_an_override_can_give_a_tier_back(self, classroom, client_for, set_policy):
        pytest.importorskip("da.firstpass")
        set_policy(classroom.professor_m, {"firstPass": {"allowed": ["none"]}})
        classroom.student_m.policy_override = {"firstPass": {"allowed": ["none", "full"]}}
        classroom.student_m.save()
        assert client_for(classroom.student).post(
            "/api/first-pass", {"text": JOHN_1_1, "tier": "full"}, format="json"
        ).status_code == 200

    def test_with_one_tier_allowed_a_silent_request_still_works(
        self, classroom, client_for, set_policy, monkeypatch
    ):
        """The picker is hidden when only one tier is allowed; a client that
        sends no tier at all gets that one rather than a refusal."""
        set_policy(classroom.professor_m, {"firstPass": {"allowed": ["none"]}})
        calls = []
        import da.firstpass as firstpass_module

        def fake_first_pass(text, maximal=False, *, tier="minimal"):
            calls.append(tier)
            return firstpass_module.FirstPassResult(
                {"schemaVersion": 2,
                 "propositions": [{"id": "p1", "label": "1",
                                   "source": {"kind": "raw", "text": "x"}}],
                 "forest": [{"kind": "prop", "ref": "p1"}]},
                None,
            )

        monkeypatch.setattr(firstpass_module, "first_pass", fake_first_pass)
        assert client_for(classroom.student).post(
            "/api/first-pass", {"text": JOHN_1_1}, format="json"
        ).status_code == 200
        assert calls == ["none"]

    def test_a_professor_and_an_individual_are_not_gated(
        self, classroom, client_for, set_policy, client
    ):
        pytest.importorskip("da.firstpass")
        set_policy(classroom.professor_m, {"firstPass": {"allowed": ["none"]}})
        for caller in (client, client_for(classroom.professor)):
            assert caller.post(
                "/api/first-pass", {"text": JOHN_1_1, "tier": "full"}, format="json"
            ).status_code == 200


class TestCreateRecordsTheRules:
    def test_the_tier_and_the_policy_are_stored(
        self, classroom, client_for, set_policy, john_1_1
    ):
        set_policy(classroom.professor_m, {"aids": {"english": False}})
        created = client_for(classroom.student).post(
            "/api/analyses",
            {"document": small_document(john_1_1), "tier": "minimal"},
            format="json",
        )
        assert created.status_code == 201
        analysis = Analysis.objects.get(pk=created.json()["id"])
        assert analysis.first_pass_tier == "minimal"
        assert analysis.policy_snapshot["aids"]["english"] is False
        assert analysis.policy_snapshot["firstPass"] == DEFAULT_POLICY["firstPass"]
        assert set(analysis.policy_snapshot) == set(DEFAULT_POLICY)
        # The audit trail is server-side: neither the tier nor the policy
        # snapshot is on the wire. `ownerId` is — it is how the SPA knows to
        # open somebody else's analysis read-only (§2, §6).
        assert set(created.json()) == {
            "id", "title", "passageRef", "document", "notes", "updatedAt", "ownerId"
        }

    def test_an_individual_stores_a_tier_and_no_policy(self, client, john_1_1):
        created = client.post(
            "/api/analyses",
            {"document": small_document(john_1_1), "tier": "maximal"},
            format="json",
        ).json()
        analysis = Analysis.objects.get(pk=created["id"])
        assert analysis.first_pass_tier == "full"  # the alias is resolved
        assert analysis.policy_snapshot is None

    def test_no_tier_given_records_none_of_it(self, client, john_1_1):
        created = client.post(
            "/api/analyses", {"document": small_document(john_1_1)}, format="json"
        ).json()
        assert Analysis.objects.get(pk=created["id"]).first_pass_tier == ""

    def test_a_forbidden_tier_is_refused(
        self, classroom, client_for, set_policy, john_1_1
    ):
        set_policy(classroom.professor_m, {"firstPass": {"allowed": ["none"]}})
        response = client_for(classroom.student).post(
            "/api/analyses",
            {"document": small_document(john_1_1), "tier": "full"},
            format="json",
        )
        assert response.status_code == 403
        assert Analysis.objects.count() == 0

    def test_an_unknown_tier_is_a_400(self, client, john_1_1):
        response = client.post(
            "/api/analyses",
            {"document": small_document(john_1_1), "tier": "gentle"},
            format="json",
        )
        assert response.status_code == 400
        assert Analysis.objects.count() == 0


class TestAssignOrphans:
    """§7: the 43 analyses made before accounts existed, handed over."""

    def orphan(self, john_1_1, **kwargs) -> Analysis:
        return Analysis.objects.create(
            owner=None, title="from local mode", document=small_document(john_1_1),
            **kwargs,
        )

    def test_every_ownerless_analysis_moves(self, individual, john_1_1, capsys):
        from django.utils import timezone

        live = self.orphan(john_1_1)
        trashed = self.orphan(john_1_1, deleted_at=timezone.now())
        mine = make_analysis(individual, small_document(john_1_1), "already mine")

        call_command("assign_orphans", "--to", "solo@example.com")
        live.refresh_from_db()
        trashed.refresh_from_db()
        assert live.owner_id == individual.id
        assert trashed.owner_id == individual.id  # the trash goes too
        assert Analysis.objects.filter(owner__isnull=True).count() == 0
        assert "gave 2 analyses" in capsys.readouterr().out
        assert mine.owner_id == individual.id

    def test_it_matches_the_email_in_any_case(self, make_user, john_1_1, capsys):
        student = make_user("smith@example.com")
        self.orphan(john_1_1)
        call_command("assign_orphans", "--to", "SMITH@Example.com")
        assert Analysis.objects.get().owner_id == student.id

    def test_a_dry_run_changes_nothing(self, individual, john_1_1, capsys):
        self.orphan(john_1_1)
        call_command("assign_orphans", "--to", "solo@example.com", "--dry-run")
        assert "would give 1 ownerless" in capsys.readouterr().out
        assert Analysis.objects.filter(owner__isnull=True).count() == 1

    def test_an_unknown_account_is_an_error(self, john_1_1):
        self.orphan(john_1_1)
        with pytest.raises(CommandError):
            call_command("assign_orphans", "--to", "nobody@example.com")
        assert Analysis.objects.filter(owner__isnull=True).count() == 1

    def test_nothing_to_do_is_said_plainly(self, individual, capsys):
        call_command("assign_orphans", "--to", "solo@example.com")
        assert "no ownerless analyses" in capsys.readouterr().out

    def test_the_report_script_names_them_and_changes_nothing(
        self, individual, john_1_1, capsys
    ):
        orphan = self.orphan(john_1_1)
        make_analysis(individual, small_document(john_1_1), "mine")
        from da.scripts import orphan_report

        assert orphan_report.report() == 1  # the exit code's verdict
        printed = capsys.readouterr().out
        assert str(orphan.id) in printed
        assert "2 analyses: 1 owned, 1 ownerless" in printed
        assert "solo@example.com: 1" in printed
        orphan.refresh_from_db()
        assert orphan.owner_id is None
