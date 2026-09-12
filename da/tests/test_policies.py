"""The teaching policy itself: its shape, its gate, and its resolution (§5).

Unit tests on da/policies.py — the endpoints that carry these values are
tested in test_orgs.py, and what the values DO in test_ownership.py.
"""

import importlib

import pytest
from django.apps import apps

from da.models import Membership, TeachingPolicy
from da.policies import (
    DEFAULT_POLICY,
    RETIRED_GROUPS,
    TIERS,
    PolicyError,
    allowed_tiers,
    default_policy,
    effective_policy,
    merge_policy,
    normalize_tier,
    strip_retired,
    tier_allowed,
    validate_policy,
)


class TestDefault:
    def test_everything_is_allowed_by_default(self):
        """An individual's experience is the baseline a professor takes from."""
        assert DEFAULT_POLICY["firstPass"]["allowed"] == ["none", "minimal", "full"]
        switches = [
            value
            for group, settings in DEFAULT_POLICY.items()
            if group != "firstPass"
            for value in settings.values()
        ]
        assert switches and all(switch is True for switch in switches)

    def test_the_key_set_is_the_spec_s(self):
        """Two groups, by ruling (§5, 2026-09-12): the first-pass tiers and the
        reading aids. The gestures are not a professor's to switch."""
        assert set(DEFAULT_POLICY) == {"firstPass", "aids"}
        assert set(DEFAULT_POLICY["aids"]) == {
            "english", "verses", "verbs", "colorCoding"
        }
        assert set(RETIRED_GROUPS) == {"tree", "split", "sections", "textFlow", "notes"}
        assert not set(RETIRED_GROUPS) & set(DEFAULT_POLICY)

    def test_default_policy_hands_out_copies(self):
        one = default_policy()
        one["aids"]["english"] = False
        assert default_policy()["aids"]["english"] is True
        assert DEFAULT_POLICY["aids"]["english"] is True


class TestValidate:
    def test_a_partial_write_is_filled_out(self):
        policy = validate_policy({"aids": {"english": False}})
        assert policy["aids"] == {"english": False, "verses": True,
                                  "verbs": True, "colorCoding": True}
        assert policy["firstPass"] == DEFAULT_POLICY["firstPass"]

    def test_an_override_keeps_only_what_was_given(self):
        assert validate_policy({"aids": {"english": False}}, partial=True) == {
            "aids": {"english": False}
        }
        assert validate_policy({}, partial=True) == {}

    def test_tiers_are_normalized_and_ordered(self):
        assert validate_policy(
            {"firstPass": {"allowed": ["full", "none", "maximal"]}}
        )["firstPass"]["allowed"] == ["none", "full"]

    @pytest.mark.parametrize(
        "policy, expected",
        [
            ("nope", "policy must be an object"),
            ({"wizardry": {}}, "unknown policy key 'wizardry'"),
            ({"aids": {"teleport": True}}, "unknown policy key aids.teleport"),
            ({"aids": True}, "aids must be an object"),
            ({"aids": {"english": "no"}}, "aids.english must be true or false"),
            ({"aids": {"english": 1}}, "aids.english must be true or false"),
            ({"firstPass": {"allowed": []}}, "firstPass.allowed must be a non-empty"),
            ({"firstPass": {"allowed": "minimal"}}, "firstPass.allowed must be a"),
            ({"firstPass": {"allowed": ["some"]}}, "is not a first-pass tier"),
        ],
    )
    def test_bad_policies_are_refused(self, policy, expected):
        with pytest.raises(PolicyError) as raised:
            validate_policy(policy)
        assert any(expected in problem for problem in raised.value.problems)

    @pytest.mark.parametrize("group", RETIRED_GROUPS)
    def test_a_retired_gesture_rule_is_refused_with_its_reason(self, group):
        """The first build let a professor switch these off; the ruling is
        that they are always available. A stale tab is told exactly that,
        not "unknown key" — and whatever it sent is not stored."""
        with pytest.raises(PolicyError) as raised:
            validate_policy({group: {"enabled": False}})
        assert raised.value.problems == [
            f"{group} is no longer a class rule — it is always available"
        ]
        with pytest.raises(PolicyError):
            validate_policy({group: {}}, partial=True)

    def test_every_problem_is_reported_at_once(self):
        with pytest.raises(PolicyError) as raised:
            validate_policy({"aids": {"english": "no", "verbs": 3}, "wizardry": {}})
        assert len(raised.value.problems) == 3

    def test_a_small_request_cannot_buy_a_huge_answer(self):
        """Twenty thousand unknown keys used to come back as twenty thousand
        error strings — a quarter-megabyte question answered in three quarters
        of a megabyte. The first twenty say everything a professor needs."""
        from da.policies import MAX_PROBLEMS

        with pytest.raises(PolicyError) as raised:
            validate_policy({f"key{n}": {} for n in range(20_000)})
        assert len(raised.value.problems) == MAX_PROBLEMS + 1
        assert "more problems" in raised.value.problems[-1]

    def test_a_tier_list_longer_than_the_tiers_is_refused_outright(self):
        with pytest.raises(PolicyError) as raised:
            validate_policy({"firstPass": {"allowed": ["full"] * 100_000}})
        assert any("non-empty list" in p for p in raised.value.problems)

    def test_a_true_is_not_a_one(self):
        """Python says 1 == True; a policy switch does not."""
        with pytest.raises(PolicyError):
            validate_policy({"aids": {"verbs": 1}})


class TestTiers:
    def test_maximal_is_the_deprecated_alias(self):
        assert normalize_tier("maximal") == "full"
        assert [normalize_tier(t) for t in TIERS] == list(TIERS)

    @pytest.mark.parametrize("raw", ["", "Full ", "none!", 3, None, ["full"]])
    def test_anything_else_is_refused(self, raw):
        if raw == "Full ":
            assert normalize_tier(raw) == "full"  # trimmed and lowercased
            return
        with pytest.raises(PolicyError):
            normalize_tier(raw)

    def test_no_policy_means_every_tier(self):
        assert allowed_tiers(None) == list(TIERS)
        assert tier_allowed(None, "none") is True

    def test_a_policy_narrows_them(self):
        policy = validate_policy({"firstPass": {"allowed": ["minimal"]}})
        assert allowed_tiers(policy) == ["minimal"]
        assert tier_allowed(policy, "minimal") is True
        assert tier_allowed(policy, "full") is False


class TestMerge:
    def test_the_override_wins_key_by_key(self):
        base = validate_policy({"aids": {"english": False, "verbs": False}})
        merged = merge_policy(base, {"aids": {"english": True}})
        assert merged["aids"]["english"] is True   # overridden
        assert merged["aids"]["verbs"] is False    # the professor's default

    def test_stored_rubbish_cannot_crash_a_request(self):
        """Policies are validated on the way in; read back, they are still
        treated as untrusted — a request must never 500 on one."""
        merged = merge_policy({"aids": "gone", "wizardry": {"on": True}}, None)
        assert merged == DEFAULT_POLICY
        assert merge_policy(None, "nonsense") == DEFAULT_POLICY

    def test_a_retired_group_read_back_from_storage_is_simply_dropped(self):
        """A policy stored before the ruling (migration 0005 strips them, but
        a backup may still carry one) resolves to the two groups that exist,
        with nothing of the old switch surviving."""
        merged = merge_policy({"tree": {"delete": False}, "aids": {"verbs": False}}, None)
        assert set(merged) == {"firstPass", "aids"}
        assert merged["aids"]["verbs"] is False

    def test_an_empty_tier_list_falls_back_to_the_default(self):
        assert merge_policy({"firstPass": {"allowed": []}}, {})["firstPass"][
            "allowed"
        ] == list(TIERS)


class TestStripRetired:
    def test_keeps_the_living_groups_and_drops_the_rest(self):
        assert strip_retired(
            {"tree": {"delete": False}, "aids": {"verbs": False}}
        ) == {"aids": {"verbs": False}}

    def test_an_override_made_only_of_retired_keys_becomes_uses_the_default(self):
        assert strip_retired({"notes": {"enabled": False}}) is None

    def test_a_non_object_is_handed_back_untouched(self):
        assert strip_retired("nonsense") == "nonsense"
        assert strip_retired(None) is None


@pytest.mark.django_db
class TestMigration0005:
    """The one-off that cleaned the stored policies, run against the live
    registry — a stored policy from the first build must read back as the
    shape the code now declares."""

    def test_stored_policies_and_overrides_lose_the_retired_groups(self, classroom):
        forwards = importlib.import_module("da.migrations.0005_retire_gesture_rules").forwards
        TeachingPolicy.objects.create(
            professor_membership=classroom.professor_m,
            policy={
                "firstPass": {"allowed": ["minimal"]},
                "tree": {"connect": True, "delete": False, "relabel": True, "clear": True},
                "notes": {"enabled": False},
                "aids": {"english": False, "verses": True, "verbs": True, "colorCoding": True},
            },
        )
        classroom.student_m.policy_override = {"notes": {"enabled": False}}
        classroom.student_m.save()
        classroom.other_student_m.policy_override = {
            "tree": {"delete": True}, "aids": {"verbs": False},
        }
        classroom.other_student_m.save()

        forwards(apps, None)

        stored = TeachingPolicy.objects.get(professor_membership=classroom.professor_m)
        assert stored.policy == {
            "firstPass": {"allowed": ["minimal"]},
            "aids": {"english": False, "verses": True, "verbs": True, "colorCoding": True},
        }
        classroom.student_m.refresh_from_db()
        assert classroom.student_m.policy_override is None  # nothing left: the default
        classroom.other_student_m.refresh_from_db()
        assert classroom.other_student_m.policy_override == {"aids": {"verbs": False}}


@pytest.mark.django_db
class TestEffectivePolicy:
    def test_only_students_have_one(self, classroom, individual):
        assert effective_policy(individual) is None
        assert effective_policy(classroom.admin) is None
        assert effective_policy(classroom.professor) is None
        assert effective_policy(classroom.student) == DEFAULT_POLICY

    def test_the_professors_default_reaches_their_student(self, classroom, set_policy):
        set_policy(classroom.professor_m, {"aids": {"english": False}})
        assert effective_policy(classroom.student)["aids"]["english"] is False
        # …and not the other professor's student.
        assert effective_policy(classroom.other_student)["aids"]["english"] is True

    def test_the_override_wins(self, classroom, set_policy):
        set_policy(classroom.professor_m, {"aids": {"english": False, "verbs": False}})
        classroom.student_m.policy_override = {"aids": {"english": True}}
        classroom.student_m.save()
        policy = effective_policy(classroom.student)
        assert policy["aids"]["english"] is True
        assert policy["aids"]["verbs"] is False

    def test_an_unassigned_student_gets_the_default(self, classroom, set_policy):
        set_policy(classroom.professor_m, {"aids": {"english": False}})
        classroom.student_m.professor = None
        classroom.student_m.save()
        assert effective_policy(classroom.student) == DEFAULT_POLICY

    def test_a_deactivated_membership_stops_governing(self, classroom, set_policy):
        set_policy(classroom.professor_m, {"aids": {"english": False}})
        classroom.student_m.active = False
        classroom.student_m.save()
        assert effective_policy(classroom.student) is None

    def test_a_professor_with_no_stored_policy_allows_everything(self, classroom):
        assert not TeachingPolicy.objects.exists()
        assert effective_policy(classroom.student) == DEFAULT_POLICY

    def test_the_anonymous_user_has_no_policy(self):
        from django.contrib.auth.models import AnonymousUser

        assert effective_policy(AnonymousUser()) is None
        assert effective_policy(None) is None

    def test_a_student_in_two_orgs_takes_the_first_membership(
        self, classroom, make_user, set_policy
    ):
        """Deterministic by creation order — no UI makes the second one today,
        and guessing between them would be worse than a stated rule."""
        set_policy(classroom.professor_m, {"aids": {"verses": False}})
        second = Membership.objects.create(
            user=classroom.student,
            organization=classroom.other_org,
            role=Membership.STUDENT,
        )
        assert second.pk
        assert effective_policy(classroom.student)["aids"]["verses"] is False
