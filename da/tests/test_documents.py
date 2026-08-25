"""Unit tests for the document validator and main-point walk (da.documents)."""

import copy

import pytest

from da.documents import (
    DocumentError,
    main_point,
    normalize_document,
    validate_document,
)


def prop(pid: str, start: int, end: int) -> dict:
    return {
        "id": pid,
        "label": pid,
        "source": {"kind": "corpus", "start": start, "end": end},
    }


def valid_doc() -> dict:
    """The 1 John 1:6 worked example from docs/DESIGN.md §3 (small indexes) —
    fully connected, so its forest has a single root."""
    return {
        "schemaVersion": 2,
        "propositions": [
            prop("p1", 0, 1),
            prop("p2", 2, 6),
            prop("p3", 7, 11),
            prop("p4", 12, 12),
            prop("p5", 13, 17),
        ],
        "forest": [
            {
                "kind": "bracket", "rel": "CndE", "prominent": 1,
                "children": [
                    {
                        "kind": "bracket", "rel": "FtIn", "prominent": 1,
                        "children": [
                            {"kind": "prop", "ref": "p1"},
                            {
                                "kind": "bracket", "rel": "Adv", "prominent": 0,
                                "children": [
                                    {"kind": "prop", "ref": "p2"},
                                    {"kind": "prop", "ref": "p3"},
                                ],
                            },
                        ],
                    },
                    {
                        "kind": "bracket", "rel": "Ser", "prominent": None,
                        "children": [
                            {"kind": "prop", "ref": "p4"},
                            {"kind": "prop", "ref": "p5"},
                        ],
                    },
                ],
            },
        ],
    }


def legacy_doc() -> dict:
    """The same analysis in the v1 single-tree shape."""
    doc = valid_doc()
    return {
        "schemaVersion": 1,
        "propositions": doc["propositions"],
        "tree": doc["forest"][0],
    }


def partial_doc() -> dict:
    """A half-connected analysis: p1 and p2 still stand alone, p3+p4 bracketed."""
    return {
        "schemaVersion": 2,
        "propositions": [
            prop("p1", 0, 1),
            prop("p2", 2, 6),
            prop("p3", 7, 11),
            prop("p4", 12, 12),
        ],
        "forest": [
            {"kind": "prop", "ref": "p1"},
            {"kind": "prop", "ref": "p2"},
            {
                "kind": "bracket", "rel": "Ser", "prominent": None,
                "children": [
                    {"kind": "prop", "ref": "p3"},
                    {"kind": "prop", "ref": "p4"},
                ],
            },
        ],
    }


def problems_of(doc, **kwargs) -> list[str]:
    with pytest.raises(DocumentError) as exc:
        validate_document(doc, **kwargs)
    return exc.value.problems


class TestValidDocuments:
    def test_worked_example_passes(self):
        validate_document(valid_doc())

    def test_valid_with_corpus_size(self):
        validate_document(valid_doc(), corpus_size=18)

    def test_single_proposition_doc(self):
        doc = {
            "schemaVersion": 2,
            "propositions": [prop("p1", 0, 3)],
            "forest": [{"kind": "prop", "ref": "p1"}],
        }
        validate_document(doc)

    def test_raw_source_reversed_and_flag(self):
        doc = {
            "schemaVersion": 2,
            "propositions": [
                {"id": "a", "label": "1", "source": {"kind": "raw", "text": "ψευδόμεθα"}},
                {"id": "b", "label": "2", "source": {"kind": "raw", "text": "καὶ οὐ ποιοῦμεν"},
                 "color": "#fde047"},
            ],
            "forest": [
                {
                    "kind": "bracket", "rel": "WEd", "prominent": 0,
                    "reversed": True, "flag": "review",
                    "children": [
                        {"kind": "prop", "ref": "a"},
                        {"kind": "prop", "ref": "b"},
                    ],
                },
            ],
        }
        validate_document(doc)


class TestForest:
    def test_multi_root_forest_valid(self):
        # Two disconnected propositions followed by a bracketed pair.
        validate_document(partial_doc())

    def test_every_proposition_its_own_root(self):
        doc = {
            "schemaVersion": 2,
            "propositions": [prop("p1", 0, 1), prop("p2", 2, 3), prop("p3", 4, 5)],
            "forest": [
                {"kind": "prop", "ref": "p1"},
                {"kind": "prop", "ref": "p2"},
                {"kind": "prop", "ref": "p3"},
            ],
        }
        validate_document(doc)

    def test_out_of_order_across_roots(self):
        doc = partial_doc()
        doc["forest"][0], doc["forest"][1] = doc["forest"][1], doc["forest"][0]
        problems = problems_of(doc)
        assert any("proposition order" in p for p in problems)

    def test_duplicate_across_roots(self):
        doc = partial_doc()
        # p2's root now repeats p1: p2 goes missing and p1 appears twice.
        doc["forest"][1] = {"kind": "prop", "ref": "p1"}
        problems = problems_of(doc)
        assert any("not in the forest" in p and "p2" in p for p in problems)

    def test_empty_forest_rejected(self):
        doc = valid_doc()
        doc["forest"] = []
        problems = problems_of(doc)
        assert any("forest must be a non-empty list" in p for p in problems)

    def test_forest_must_be_a_list(self):
        doc = valid_doc()
        doc["forest"] = doc["forest"][0]
        problems = problems_of(doc)
        assert any("forest must be a non-empty list" in p for p in problems)

    def test_error_paths_name_the_root_index(self):
        doc = partial_doc()
        doc["forest"][2]["rel"] = "Zorp"
        problems = problems_of(doc)
        assert any(p.startswith("forest[2].rel") for p in problems)

    def test_bad_root_node(self):
        doc = partial_doc()
        doc["forest"][1] = "p2"
        problems = problems_of(doc)
        assert any("forest[1] must be an object" in p for p in problems)


class TestLegacyDocuments:
    def test_v1_document_accepted(self):
        validate_document(legacy_doc())

    def test_v1_document_validated_like_v2(self):
        doc = legacy_doc()
        doc["tree"]["rel"] = "Zorp"
        problems = problems_of(doc)
        assert any("tree.rel" in p and "Zorp" in p for p in problems)

    def test_normalize_converts_v1_to_forest_of_one(self):
        doc = legacy_doc()
        normalized = normalize_document(doc)
        assert normalized["schemaVersion"] == 2
        assert "tree" not in normalized
        assert normalized["forest"] == [doc["tree"]]
        assert normalized["propositions"] == doc["propositions"]
        validate_document(normalized)

    def test_normalize_does_not_mutate_input(self):
        doc = legacy_doc()
        before = copy.deepcopy(doc)
        normalize_document(doc)
        assert doc == before

    def test_normalize_is_identity_on_v2(self):
        doc = valid_doc()
        assert normalize_document(doc) == doc

    def test_validate_does_not_mutate_input(self):
        for doc in (valid_doc(), legacy_doc(), partial_doc()):
            before = copy.deepcopy(doc)
            validate_document(doc)
            assert doc == before

    def test_v1_version_on_a_forest_rejected(self):
        # The version says which shape to read; a forest is v2 by definition.
        doc = valid_doc()
        doc["schemaVersion"] = 1
        problems = problems_of(doc)
        assert any("schemaVersion must be 2" in p for p in problems)

    def test_v2_version_on_a_tree_rejected(self):
        doc = legacy_doc()
        doc["schemaVersion"] = 2
        problems = problems_of(doc)
        assert any("forest must be a non-empty list" in p for p in problems)

    def test_normalize_rejects_non_dict(self):
        with pytest.raises(DocumentError):
            normalize_document(["not", "a", "dict"])


class TestTreeInvariants:
    def test_out_of_order_leaves(self):
        doc = valid_doc()
        ser = doc["forest"][0]["children"][1]
        ser["children"] = [ser["children"][1], ser["children"][0]]  # p5, p4
        problems = problems_of(doc)
        assert any("proposition order" in p for p in problems)

    def test_duplicate_leaf(self):
        doc = valid_doc()
        # p4 twice: the Series bracket references p4 in both slots.
        doc["forest"][0]["children"][1]["children"][1] = {"kind": "prop", "ref": "p4"}
        problems = problems_of(doc)
        assert any("p5" in p for p in problems)  # p5 is now missing from the forest

    def test_missing_prop(self):
        doc = valid_doc()
        doc["propositions"].append(prop("p6", 18, 20))  # declared, never placed
        problems = problems_of(doc)
        assert any("not in the forest" in p and "p6" in p for p in problems)

    def test_unknown_leaf_ref(self):
        doc = valid_doc()
        doc["forest"][0]["children"][1]["children"][1] = {"kind": "prop", "ref": "ghost"}
        problems = problems_of(doc)
        assert any("unknown propositions" in p and "ghost" in p for p in problems)

    def test_unknown_rel(self):
        doc = valid_doc()
        doc["forest"][0]["rel"] = "Zorp"
        problems = problems_of(doc)
        assert any("Zorp" in p and "not a known relationship" in p for p in problems)

    def test_prominent_on_coordinate_rejected(self):
        doc = valid_doc()
        doc["forest"][0]["children"][1]["prominent"] = 0  # Ser must stay null
        problems = problems_of(doc)
        assert any("must be null for coordinate" in p for p in problems)

    def test_prominent_missing_on_subordinate_rejected(self):
        doc = valid_doc()
        doc["forest"][0]["prominent"] = None  # CndE needs a starred child
        problems = problems_of(doc)
        assert any("valid child index" in p for p in problems)

    def test_prominent_out_of_range_rejected(self):
        doc = valid_doc()
        doc["forest"][0]["prominent"] = 2  # only children 0 and 1 exist
        problems = problems_of(doc)
        assert any("valid child index" in p for p in problems)

    def test_single_child_bracket(self):
        doc = {
            "schemaVersion": 2,
            "propositions": [prop("p1", 0, 1)],
            "forest": [
                {
                    "kind": "bracket", "rel": "Ser", "prominent": None,
                    "children": [{"kind": "prop", "ref": "p1"}],
                },
            ],
        }
        problems = problems_of(doc)
        assert any(">= 2" in p for p in problems)


class TestSources:
    def test_start_after_end(self):
        doc = valid_doc()
        doc["propositions"][0]["source"] = {"kind": "corpus", "start": 5, "end": 2}
        problems = problems_of(doc)
        assert any("0 <= start <= end" in p for p in problems)

    def test_negative_start(self):
        doc = valid_doc()
        doc["propositions"][0]["source"] = {"kind": "corpus", "start": -1, "end": 2}
        problems = problems_of(doc)
        assert any("0 <= start <= end" in p for p in problems)

    def test_range_beyond_corpus(self):
        doc = valid_doc()
        problems = problems_of(doc, corpus_size=10)  # p5 ends at 17
        assert any("exceeds the corpus" in p for p in problems)

    def test_raw_source_empty_text(self):
        doc = valid_doc()
        doc["propositions"][0]["source"] = {"kind": "raw", "text": "   "}
        problems = problems_of(doc)
        assert any("source.text" in p for p in problems)

    def test_bad_source_kind(self):
        doc = valid_doc()
        doc["propositions"][0]["source"] = {"kind": "telepathy"}
        problems = problems_of(doc)
        assert any("'corpus' or 'raw'" in p for p in problems)


class TestOtherShapes:
    def test_non_dict_document(self):
        with pytest.raises(DocumentError):
            validate_document(["not", "a", "dict"])

    def test_wrong_schema_version(self):
        doc = valid_doc()
        doc["schemaVersion"] = 3
        problems = problems_of(doc)
        assert any("schemaVersion" in p for p in problems)

    def test_missing_schema_version(self):
        doc = valid_doc()
        del doc["schemaVersion"]
        problems = problems_of(doc)
        assert any("schemaVersion" in p for p in problems)

    def test_empty_propositions(self):
        problems = problems_of({
            "schemaVersion": 2, "propositions": [],
            "forest": [{"kind": "prop", "ref": "p1"}],
        })
        assert any("non-empty" in p for p in problems)

    def test_duplicate_prop_ids(self):
        doc = valid_doc()
        doc["propositions"][1]["id"] = "p1"
        problems = problems_of(doc)
        assert any("duplicates" in p for p in problems)

    def test_every_problem_reported(self):
        doc = valid_doc()
        doc["forest"][0]["rel"] = "Zorp"
        doc["propositions"][0]["source"] = {"kind": "corpus", "start": 3, "end": 1}
        problems = problems_of(doc)
        assert len(problems) >= 2


class TestMainPoint:
    def test_subordinate_chain_then_coordinate_fan(self):
        # Star walk on the worked example: CndE* -> Series packet -> fan;
        # the coordinate packet's members are jointly the main point.
        assert main_point(valid_doc()) == ["p4", "p5"]

    def test_subordinate_chain_to_single_leaf(self):
        doc = valid_doc()
        doc["forest"][0]["prominent"] = 0   # star the FtIn side instead
        assert main_point(doc) == ["p2"]    # FtIn* -> Adv (prominent 0) -> p2

    def test_coordinate_root_fans_and_keeps_walking(self):
        # A coordinate bracket fans, and the walk CONTINUES into each member
        # (mirroring the client's red rows): the FtIn half follows its stars
        # down to p2, the Series half is all leaves.
        doc = valid_doc()
        doc["forest"][0]["rel"] = "Ser"
        doc["forest"][0]["prominent"] = None
        assert main_point(doc) == ["p2", "p4", "p5"]

    def test_progression_fans_like_any_coordinate(self):
        # The Mark 4:10-12 diagram highlights BOTH members of its final P, so
        # Progression fans exactly like Series.
        doc = valid_doc()
        doc["forest"][0]["children"][1]["rel"] = "Prog"
        assert main_point(doc) == ["p4", "p5"]

    def test_single_prop_doc(self):
        doc = {
            "schemaVersion": 2,
            "propositions": [prop("p1", 0, 0)],
            "forest": [{"kind": "prop", "ref": "p1"}],
        }
        assert main_point(doc) == ["p1"]

    def test_multi_root_forest_has_no_main_point_yet(self):
        assert main_point(partial_doc()) == []

    def test_legacy_document_walks_its_tree(self):
        assert main_point(legacy_doc()) == ["p4", "p5"]


class TestSections:
    """Color blocks: which propositions BEGIN one. Divisions the analyst drew,
    stored with the analysis."""

    def test_absent_and_empty_are_both_fine(self):
        doc = partial_doc()
        validate_document(doc)
        doc["sections"] = []
        validate_document(doc)

    def test_later_propositions_may_begin_a_block(self):
        doc = partial_doc()
        doc["sections"] = [{"start": "p2", "color": 1}, {"start": "p4", "color": 5}]
        validate_document(doc)

    def test_legacy_pid_strings_still_validate(self):
        doc = partial_doc()
        doc["sections"] = ["p2", "p4"]
        validate_document(doc)

    def test_colors_must_be_non_negative_integers(self):
        doc = partial_doc()
        doc["sections"] = [{"start": "p2", "color": -1}]
        assert problems_of(doc) == [
            "sections[0].color must be a non-negative integer"]
        doc["sections"] = [{"start": "p2", "color": "sage"}]
        assert problems_of(doc) == [
            "sections[0].color must be a non-negative integer"]
        doc["sections"] = [{"start": "p2", "color": True}]
        assert problems_of(doc) == [
            "sections[0].color must be a non-negative integer"]

    def test_the_first_proposition_cannot_begin_one(self):
        doc = partial_doc()
        doc["sections"] = ["p1"]
        assert problems_of(doc) == ["sections[0] cannot be the first proposition"]

    def test_must_name_real_propositions(self):
        doc = partial_doc()
        doc["sections"] = ["nope", {"start": "gone", "color": 2}, 7]
        assert problems_of(doc) == [
            "sections[0] must name a proposition",
            "sections[1] must name a proposition",
            "sections[2] must be a pid or {start, color}",
        ]

    def test_no_duplicates_and_no_going_backwards(self):
        doc = partial_doc()
        doc["sections"] = ["p3", "p3"]
        assert problems_of(doc) == ["sections[1] duplicates 'p3'"]
        doc["sections"] = ["p4", "p2"]
        assert problems_of(doc) == ["sections[1] is out of proposition order"]

    def test_must_be_a_list(self):
        doc = partial_doc()
        doc["sections"] = "p2"
        assert problems_of(doc) == ["sections must be a list"]
