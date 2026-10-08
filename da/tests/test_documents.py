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

    def test_prominent_true_is_not_a_child_index(self):
        # A bool is an int in Python, but it is not a slot number.
        doc = valid_doc()
        doc["forest"][0]["prominent"] = True
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
        assert any("exactly 2" in p for p in problems)

    def test_three_way_bracket_rejected(self):
        # THE BINARY RULE: three propositions in a row are a NESTED chain of
        # Series, Ser[Ser[p1, p2], p3] — never one three-way bracket. This is
        # the shape the old editor could splice into existence; the server
        # refuses it outright now (docs/tree-engine-spec.md §1, §7.6, §9 Q2).
        doc = {
            "schemaVersion": 2,
            "propositions": [prop("p1", 0, 1), prop("p2", 2, 3), prop("p3", 4, 5)],
            "forest": [
                {
                    "kind": "bracket", "rel": "Ser", "prominent": None,
                    "children": [
                        {"kind": "prop", "ref": "p1"},
                        {"kind": "prop", "ref": "p2"},
                        {"kind": "prop", "ref": "p3"},
                    ],
                },
            ],
        }
        assert problems_of(doc) == [
            "forest[0].children must be a list of exactly 2 nodes"]

    def test_the_nested_chain_that_replaces_it_is_valid(self):
        # The same three propositions, related the only way the model allows.
        doc = {
            "schemaVersion": 2,
            "propositions": [prop("p1", 0, 1), prop("p2", 2, 3), prop("p3", 4, 5)],
            "forest": [
                {
                    "kind": "bracket", "rel": "Ser", "prominent": None,
                    "children": [
                        {
                            "kind": "bracket", "rel": "Ser", "prominent": None,
                            "children": [
                                {"kind": "prop", "ref": "p1"},
                                {"kind": "prop", "ref": "p2"},
                            ],
                        },
                        {"kind": "prop", "ref": "p3"},
                    ],
                },
            ],
        }
        validate_document(doc)

    def test_a_wide_bracket_still_reports_its_out_of_range_star(self):
        # The star's domain is {0, 1} whatever the children list says, so a
        # three-way subordinate bracket reports BOTH faults, not one.
        doc = {
            "schemaVersion": 2,
            "propositions": [prop("p1", 0, 1), prop("p2", 2, 3), prop("p3", 4, 5)],
            "forest": [
                {
                    "kind": "bracket", "rel": "Grnd", "prominent": 2,
                    "children": [
                        {"kind": "prop", "ref": "p1"},
                        {"kind": "prop", "ref": "p2"},
                        {"kind": "prop", "ref": "p3"},
                    ],
                },
            ],
        }
        assert problems_of(doc) == [
            "forest[0].children must be a list of exactly 2 nodes",
            "forest[0].prominent must be a valid child index for Grnd",
        ]


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


def flow_doc() -> dict:
    """The worked example with a Text Flow over the same words: three clause
    lines, the second indented under the first, one clause marked off."""
    doc = partial_doc()
    doc["textFlow"] = {
        "lines": [
            {"start": 0, "end": 1, "indent": 0},
            {"start": 2, "end": 6, "indent": 1,
             "marks": [{"at": 3, "before": "("}, {"at": 4, "after": ")"}]},
            {"start": 7, "end": 12, "indent": 2},
        ],
    }
    return doc


class TestTextFlow:
    """The student's Text Flow: clause per line, dependent clauses indented,
    embedded clauses marked in place. One gapless run of corpus words."""

    def test_valid_flow_passes(self):
        validate_document(flow_doc())
        validate_document(flow_doc(), corpus_size=13)

    def test_absent_flow_is_fine(self):
        doc = partial_doc()
        assert "textFlow" not in doc
        validate_document(doc)

    def test_a_single_line_is_enough(self):
        doc = partial_doc()
        doc["textFlow"] = {"lines": [{"start": 4, "end": 9, "indent": 0}]}
        validate_document(doc)

    def test_normalize_passes_the_flow_through_unchanged(self):
        doc = flow_doc()
        normalized = normalize_document(doc)
        assert normalized["textFlow"] == doc["textFlow"]
        validate_document(normalized)

    def test_validate_does_not_mutate_a_flow(self):
        doc = flow_doc()
        before = copy.deepcopy(doc)
        validate_document(doc)
        assert doc == before

    def test_the_flow_need_not_match_the_propositions(self):
        # The flow may cover a wider or a narrower stretch than the analysis.
        doc = partial_doc()
        doc["textFlow"] = {"lines": [{"start": 40, "end": 99, "indent": 0}]}
        validate_document(doc)
        doc["textFlow"] = {"lines": [{"start": 3, "end": 4, "indent": 0}]}
        validate_document(doc)

    def test_must_be_an_object(self):
        doc = partial_doc()
        doc["textFlow"] = [{"start": 0, "end": 1, "indent": 0}]
        assert problems_of(doc) == ["textFlow must be an object"]

    def test_lines_must_be_a_non_empty_list(self):
        doc = partial_doc()
        doc["textFlow"] = {}
        assert problems_of(doc) == ["textFlow.lines must be a non-empty list"]
        doc["textFlow"] = {"lines": []}
        assert problems_of(doc) == ["textFlow.lines must be a non-empty list"]
        doc["textFlow"] = {"lines": "0-12"}
        assert problems_of(doc) == ["textFlow.lines must be a non-empty list"]

    def test_a_line_must_be_an_object(self):
        doc = flow_doc()
        doc["textFlow"]["lines"][1] = [2, 6]
        assert problems_of(doc) == ["textFlow.lines[1] must be an object"]

    def test_line_ranges_need_ints_in_order(self):
        doc = flow_doc()
        doc["textFlow"]["lines"][0] = {"start": 5, "end": 2, "indent": 0}
        assert any("textFlow.lines[0] needs ints 0 <= start <= end" in p
                   for p in problems_of(doc))
        doc["textFlow"]["lines"][0] = {"start": -1, "end": 1, "indent": 0}
        assert any("textFlow.lines[0] needs ints 0 <= start <= end" in p
                   for p in problems_of(doc))
        doc["textFlow"]["lines"][0] = {"start": "0", "end": 1, "indent": 0}
        assert any("textFlow.lines[0] needs ints 0 <= start <= end" in p
                   for p in problems_of(doc))

    def test_line_range_beyond_the_corpus(self):
        # The flow runs past the end of the corpus; the propositions do not.
        doc = flow_doc()
        doc["textFlow"]["lines"][2]["end"] = 20
        assert problems_of(doc, corpus_size=13) == [
            "textFlow.lines[2] range exceeds the corpus"]

    def test_lines_must_be_contiguous(self):
        doc = flow_doc()
        doc["textFlow"]["lines"][2]["start"] = 8  # gap: line 1 ended at 6
        assert problems_of(doc) == [
            "textFlow.lines[2].start must continue the previous line"]

    def test_lines_must_not_overlap_or_go_backwards(self):
        doc = flow_doc()
        doc["textFlow"]["lines"][2]["start"] = 5  # back inside line 1
        assert problems_of(doc) == [
            "textFlow.lines[2].start must continue the previous line"]

    def test_indent_must_be_an_int_in_range(self):
        doc = flow_doc()
        for bad in (-1, 9, "1", None, True):
            doc["textFlow"]["lines"][1]["indent"] = bad
            assert problems_of(doc) == [
                "textFlow.lines[1].indent must be an int 0 <= indent <= 8"]
        del doc["textFlow"]["lines"][1]["indent"]
        assert problems_of(doc) == [
            "textFlow.lines[1].indent must be an int 0 <= indent <= 8"]

    def test_indent_bounds_are_inclusive(self):
        doc = flow_doc()
        doc["textFlow"]["lines"][1]["indent"] = 8
        validate_document(doc)

    def test_marks_absent_or_empty_is_fine(self):
        doc = flow_doc()
        del doc["textFlow"]["lines"][1]["marks"]
        validate_document(doc)
        doc["textFlow"]["lines"][1]["marks"] = []
        validate_document(doc)

    def test_marks_must_be_a_list_of_objects(self):
        doc = flow_doc()
        doc["textFlow"]["lines"][1]["marks"] = {"at": 3, "before": "("}
        assert problems_of(doc) == ["textFlow.lines[1].marks must be a list"]
        doc["textFlow"]["lines"][1]["marks"] = ["(3"]
        assert problems_of(doc) == ["textFlow.lines[1].marks[0] must be an object"]

    def test_a_mark_names_a_word_inside_its_line(self):
        doc = flow_doc()
        doc["textFlow"]["lines"][1]["marks"] = [{"at": "3", "before": "("}]
        assert problems_of(doc) == ["textFlow.lines[1].marks[0].at must be an int"]
        doc["textFlow"]["lines"][1]["marks"] = [{"at": 1, "before": "("}]  # line starts at 2
        assert problems_of(doc) == [
            "textFlow.lines[1].marks[0] must lie inside its line"]
        doc["textFlow"]["lines"][1]["marks"] = [{"at": 7, "after": ")"}]  # line ends at 6
        assert problems_of(doc) == [
            "textFlow.lines[1].marks[0] must lie inside its line"]

    def test_marks_come_in_word_order(self):
        doc = flow_doc()
        doc["textFlow"]["lines"][1]["marks"] = [
            {"at": 4, "after": ")"}, {"at": 3, "before": "("}]
        assert problems_of(doc) == [
            "textFlow.lines[1].marks[1] must follow the previous mark's word"]
        doc["textFlow"]["lines"][1]["marks"] = [
            {"at": 3, "before": "("}, {"at": 3, "after": ")"}]  # one word, twice
        assert problems_of(doc) == [
            "textFlow.lines[1].marks[1] must follow the previous mark's word"]

    def test_a_mark_is_made_of_the_four_characters_only(self):
        doc = flow_doc()
        for bad in ("", "x", "(x)", 3, None):
            doc["textFlow"]["lines"][1]["marks"] = [{"at": 3, "before": bad}]
            assert problems_of(doc) == [
                "textFlow.lines[1].marks[0].before must be one or more of ( ) [ ]"], bad
        doc["textFlow"]["lines"][1]["marks"] = [{"at": 3, "before": "([", "after": "])"}]
        validate_document(doc)

    def test_a_mark_carries_something(self):
        doc = flow_doc()
        doc["textFlow"]["lines"][1]["marks"] = [{"at": 3}]
        assert problems_of(doc) == ["textFlow.lines[1].marks[0] carries nothing"]

    def test_every_flow_problem_reported(self):
        doc = flow_doc()
        doc["textFlow"]["lines"][1]["indent"] = 99
        doc["textFlow"]["lines"][1]["marks"] = [{"at": 3, "before": "{"}]
        doc["textFlow"]["lines"][2]["start"] = 8
        assert problems_of(doc) == [
            "textFlow.lines[1].indent must be an int 0 <= indent <= 8",
            "textFlow.lines[1].marks[0].before must be one or more of ( ) [ ]",
            "textFlow.lines[2].start must continue the previous line",
        ]


class TestHoles:
    """A hole holds units an edit left unattached, so the structure above them
    survives. A document with one is an editing state — sound, unfinished.

    It is a WAITING ROOM, not structure: only a bracket's child (a root is
    unattached already), never inside another hole (what waits, waits
    together), and never around a single unit (that unit takes the slot)."""

    def hole_doc(self) -> dict:
        """What deleting one relationship leaves: Grnd[p1, hole[p2, p3]], with
        p4 still standing alone."""
        doc = partial_doc()
        doc["forest"] = [
            {
                "kind": "bracket", "rel": "Grnd", "prominent": 0,
                "children": [
                    {"kind": "prop", "ref": "p1"},
                    {
                        "kind": "hole",
                        "children": [
                            {"kind": "prop", "ref": "p2"},
                            {"kind": "prop", "ref": "p3"},
                        ],
                    },
                ],
            },
            {"kind": "prop", "ref": "p4"},
        ]
        return doc

    def test_a_hole_validates_and_still_tiles_the_propositions(self):
        validate_document(self.hole_doc())

    def test_a_hole_may_hold_a_hanging_bracket(self):
        # What waits is whole units, brackets included — a packet whose own
        # relationship was never touched keeps it while it hangs.
        doc = self.hole_doc()
        doc["forest"][0]["children"][1]["children"] = [
            {"kind": "prop", "ref": "p2"},
            {
                "kind": "bracket", "rel": "Ser", "prominent": None,
                "children": [
                    {"kind": "prop", "ref": "p3"},
                    {"kind": "prop", "ref": "p4"},
                ],
            },
        ]
        doc["forest"] = doc["forest"][:1]
        validate_document(doc)

    def test_a_hole_of_one_is_a_room_with_one_lodger(self):
        # Spec §10 A1: the analyst has assembled the group and has not said it
        # is finished. The room stands — tick, pickup dot, the lone unit
        # waiting — and only their own gesture settles it.
        doc = self.hole_doc()
        doc["forest"][0]["children"][1]["children"] = [{"kind": "prop", "ref": "p2"}]
        doc["propositions"] = [p for p in doc["propositions"] if p["id"] != "p3"]
        validate_document(doc)  # no raise

    def test_an_empty_hole_holds_nothing_and_is_nothing(self):
        doc = self.hole_doc()
        doc["forest"][0]["children"][1]["children"] = []
        assert problems_of(doc) == [
            "forest[0].children[1].children must be a list of >= 1 node",
            "propositions not in the forest: ['p2', 'p3']",
        ]

    def test_a_hole_cannot_be_a_forest_root(self):
        doc = self.hole_doc()
        doc["forest"] = [
            {
                "kind": "hole",
                "children": [
                    {"kind": "prop", "ref": "p1"},
                    {"kind": "prop", "ref": "p2"},
                ],
            },
            {"kind": "prop", "ref": "p3"},
            {"kind": "prop", "ref": "p4"},
        ]
        assert problems_of(doc) == [
            "forest[0] cannot be a forest root: roots are unattached"]

    def test_a_hole_cannot_hold_another_hole(self):
        doc = self.hole_doc()
        doc["forest"][0]["children"][1]["children"] = [
            {"kind": "prop", "ref": "p2"},
            {
                "kind": "hole",
                "children": [
                    {"kind": "prop", "ref": "p3"},
                    {"kind": "prop", "ref": "p4"},
                ],
            },
        ]
        doc["forest"] = doc["forest"][:1]
        assert problems_of(doc) == [
            "forest[0].children[1].children[1] cannot hold another hole: "
            "what waits, waits together"]

    def test_the_leaves_of_a_hole_count_like_any_others(self):
        # Waiting does not put a proposition outside the reading order.
        doc = self.hole_doc()
        doc["forest"][0]["children"][1]["children"] = [
            {"kind": "prop", "ref": "p3"},
            {"kind": "prop", "ref": "p2"},
        ]
        assert problems_of(doc) == [
            "forest leaves must appear exactly once each, in proposition order"]

    def test_an_unfinished_tree_has_no_main_point(self):
        doc = self.hole_doc()
        doc["forest"] = [{
            "kind": "bracket", "rel": "Grnd", "prominent": 1,
            "children": [
                {"kind": "hole", "children": [
                    {"kind": "prop", "ref": "p1"}, {"kind": "prop", "ref": "p2"},
                ]},
                {"kind": "bracket", "rel": "Ser", "prominent": None, "children": [
                    {"kind": "prop", "ref": "p3"}, {"kind": "prop", "ref": "p4"},
                ]},
            ],
        }]
        validate_document(doc)
        assert main_point(doc) == []   # an edit is half-made

    def test_the_same_tree_without_the_hole_does_have_one(self):
        doc = self.hole_doc()
        doc["forest"] = [{
            "kind": "bracket", "rel": "Grnd", "prominent": 1,
            "children": [
                {"kind": "bracket", "rel": "Ser", "prominent": None, "children": [
                    {"kind": "prop", "ref": "p1"}, {"kind": "prop", "ref": "p2"},
                ]},
                {"kind": "bracket", "rel": "Ser", "prominent": None, "children": [
                    {"kind": "prop", "ref": "p3"}, {"kind": "prop", "ref": "p4"},
                ]},
            ],
        }]
        assert main_point(doc) == ["p3", "p4"]

    def test_an_unknown_kind_still_names_the_three_that_are_known(self):
        doc = self.hole_doc()
        doc["forest"][0] = {"kind": "blob"}
        assert "forest[0].kind must be 'prop', 'bracket' or 'hole'" in problems_of(doc)


def test_a_bracket_may_hang_at_both_ends():
    # Spec §10 A4, the analyst's ruling: "only validate the tree structure when
    # there are no holes remaining". A bracket with a room at each end is work
    # in progress — nothing cascades, nothing dissolves — and it stores as it
    # stands.
    doc = {
        "schemaVersion": 2,
        "propositions": [
            {"id": f"p{i}", "label": str(i),
             "source": {"kind": "corpus", "start": 124771 + i, "end": 124771 + i}}
            for i in range(4)
        ],
        "forest": [{
            "kind": "bracket", "rel": "Alt", "prominent": None,
            "children": [
                {"kind": "hole", "children": [
                    {"kind": "prop", "ref": "p0"}, {"kind": "prop", "ref": "p1"}]},
                {"kind": "hole", "children": [
                    {"kind": "prop", "ref": "p2"}, {"kind": "prop", "ref": "p3"}]},
            ],
        }],
    }
    validate_document(doc)  # no raise
    # …and it has no main point while the rooms are open.
    assert main_point(doc) == []
