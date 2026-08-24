"""Golden tests for initial entry: the full automatic analyzer.

``first_pass`` — what initial entry actually runs — segments a located paste
into clause propositions (stage 1) and connects them into one labeled tree
(stage 2); an unaligned paste splits on punctuation into disconnected raw
propositions (no morphology, no proposed structure).

The analyzer is also tested over hand-built, contract-shaped segments so the
classifier's calls are pinned independently of live segmentation. Passages
come from the course's worked examples: 1 John 1:5–7 (examples/da1.xlsx) and
Hebrews 4:9–12 (Five Step walkthrough). We assert what an explicit
connective settles (the confident calls) and only the best-guess default
where the call is a judgment.
"""

import json
from dataclasses import dataclass

from da.corpus import load_words
from da.documents import main_point, validate_document
from da.firstpass import first_pass
from da.treebuild import build_document


# ---------------------------------------------------------------------------
# Contract-shaped segment stand-ins (da.segmentation may not exist yet)

@dataclass(frozen=True)
class Op:
    kind: str
    lemma: str
    index: int


@dataclass(frozen=True)
class Seg:
    start: int
    end: int
    sentence: int
    opener: Op | None


# ---------------------------------------------------------------------------
# Tree helpers

def brackets(node):
    if node["kind"] == "bracket":
        yield node
        for child in node["children"]:
            yield from brackets(child)


def leaf_refs(node):
    if node["kind"] == "prop":
        return [node["ref"]]
    out = []
    for child in node["children"]:
        out.extend(leaf_refs(child))
    return out


def span(doc, node):
    """(min start, max end) corpus range covered by a node's leaves."""
    sources = {p["id"]: p["source"] for p in doc["propositions"]}
    refs = leaf_refs(node)
    return (min(sources[r]["start"] for r in refs),
            max(sources[r]["end"] for r in refs))


def the_root(doc):
    """The first pass connects everything, so its forest has exactly one root."""
    assert doc["schemaVersion"] == 2
    assert isinstance(doc["forest"], list) and len(doc["forest"]) == 1
    return doc["forest"][0]


def by_label(doc):
    return {p["label"]: p["id"] for p in doc["propositions"]}


def the(iterable, what):
    found = list(iterable)
    assert len(found) == 1, f"expected exactly one {what}, found {len(found)}"
    return found[0]


def roundtrip(doc):
    doc2 = json.loads(json.dumps(doc))
    validate_document(doc2)
    assert main_point(doc2) == main_point(doc)


# ---------------------------------------------------------------------------
# 1 John 1:5–7

J_START, J_END = 124747, 124816

J_LABELS = ["5a", "5b", "5c", "5d", "5e",
            "6a", "6b", "6c", "6d", "6e",
            "7a", "7b", "7c", "7d"]

J_SPANS = [
    (124747, 124751),  # 5a Καὶ ἔστιν αὕτη ἡ ἀγγελία
    (124752, 124755),  # 5b ἣν ἀκηκόαμεν ἀπ’ αὐτοῦ
    (124756, 124758),  # 5c καὶ ἀναγγέλλομεν ὑμῖν,
    (124759, 124763),  # 5d ὅτι ὁ θεὸς φῶς ἐστιν
    (124764, 124770),  # 5e καὶ σκοτία ἐν αὐτῷ οὐκ ἔστιν οὐδεμία.
    (124771, 124772),  # 6a ἐὰν εἴπωμεν
    (124773, 124777),  # 6b ὅτι κοινωνίαν ἔχομεν μετ’ αὐτοῦ
    (124778, 124782),  # 6c καὶ ἐν τῷ σκότει περιπατῶμεν,
    (124783, 124783),  # 6d ψευδόμεθα
    (124784, 124788),  # 6e καὶ οὐ ποιοῦμεν τὴν ἀλήθειαν·
    (124789, 124794),  # 7a ἐὰν δὲ ἐν τῷ φωτὶ περιπατῶμεν
    (124795, 124800),  # 7b ὡς αὐτός ἐστιν ἐν τῷ φωτί,
    (124801, 124804),  # 7c κοινωνίαν ἔχομεν μετ’ ἀλλήλων
    (124805, 124816),  # 7d καὶ τὸ αἷμα Ἰησοῦ … ἁμαρτίας.
]

J_HAND_SEGMENTS = [
    Seg(124747, 124751, 0, Op("coord", "καί", 124747)),
    Seg(124752, 124755, 0, Op("rel", "ὅς", 124752)),
    Seg(124756, 124758, 0, Op("coord", "καί", 124756)),
    Seg(124759, 124763, 0, Op("sub_conj", "ὅτι", 124759)),
    Seg(124764, 124770, 0, Op("coord", "καί", 124764)),
    Seg(124771, 124772, 1, Op("sub_conj", "ἐάν", 124771)),
    Seg(124773, 124777, 1, Op("sub_conj", "ὅτι", 124773)),
    Seg(124778, 124782, 1, Op("coord", "καί", 124778)),
    Seg(124783, 124783, 1, None),
    Seg(124784, 124788, 1, Op("coord", "καί", 124784)),
    Seg(124789, 124794, 2, Op("sub_conj", "ἐάν", 124789)),
    Seg(124795, 124800, 2, Op("sub_conj", "ὡς", 124795)),
    Seg(124801, 124804, 2, None),
    Seg(124805, 124816, 2, Op("coord", "καί", 124805)),
]


def assert_1john_structure(doc):
    validate_document(doc)
    tree = the_root(doc)
    ids = by_label(doc)

    # 6a/6b: ὅτι after εἴπωμεν (verbum dicendi) → Ft/In, star on the
    # ὅτι (content) side.
    b6 = the((b for b in brackets(tree)
              if b["rel"] == "FtIn"
              and b["children"][0] == {"kind": "prop", "ref": ids["6a"]}),
             "FtIn bracket on 6a")
    assert "flag" not in b6
    assert b6["prominent"] == 1
    assert leaf_refs(b6["children"][1])[0] == ids["6b"]

    # Verse 6 conditional: [6a–6c] vs [6d, 6e], confident, star on apodosis.
    c6 = the((b for b in brackets(tree)
              if b["rel"] == "CndE" and span(doc, b) == (124771, 124788)),
             "verse-6 CndE bracket")
    assert "flag" not in c6
    assert not c6.get("reversed")
    assert c6["prominent"] == 1
    assert span(doc, c6["children"][0]) == (124771, 124782)
    apodosis6 = c6["children"][1]
    assert span(doc, apodosis6) == (124783, 124788)
    assert apodosis6["rel"] == "Ser" and apodosis6["prominent"] is None
    assert leaf_refs(apodosis6) == [ids["6d"], ids["6e"]]

    # Verse 7: 7a/7b comparison — '//' must label the ὡς child (7b), so the
    # bracket is reversed and the star sits on the main (7a) side.
    cmp7 = the((b for b in brackets(tree) if b["rel"] == "Cmp"),
               "Cmp bracket")
    assert cmp7["children"] == [{"kind": "prop", "ref": ids["7a"]},
                                {"kind": "prop", "ref": ids["7b"]}]
    assert cmp7.get("reversed") is True
    assert cmp7["prominent"] == 0
    assert "flag" not in cmp7

    # Verse 7 conditional: [7a, 7b] vs [7c, 7d], star on the apodosis packet.
    c7 = the((b for b in brackets(tree)
              if b["rel"] == "CndE" and span(doc, b) == (124789, 124816)),
             "verse-7 CndE bracket")
    assert "flag" not in c7
    assert c7["prominent"] == 1
    assert c7["children"][0] is cmp7 or span(doc, c7["children"][0]) == (124789, 124800)
    apodosis7 = c7["children"][1]
    assert span(doc, apodosis7) == (124801, 124816)
    assert apodosis7["rel"] == "Ser" and apodosis7["prominent"] is None
    assert leaf_refs(apodosis7) == [ids["7c"], ids["7d"]]

    # 5d joins as ὅτι-content: ἀναγγέλλομεν (5c) is a verbum dicendi, so the
    # ὅτι clause is Ft/In content, star on the content side.
    b5 = the((b for b in brackets(tree)
              if b["rel"] == "FtIn"
              and leaf_refs(b["children"][1])[0] == ids["5d"]),
             "FtIn bracket whose content starts at 5d")
    assert "flag" not in b5
    assert b5["prominent"] == 1
    assert ids["5c"] in leaf_refs(b5["children"][0])

    # The three sentences chain at discourse level as Series — and every
    # bracket is binary, so three sentences nest to the left: Ser[Ser[1,2],3].
    assert tree["kind"] == "bracket" and tree["rel"] == "Ser"
    assert tree["prominent"] is None
    assert len(tree["children"]) == 2
    inner = tree["children"][0]
    assert inner["kind"] == "bracket" and inner["rel"] == "Ser"
    assert inner["prominent"] is None
    assert len(inner["children"]) == 2

    # Main point of the whole passage is computable.
    mp = main_point(doc)
    assert mp and set(mp) <= {p["id"] for p in doc["propositions"]}


def test_build_document_1john_hand_segments():
    doc = build_document(J_HAND_SEGMENTS)
    assert [p["label"] for p in doc["propositions"]] == J_LABELS
    assert [(p["source"]["start"], p["source"]["end"])
            for p in doc["propositions"]] == J_SPANS
    assert_1john_structure(doc)
    roundtrip(doc)


def test_first_pass_1john_1_5_7_builds_full_tree():
    """The full analyzer runs at entry: a located paste becomes one
    proposition per clause segment, verse-lettered, all connected into a
    single labeled tree."""
    words = load_words()
    text = " ".join(w.text for w in words[J_START:J_END + 1])
    result = first_pass(text)
    assert result.alignment is not None
    assert result.alignment.exact
    assert result.alignment.ref == "1 John 1:5–7"
    doc = result.document
    props = doc["propositions"]
    assert [p["label"] for p in props] == J_LABELS
    # The segments exactly tile the passage.
    assert props[0]["source"]["start"] == J_START
    assert props[-1]["source"]["end"] == J_END
    for a, b in zip(props, props[1:]):
        assert a["source"]["end"] + 1 == b["source"]["start"]
    # Live segmentation reproduces the hand-built segments here, so the
    # classifier's pinned structure holds end to end.
    assert [(p["source"]["start"], p["source"]["end"]) for p in props] == J_SPANS
    assert_1john_structure(doc)
    roundtrip(doc)


# ---------------------------------------------------------------------------
# Hebrews 4:9–12

H_START, H_END = 116207, 116281
H_V10 = (116214, 116233)
H_V11 = (116234, 116250)
H_V12 = (116251, 116281)
H_HINA = 116241

H_HAND_SEGMENTS = [
    Seg(116207, 116213, 0, None),                                # v9
    Seg(116214, 116227, 1, None),                                # v10 main
    Seg(116228, 116233, 1, Op("sub_conj", "ὥσπερ", 116228)),     # v10 ὥσπερ
    Seg(116234, 116240, 2, Op("coord", "οὖν", 116235)),          # v11 main
    Seg(116241, 116250, 2, Op("sub_conj", "ἵνα", 116241)),       # v11 ἵνα
    Seg(116251, 116281, 3, Op("ptcp", "ζάω", 116251)),           # v12
]


def assert_hebrews_structure(doc):
    """Segmentation details (especially the v12 participles) may vary; assert
    only the explicit-connective calls, located by the corpus span of the
    supporting side."""
    validate_document(doc)
    tree = the_root(doc)

    # γάρ sentences ground what precedes: star on the supported (previous)
    # side, confident.
    g10 = the((b for b in brackets(tree)
               if b["rel"] == "Grnd" and span(doc, b["children"][1]) == H_V10),
              "Grnd bracket supported by verse 10")
    assert g10["prominent"] == 0
    assert g10.get("flag") is None
    assert not g10.get("reversed")

    g12 = the((b for b in brackets(tree)
               if b["rel"] == "Grnd" and span(doc, b["children"][1]) == H_V12),
              "Grnd bracket supported by verse 12")
    assert g12["prominent"] == 0
    assert g12.get("flag") is None

    # Σπουδάσωμεν οὖν: inference, star on the οὖν sentence (the new side).
    inf = the((b for b in brackets(tree)
               if b["rel"] == "Inf" and span(doc, b["children"][1]) == H_V11),
              "Inf bracket over the οὖν sentence")
    assert inf["prominent"] == 1
    assert inf.get("flag") is None

    # ἵνα clause: Means–End, confident, star on the ἵνα (End) child.
    med = the((b for b in brackets(tree)
               if b["rel"] == "MEd"
               and span(doc, b["children"][1])[0] == H_HINA),
              "MEd bracket whose End starts at ἵνα")
    assert med["prominent"] == 1
    assert med.get("flag") is None
    assert span(doc, med["children"][1]) == (H_HINA, 116250)

    mp = main_point(doc)
    assert mp and set(mp) <= {p["id"] for p in doc["propositions"]}


def test_build_document_hebrews_hand_segments():
    doc = build_document(H_HAND_SEGMENTS)
    assert [p["label"] for p in doc["propositions"]] == \
        ["9", "10a", "10b", "11a", "11b", "12"]
    assert_hebrews_structure(doc)

    # With this segmentation the discourse shape is fully determined:
    # Grnd[Inf[Grnd[v9, v10], v11], v12], and the star walk ends at ἵνα.
    tree = the_root(doc)
    assert tree["rel"] == "Grnd" and tree["prominent"] == 0
    inner_inf = tree["children"][0]
    assert inner_inf["rel"] == "Inf" and inner_inf["prominent"] == 1
    inner_grnd = inner_inf["children"][0]
    assert inner_grnd["rel"] == "Grnd" and inner_grnd["prominent"] == 0
    assert main_point(doc) == ["p5"]  # ἵνα μὴ … πέσῃ

    # The trailing ὥσπερ clause: comparison, reversed so '//' labels it,
    # star back on the main clause.
    cmp10 = the((b for b in brackets(tree) if b["rel"] == "Cmp"),
                "Cmp bracket in verse 10")
    assert cmp10.get("reversed") is True
    assert cmp10["prominent"] == 0
    roundtrip(doc)


def test_first_pass_hebrews_4_9_12_builds_full_tree():
    words = load_words()
    text = " ".join(w.text for w in words[H_START:H_END + 1])
    result = first_pass(text)
    assert result.alignment is not None
    assert result.alignment.ref == "Hebrews 4:9–12"
    doc = result.document
    props = doc["propositions"]
    # Live segmentation also splits verse 12 at the adverbial participle
    # διϊκνούμενος (the hand-built stage-2 segments keep v12 whole); the
    # structure helper locates brackets by whole-verse spans, so it holds
    # either way.
    assert [p["label"] for p in props] == [
        "9", "10a", "10b", "11a", "11b", "12a", "12b",
    ]
    assert_hebrews_structure(doc)
    roundtrip(doc)


# ---------------------------------------------------------------------------
# Raw mode

def test_raw_mode_english_text():
    result = first_pass("This is English text with no Greek.")
    assert result.alignment is None
    doc = result.document
    validate_document(doc)
    assert len(doc["propositions"]) == 1
    assert doc["propositions"][0]["source"]["kind"] == "raw"
    assert doc["propositions"][0]["label"] == "1"
    assert doc["forest"] == [{"kind": "prop", "ref": "p1"}]


def test_raw_mode_non_nt_greek_splits_on_punctuation():
    result = first_pass("ὁ ἄνθρωπος βλέπει τὸν κόσμον. ἡ γυνὴ γράφει.")
    assert result.alignment is None
    doc = result.document
    validate_document(doc)
    assert [(p["label"], p["source"]["text"]) for p in doc["propositions"]] == [
        ("1", "ὁ ἄνθρωπος βλέπει τὸν κόσμον"),
        ("2", "ἡ γυνὴ γράφει"),
    ]
    # Disconnected roots — no auto-relationing in raw mode either.
    assert doc["forest"] == [{"kind": "prop", "ref": "p1"}, {"kind": "prop", "ref": "p2"}]
    roundtrip(doc)


# ---------------------------------------------------------------------------
# Focused build_document unit tests

def test_verse6_alone_matches_design_worked_example():
    """docs/DESIGN.md §3: first pass on 1 John 1:6 differs from the student's
    analysis only on judgment calls (Ser vs Adv)."""
    doc = build_document([s for s in J_HAND_SEGMENTS if s.sentence == 1])
    assert [p["label"] for p in doc["propositions"]] == \
        ["6a", "6b", "6c", "6d", "6e"]
    tree = the_root(doc)
    assert tree["rel"] == "CndE" and tree["prominent"] == 1
    ft = tree["children"][0]
    assert ft["rel"] == "FtIn" and ft["prominent"] == 1
    assert ft["children"][0] == {"kind": "prop", "ref": "p1"}
    content = ft["children"][1]
    assert content["rel"] == "Ser"
    assert leaf_refs(content) == ["p2", "p3"]
    apodosis = tree["children"][1]
    assert apodosis["rel"] == "Ser"
    assert leaf_refs(apodosis) == ["p4", "p5"]
    # Star walk: conditional → apodosis packet; coordinate → whole packet.
    assert main_point(doc) == ["p4", "p5"]


def test_no_document_ever_carries_flags():
    """Confidence labeling was removed: the classifier's internal review
    bookkeeping must never reach a document."""
    doc = build_document(J_HAND_SEGMENTS)
    for bracket in brackets(the_root(doc)):
        assert "flag" not in bracket
