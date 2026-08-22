"""Unit tests for the document validator and main-point walk (da.documents)."""

import pytest

from da.documents import DocumentError, main_point, validate_document


def prop(pid: str, start: int, end: int) -> dict:
    return {
        "id": pid,
        "label": pid,
        "source": {"kind": "corpus", "start": start, "end": end},
    }


def valid_doc() -> dict:
    """The 1 John 1:6 worked example from docs/DESIGN.md §3 (small indexes)."""
    return {
        "schemaVersion": 1,
        "propositions": [
            prop("p1", 0, 1),
            prop("p2", 2, 6),
            prop("p3", 7, 11),
            prop("p4", 12, 12),
            prop("p5", 13, 17),
        ],
        "tree": {
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
            "schemaVersion": 1,
            "propositions": [prop("p1", 0, 3)],
            "tree": {"kind": "prop", "ref": "p1"},
        }
        validate_document(doc)

    def test_raw_source_reversed_and_flag(self):
        doc = {
            "schemaVersion": 1,
            "propositions": [
                {"id": "a", "label": "1", "source": {"kind": "raw", "text": "ψευδόμεθα"}},
                {"id": "b", "label": "2", "source": {"kind": "raw", "text": "καὶ οὐ ποιοῦμεν"},
                 "color": "#fde047"},
            ],
            "tree": {
                "kind": "bracket", "rel": "WEd", "prominent": 0,
                "reversed": True, "flag": "review",
                "children": [
                    {"kind": "prop", "ref": "a"},
                    {"kind": "prop", "ref": "b"},
                ],
            },
        }
        validate_document(doc)


class TestTreeInvariants:
    def test_out_of_order_leaves(self):
        doc = valid_doc()
        ser = doc["tree"]["children"][1]
        ser["children"] = [ser["children"][1], ser["children"][0]]  # p5, p4
        problems = problems_of(doc)
        assert any("proposition order" in p for p in problems)

    def test_duplicate_leaf(self):
        doc = valid_doc()
        # p4 twice: the Series bracket references p4 in both slots.
        doc["tree"]["children"][1]["children"][1] = {"kind": "prop", "ref": "p4"}
        problems = problems_of(doc)
        assert any("p5" in p for p in problems)  # p5 is now missing from the tree

    def test_missing_prop(self):
        doc = valid_doc()
        doc["propositions"].append(prop("p6", 18, 20))  # declared, never placed
        problems = problems_of(doc)
        assert any("not in tree" in p and "p6" in p for p in problems)

    def test_unknown_leaf_ref(self):
        doc = valid_doc()
        doc["tree"]["children"][1]["children"][1] = {"kind": "prop", "ref": "ghost"}
        problems = problems_of(doc)
        assert any("unknown propositions" in p and "ghost" in p for p in problems)

    def test_unknown_rel(self):
        doc = valid_doc()
        doc["tree"]["rel"] = "Zorp"
        problems = problems_of(doc)
        assert any("Zorp" in p and "not a known relationship" in p for p in problems)

    def test_prominent_on_coordinate_rejected(self):
        doc = valid_doc()
        doc["tree"]["children"][1]["prominent"] = 0  # Ser must stay null
        problems = problems_of(doc)
        assert any("must be null for coordinate" in p for p in problems)

    def test_prominent_missing_on_subordinate_rejected(self):
        doc = valid_doc()
        doc["tree"]["prominent"] = None  # CndE needs a starred child
        problems = problems_of(doc)
        assert any("valid child index" in p for p in problems)

    def test_prominent_out_of_range_rejected(self):
        doc = valid_doc()
        doc["tree"]["prominent"] = 2  # only children 0 and 1 exist
        problems = problems_of(doc)
        assert any("valid child index" in p for p in problems)

    def test_single_child_bracket(self):
        doc = {
            "schemaVersion": 1,
            "propositions": [prop("p1", 0, 1)],
            "tree": {
                "kind": "bracket", "rel": "Ser", "prominent": None,
                "children": [{"kind": "prop", "ref": "p1"}],
            },
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
        doc["schemaVersion"] = 2
        problems = problems_of(doc)
        assert any("schemaVersion" in p for p in problems)

    def test_empty_propositions(self):
        problems = problems_of({
            "schemaVersion": 1, "propositions": [],
            "tree": {"kind": "prop", "ref": "p1"},
        })
        assert any("non-empty" in p for p in problems)

    def test_duplicate_prop_ids(self):
        doc = valid_doc()
        doc["propositions"][1]["id"] = "p1"
        problems = problems_of(doc)
        assert any("duplicates" in p for p in problems)

    def test_every_problem_reported(self):
        doc = valid_doc()
        doc["tree"]["rel"] = "Zorp"
        doc["propositions"][0]["source"] = {"kind": "corpus", "start": 3, "end": 1}
        problems = problems_of(doc)
        assert len(problems) >= 2


class TestMainPoint:
    def test_subordinate_chain_then_coordinate_stop(self):
        # Star walk on the worked example: CndE* -> Series packet -> stop;
        # the coordinate packet's leaves are jointly the main point.
        assert main_point(valid_doc()) == ["p4", "p5"]

    def test_subordinate_chain_to_single_leaf(self):
        doc = valid_doc()
        doc["tree"]["prominent"] = 0        # star the FtIn side instead
        assert main_point(doc) == ["p2"]    # FtIn* -> Adv (prominent 0) -> p2

    def test_coordinate_root_is_whole_packet(self):
        doc = valid_doc()
        doc["tree"]["rel"] = "Ser"
        doc["tree"]["prominent"] = None
        assert main_point(doc) == ["p1", "p2", "p3", "p4", "p5"]

    def test_single_prop_doc(self):
        doc = {
            "schemaVersion": 1,
            "propositions": [prop("p1", 0, 0)],
            "tree": {"kind": "prop", "ref": "p1"},
        }
        assert main_point(doc) == ["p1"]
