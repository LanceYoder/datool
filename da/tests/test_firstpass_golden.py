"""Golden tests for initial entry and the full analyzer.

``first_pass`` — what initial entry actually runs — segments a located paste
into clause propositions (stage 1) and draws the MINIMAL analysis (stage 2 in
confident-only mode). Since the DA expert's re-tier, "minimal" means every
grammar-forced call PLUS every sensible default (a reading right ~80%+ of the
time); only genuinely undecidable joins — an implicit-proposition PP, an
unknown subordinator, a speculative grouping — stay loose. (The 2026-08-29
rulings moved two of the old hold-outs in: a bare ἀλλά is an Alternative per
RULING Q1, an apposition a Ft/In per RULING Q2.) An unaligned paste still
splits on punctuation into disconnected raw propositions (no morphology, no
proposed structure).

The analyzer is also tested over hand-built, contract-shaped segments so the
classifier's calls are pinned independently of live segmentation. Passages
come from the course's worked examples: 1 John 1:5–7 (examples/da1.xlsx) and
Hebrews 4:9–12 (Five Step walkthrough). Both are fully connective-driven, so
under the new tiering their minimal analysis IS their full analysis — the
tests below assert exactly that structure, not merely "more than before".

The focused unit tests at the end pin the individual rulings (ἵνα's asking-verb
branch and its Q7 sibling rule, ὥστε ± infinitive, causal ὅτι, the καί/δέ
defaults and their Q1 contrastive branch, appositions, and the
adverbial-participle chart with Q5's narrowed attendant circumstance) against
real corpus passages. The English-cue layer
that now sits over several of those rules has its own suite in
``test_english_cues.py``; where a cue changes an expectation here, the comment
says so.
"""

import json
from dataclasses import dataclass

from da.corpus import load_words
from da.corpus.reference import resolve
from da.corpus.normalize import nfc as _L
from da.documents import main_point, validate_document
from da.firstpass import first_pass
from da.segmentation import segment
from da.treebuild import (COMMUNICATION_VOLITION, COORDINATING, _dependent_call,
                          _has_lemma, _main_verb, build_document,
                          segment_english)


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


# --- Expected-tree constructors (documents carry no flags) ------------------

def SER(first, second):
    return {"kind": "bracket", "rel": "Ser", "prominent": None,
            "children": [first, second]}


def SUB(rel, prominent, first, second, reversed_=False):
    node = {"kind": "bracket", "rel": rel, "prominent": prominent,
            "children": [first, second]}
    if reversed_:
        node["reversed"] = True
    return node


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

    # The three sentences at discourse level. RECOMPUTED for RULING Q1 and
    # RULING Q8/Q12: verse 7's ἐὰν δέ is rendered "But if we walk in the
    # light", so the δέ join is now the Alternative the student drew, and the
    # 5→6 boundary is a seam (epistolary asyndeton + a cohesion drop + the
    # English period, three soft indicators), so verse 5 stands as its own
    # section and the Alternative pair as another: Ser[5, Alt[6, 7]].
    assert tree["kind"] == "bracket" and tree["rel"] == "Ser"
    assert tree["prominent"] is None
    assert len(tree["children"]) == 2
    inner = tree["children"][1]
    assert inner["kind"] == "bracket" and inner["rel"] == "Alt"
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


def test_first_pass_1john_1_5_7_minimal_tier():
    """Entry runs the analyzer at the MINIMAL level. Re-tiered (expert
    ruling): every join in this passage is now either grammar-forced or a
    sensible default, so minimal draws the WHOLE tree —

      * 5b relative → Ft/In (sure; the old scope guard is gone);
      * 5c/5e/6c/6e/7d καί → Series (RULING: the Series default is sure);
      * 5d, 6b ὅτι after a verbum dicendi → Ft/In;
      * 6a/7a ἐάν → Conditional, 7b ὡς → Comparison;
      * 5→6 asyndeton → Series (RULING: sure);
      * 6→7 δέ rendered "But if we walk …" → ALTERNATIVE (RULING Q1), which
        is the bracket the student drew between the two conditionals.

    RECOMPUTED for RULING Q8/Q12 as well: the 5→6 boundary now carries three
    soft indicators (epistolary asyndeton, a lexical-cohesion drop, the
    English period), and softs combine, so verse 5 is a section of its own —
    which is why the Series and the Alternative nest the other way round now
    (Ser[5, Alt[6, 7]] rather than Ser[Ser[5, 6], 7]).

    The one call the 1 John student reads differently — 5d/5e as ∴ rather
    than Series — is exactly the kind of default the analyst re-labels in one
    click, which is the trade the ruling makes."""
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
    assert [(p["source"]["start"], p["source"]["end"]) for p in props] == J_SPANS

    ids = by_label(doc)
    p = {l: {"kind": "prop", "ref": ids[l]} for l in J_LABELS}
    verse5 = SUB("FtIn", 1,
                 SUB("FtIn", 1, p["5a"], SER(p["5b"], p["5c"])),
                 SER(p["5d"], p["5e"]))
    verse6 = SUB("CndE", 1,
                 SUB("FtIn", 1, p["6a"], SER(p["6b"], p["6c"])),
                 SER(p["6d"], p["6e"]))
    verse7 = SUB("CndE", 1,
                 SUB("Cmp", 0, p["7a"], p["7b"], reversed_=True),
                 SER(p["7c"], p["7d"]))
    alt = {"kind": "bracket", "rel": "Alt", "prominent": None,
           "children": [verse6, verse7]}
    assert doc["forest"] == [SER(verse5, alt)]

    # Nothing in this passage is undecidable, so minimal == Full here.
    assert doc["forest"] == build_document(segment(J_START, J_END))["forest"]
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

    # Σπουδάσωμεν οὖν: inference, star on the οὖν side (the new one).
    # SECTIONING (docs/sectioning.md): οὖν is a strong seam, so v11 opens a
    # section. RECOMPUTED for RULING Q8/Q12: v12 now opens one too — the
    # 11→12 boundary carries a lexical-cohesion drop and the English period,
    # and two softs reach the threshold — so the Inference's supported side is
    # the v11 sentence alone again and the v12 γάρ grounds everything before
    # it (see test_build_document_hebrews_hand_segments for the cost).
    inf = the((b for b in brackets(tree)
               if b["rel"] == "Inf"
               and span(doc, b["children"][1])[0] == H_V11[0]),
              "Inf bracket over the οὖν section")
    assert inf["prominent"] == 1
    assert inf.get("flag") is None
    assert span(doc, inf["children"][1]) == (H_V11[0], H_V11[1])
    assert span(doc, inf["children"][0]) == (H_START, H_V10[1])

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

    # With this segmentation the discourse shape is fully determined.
    # RECOMPUTED for RULING Q8/Q12 — and this is the clearest COST of the new
    # soft indicators. The οὖν seam still opens a section at v11, but the
    # 11→12 boundary now seams too: the two sentences share no content lemma
    # (σπουδάζω/κατάπαυσις/πίπτω against λόγος/μάχαιρα/καρδία) and the BSB
    # closes an English sentence at v11, which is 0.5 + 0.5. Three sections,
    # so the fold gives back the flat shape sectioning had fixed —
    # Grnd[Inf[Grnd[v9, v10], v11], v12], with the v12 γάρ grounding the whole
    # argument rather than the exhortation it follows. Flagged in
    # docs/sectioning.md as the calibration question the soft-pair rule
    # raises. The star walk still ends at ἵνα.
    tree = the_root(doc)
    assert tree["rel"] == "Grnd" and tree["prominent"] == 0
    assert span(doc, tree["children"][1]) == H_V12
    inference = tree["children"][0]
    assert inference["rel"] == "Inf" and inference["prominent"] == 1
    first_section = inference["children"][0]
    assert first_section["rel"] == "Grnd" and first_section["prominent"] == 0
    assert span(doc, first_section) == (H_START, H_V10[1])
    assert span(doc, inference["children"][1]) == H_V11
    assert main_point(doc) == ["p5"]  # ἵνα μὴ … πέσῃ

    # The trailing ὥσπερ clause: comparison, reversed so '//' labels it,
    # star back on the main clause.
    cmp10 = the((b for b in brackets(tree) if b["rel"] == "Cmp"),
                "Cmp bracket in verse 10")
    assert cmp10.get("reversed") is True
    assert cmp10["prominent"] == 0
    roundtrip(doc)


def test_first_pass_hebrews_4_9_12_minimal_tier():
    """Minimal entry on Hebrews, re-tiered. Everything the old strict tier
    left loose is now in: the οὖν of v11 (RULING: the whole INFERENCE class is
    always sure), its ἵνα (RULING: no asking verb in front of σπουδάσωμεν, so
    the purpose reading M/Ed is the sure default), and the two v12 participles
    (Ζῶν precedes its clause and διϊκνούμενος follows it — both present, so
    chart rules 10 and 9). The γάρ grounds and the ὥσπερ comparison keep the
    places they already held."""
    words = load_words()
    text = " ".join(w.text for w in words[H_START:H_END + 1])
    result = first_pass(text)
    assert result.alignment is not None
    assert result.alignment.ref == "Hebrews 4:9–12"
    doc = result.document
    props = doc["propositions"]
    # Live segmentation also splits verse 12 at the adverbial participle
    # διϊκνούμενος (the hand-built stage-2 segments keep v12 whole).
    assert [p["label"] for p in props] == [
        "9", "10a", "10b", "11a", "11b", "12a", "12b",
    ]
    ids = by_label(doc)
    p = {l: {"kind": "prop", "ref": i} for l, i in ids.items()}
    # SECTIONING: the οὖν seam opens a section at v11 and — RECOMPUTED for
    # RULING Q8/Q12 — the cohesion drop plus the English period opens another
    # at v12, so the three sentences are three sections and the v12 γάρ
    # grounds the whole of what precedes it (see
    # test_build_document_hebrews_hand_segments for the cost, and
    # docs/sectioning.md for the calibration question it raises).
    assert doc["forest"] == [
        SUB("Grnd", 0,
            SUB("Inf", 1,
                SUB("Grnd", 0, p["9"],
                    SUB("Cmp", 0, p["10a"], p["10b"], reversed_=True)),
                SUB("MEd", 1, p["11a"], p["11b"])),
            SUB("WEd", 0, p["12a"], p["12b"], reversed_=True)),
    ]
    # Three sections, so the passage carries two colour blocks: they open at
    # the first proposition of the οὖν section (11a) and of the γάρ one (12a).
    assert doc["sections"] == [{"start": ids["11a"], "color": 1},
                               {"start": ids["12a"], "color": 2}]
    # Nothing here is undecidable either, so minimal == Full.
    assert doc["forest"] == build_document(segment(H_START, H_END))["forest"]
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


# ---------------------------------------------------------------------------
# The re-tiering rulings, pinned against real corpus passages.
#
# Each test locates a genuine NT example through the corpus loader, segments
# it, and asks the classifier for its (relationship, sure) call —
# ``sure`` being exactly "this join belongs in the minimal analysis".

def passage(ref: str):
    """Live segments for a reference, plus the segment list itself."""
    r = resolve(ref)
    return segment(r.start, r.end), (r.start, r.end)


def opened_by(segments, lemma: str) -> int:
    """Index of the (first) segment opened by ``lemma``."""
    for i, s in enumerate(segments):
        if s.opener is not None and s.opener.lemma == lemma:
            return i
    raise AssertionError(f"no segment opened by {lemma!r}")


def call_for(segments, index: int, precedes: bool):
    """The classifier's (rel, sure) call for one dependent segment.
    ``precedes`` is the shift-reduce position the assembler would pass: True
    when the segment is held and attaches forward, False when it attaches
    backward to the packet already built."""
    return _dependent_call(segments[index], index, segments, load_words(),
                           precedes=precedes)


# --- ἵνα: the asking-verb conditional rule ---------------------------------

def test_hina_after_an_asking_verb_is_content_ftin():
    """John 17:15 οὐκ ἐρωτῶ | ἵνα ἄρῃς αὐτοὺς ἐκ τοῦ κόσμου — ἐρωτάω is an
    asking verb, so the ἵνα clause states the CONTENT of the request."""
    segs, _ = passage("John 17:15")
    assert call_for(segs, opened_by(segs, "ἵνα"), precedes=False) == \
        ("FtIn", True)
    # The verse's SECOND ἵνα (ἀλλ’ ἵνα τηρήσῃς) also depends on ἐρωτῶ, but its
    # immediately preceding clause is the first ἵνα clause, so the one-clause
    # lookback cannot see that far (expert-questions.md Open #8). RECOMPUTED
    # for the English-cue layer: the BSB writes "that You keep them from the
    # evil one", and the "that" cue outranks the verb list — so the content
    # reading now comes out right without widening the lookback. See
    # da/tests/test_english_cues.py.
    assert call_for(segs, 2, precedes=False) == ("FtIn", True)


def test_hina_without_an_asking_verb_is_purpose_med():
    """Hebrews 4:11 σπουδάσωμεν … | ἵνα μὴ … πέσῃ. σπουδάζω is not an asking
    verb, so purpose is the sure default — and the BSB's "so that" cue agrees
    with it (for ἵνα that phrase reads as purpose, not result)."""
    heb, _ = passage("Hebrews 4:11")
    assert call_for(heb, opened_by(heb, "ἵνα"), precedes=False) == \
        ("MEd", True)


def test_hina_that_needs_corroboration_before_it_beats_purpose():
    """John 3:16 … ἔδωκεν, | ἵνα πᾶς ὁ πιστεύων … μὴ ἀπόληται.

    RECOMPUTED for RULING Q9 — and this asserts the FIX for what used to be
    the cue layer's clearest cost. The BSB renders this purpose clause with
    the archaic English purpose-"that" ("that everyone who believes in Him
    shall not perish"), and the cue table reads a leading "that" as content,
    so the call used to flip to Ft/In here against the verb-list rule's
    correct purpose reading.

    The ruling qualifies the "that" half of the ἵνα cue: it outranks the
    purpose default ONLY WITH CORROBORATION — a communication or volition verb
    in the preceding clause. δίδωμι is neither, so the cue does not fire and
    John 3:16 reads Means–End again."""
    segs, _ = passage("John 3:16")
    i = opened_by(segs, "ἵνα")
    words = load_words()
    assert segment_english(segs[i], words).startswith("that")
    assert not _has_lemma(segs[i - 1], words, COMMUNICATION_VOLITION)
    assert call_for(segs, i, precedes=False) == ("MEd", True)


def test_hina_that_with_a_communication_verb_is_still_content():
    """The other side of RULING Q9: Mark 5:43 καὶ διεστείλατο αὐτοῖς πολλὰ |
    ἵνα μηδεὶς γνοῖ τοῦτο — "He gave strict orders that no one should know
    about this". διαστέλλομαι is on the communication/volition list, so the
    "that" is corroborated and the clause states the CONTENT of the order."""
    segs, _ = passage("Mark 5:43")
    i = opened_by(segs, "ἵνα")
    words = load_words()
    assert segment_english(segs[i], words).startswith("that")
    assert _has_lemma(segs[i - 1], words, COMMUNICATION_VOLITION)
    assert call_for(segs, i, precedes=False) == ("FtIn", True)


def test_hina_inherits_a_coordinate_siblings_call():
    """RULING Q7, the sibling rule. John 17:15 οὐκ ἐρωτῶ | ἵνα ἄρῃς αὐτοὺς ἐκ
    τοῦ κόσμου ἀλλ' | ἵνα τηρήσῃς αὐτοὺς ἐκ τοῦ πονηροῦ — both ἵνα clauses are
    governed by ἐρωτῶ, but the one-clause look-back in front of the SECOND one
    sees only the first ἵνα clause, never the verb.

    The ruling: when a coordinating conjunction stands directly before the
    subordinator (here the ἀλλ᾽, which segmentation leaves at the end of the
    first ἵνα segment) and an earlier ἵνα stands in the same sentence, the
    second INHERITS the first's call. Both come out content.

    This is also the case the cue layer used to carry on its own — the BSB
    writes "that" over both — which RULING Q9 no longer lets it do
    unaided: ἐρωτάω is on the communication/volition list for the first
    clause, and the sibling rule carries the second."""
    segs, _ = passage("John 17:15")
    words = load_words()
    assert _L(words[segs[2].opener.index - 1].lemma) in COORDINATING
    assert call_for(segs, 1, precedes=False) == ("FtIn", True)
    assert call_for(segs, 2, precedes=False) == ("FtIn", True)


# --- ὥστε: sure only with an infinitive ------------------------------------

def test_hoste_with_an_infinitive_is_a_sure_cause_effect():
    """1 Thess 1:7 ὥστε γενέσθαι ὑμᾶς τύπον … — the clause's predicate is the
    infinitive γενέσθαι (mood 'N'), the textbook result construction."""
    segs, _ = passage("1 Thessalonians 1:6-7")
    assert call_for(segs, opened_by(segs, "ὥστε"), precedes=False) == \
        ("CE", True)


def test_hoste_with_a_finite_verb_is_a_best_guess_only():
    """John 3:16 … ὥστε τὸν υἱὸν τὸν μονογενῆ ἔδωκεν — a finite verb, the
    actual-result use. Still C/E in Full, but never in minimal."""
    segs, _ = passage("John 3:16")
    assert call_for(segs, opened_by(segs, "ὥστε"), precedes=False) == \
        ("CE", False)


# --- ὅτι: causal is now sure -----------------------------------------------

def test_causal_hoti_is_a_sure_ground():
    """Matt 5:3 Μακάριοι οἱ πτωχοὶ τῷ πνεύματι, | ὅτι αὐτῶν ἐστιν ἡ βασιλεία
    — no verbum dicendi in front of it, so the ὅτι is causal."""
    segs, _ = passage("Matthew 5:3")
    assert call_for(segs, opened_by(segs, "ὅτι"), precedes=False) == \
        ("Grnd", True)
    # It reaches the document: the whole verse is one sure Ground bracket.
    doc = build_document(segs, confident_only=True)
    assert doc["forest"] == [
        SUB("Grnd", 0, {"kind": "prop", "ref": "p1"},
            {"kind": "prop", "ref": "p2"}),
    ]


def test_hoti_after_a_verbum_dicendi_stays_content():
    """Matt 9:18 … λέγων | ὅτι Ἡ θυγάτηρ μου ἄρτι ἐτελεύτησεν."""
    segs, _ = passage("Matthew 9:18")
    assert call_for(segs, opened_by(segs, "ὅτι"), precedes=False) == \
        ("FtIn", True)


# --- καί / δέ: the Series defaults reach minimal ----------------------------

def test_bare_kai_clauses_join_as_series_in_minimal():
    """John 1:1 — three καί-joined clauses. Every bracket is binary, so the
    run nests to the left; RULING: a καί Series is a sure default, so minimal
    draws it instead of leaving three loose roots."""
    segs, _ = passage("John 1:1")
    doc = build_document(segs, confident_only=True)
    p1, p2, p3 = ({"kind": "prop", "ref": f"p{i}"} for i in (1, 2, 3))
    assert doc["forest"] == [SER(SER(p1, p2), p3)]


def test_a_contrastive_de_joins_as_alternative_in_minimal():
    """Mark 1:8 ἐγὼ ἐβάπτισα ὑμᾶς ὕδατι, | αὐτὸς δὲ βαπτίσει ὑμᾶς …

    RECOMPUTED for RULING Q1: no μέν stands in front of this δέ, but the BSB
    writes "but He will baptize you with the Holy Spirit", so the join is the
    Alternative rather than the Series default — sure either way. A δέ the BSB
    does NOT render contrastively keeps Series
    (test_a_narrative_de_keeps_its_series_default)."""
    segs, _ = passage("Mark 1:8")
    assert [s.opener.lemma for s in segs if s.opener] == ["δέ"]
    doc = build_document(segs, confident_only=True)
    assert doc["forest"] == [{"kind": "bracket", "rel": "Alt",
                              "prominent": None,
                              "children": [{"kind": "prop", "ref": "p1"},
                                           {"kind": "prop", "ref": "p2"}]}]


def test_a_narrative_de_keeps_its_series_default():
    """Matt 1:2 Ἀβραὰμ ἐγέννησεν τὸν Ἰσαάκ, | Ἰσαὰκ δὲ ἐγέννησεν τὸν Ἰακώβ …
    — the genealogy's δέ carries the account onward and the BSB writes "and",
    so RULING Q1's contrastive branch does not fire and the Series default
    stands (sure)."""
    segs, _ = passage("Matthew 1:2")
    doc = build_document(segs, confident_only=True)
    assert all(b["rel"] == "Ser" for b in brackets(doc["forest"][0]))


# --- Adverbial participles (docs/participle-rules.md) ----------------------

def test_participle_rule_1_kaiper_is_adversative():
    """Heb 5:8 καίπερ ὢν υἱός, | ἔμαθεν … — the particle makes the concession
    explicit, so the reading is not a guess at all."""
    segs, _ = passage("Hebrews 5:8")
    i = opened_by(segs, "εἰμί")
    assert call_for(segs, i, precedes=True) == ("Adv", True)
    tree = build_document(segs, confident_only=True)["forest"]
    # Adv labels the concessive child; the star stays on the main clause.
    assert len(tree) == 1 and tree[0]["rel"] == "Adv"
    assert tree[0]["prominent"] == 1
    assert not tree[0].get("reversed")
    assert tree[0]["children"][0] == {"kind": "prop", "ref": "p1"}


def test_participle_rule_2_genitive_absolute_is_temporal():
    """Matt 8:5 Εἰσελθόντος δὲ αὐτοῦ εἰς Καφαρναοὺμ | προσῆλθεν αὐτῷ
    ἑκατόνταρχος — a genitive participle with its own genitive subject.

    This one also shows the precedence order doing real work: the participle
    is aorist and the main verb is an aorist indicative, so without rule 2 the
    attendant-circumstance rule (7) would coordinate it as Series."""
    segs, _ = passage("Matthew 8:5")
    i = opened_by(segs, "εἰσέρχομαι")
    assert call_for(segs, i, precedes=True) == ("Tmp", True)
    tree = build_document(segs, confident_only=True)["forest"]
    assert len(tree) == 1 and tree[0]["rel"] == "Tmp"
    assert tree[0]["prominent"] == 1      # star on the main clause
    assert tree[0]["children"][0] == {"kind": "prop", "ref": "p1"}


def test_participle_rule_3_future_participle_is_purpose():
    """Acts 8:27 … ὃς ἐληλύθει | προσκυνήσων εἰς Ἰερουσαλήμ — "future
    adverbial participles always belong here"."""
    segs, _ = passage("Acts 8:27")
    i = opened_by(segs, "προσκυνέω")
    assert load_words()[segs[i].opener.index].tense == "F"
    assert call_for(segs, i, precedes=False) == ("MEd", True)


def test_participle_rule_4_legon_rides_with_its_dicendi_clause():
    """Matt 9:18 … προσεκύνει αὐτῷ | λέγων | ὅτι … — the redundant participle
    of saying joins its clause as the WAY the saying happened; the Ft/In over
    the speech content is the dicendi machinery's own join, not a second
    bracket around the participle."""
    segs, _ = passage("Matthew 9:18")
    i = opened_by(segs, "λέγω")
    assert call_for(segs, i, precedes=False) == ("WEd", True)


def test_participle_rule_7_attendant_circumstance_needs_an_imperative():
    """Matt 2:8 Πορευθέντες | ἐξετάσατε ἀκριβῶς περὶ τοῦ παιδίου — aorist
    participle before an aorist IMPERATIVE: the chart's five-feature test, and
    the shape RULING Q5 keeps. Coordinate, so the bracket has no star."""
    segs = segment(561, 566)
    i = opened_by(segs, "πορεύομαι")
    words = load_words()
    assert words[_main_verb(segs[i], segs, True, words).index].mood == "D"
    assert call_for(segs, i, precedes=True) == ("Ser", True)
    doc = build_document(segs, confident_only=True)
    assert doc["forest"] == [SER({"kind": "prop", "ref": "p1"},
                                {"kind": "prop", "ref": "p2"})]


def test_participle_rule_7_no_longer_fires_on_a_narrative_indicative():
    """Matt 2:11 καὶ ἐλθόντες εἰς τὴν οἰκίαν | εἶδον τὸ παιδίον … — aorist
    participle before an aorist INDICATIVE.

    RECOMPUTED for RULING Q5. The chart's simplified five-feature test could
    not tell "on coming to the house they saw" from "they came and saw", so it
    coordinated every narrative aorist pair as attendant circumstance (240 of
    them in Matthew–Luke alone with no English cue to correct it, including
    the chart's own Matt 4:2 νηστεύσας … ἐπείνασεν, which Wallace reads
    temporally). The expert restricts rule 7 to an aorist IMPERATIVE main
    verb; this falls through to rule 8, "after …"."""
    segs, _ = passage("Matthew 2:11")
    i = opened_by(segs, "ἔρχομαι")
    words = load_words()
    main = _main_verb(segs[i], segs, True, words)
    assert (main.tense, main.mood) == ("A", "I")
    assert call_for(segs, i, precedes=True) == ("Tmp", True)


def test_an_aorist_participle_following_its_clause_is_still_temporal():
    """RULING Q4, recorded rather than changed: the Wallace/Keating chart has
    no rule for an aorist participle FOLLOWING its clause, and the expert
    confirms the residual Temporal as the default (the 1 Thess 1:6 W/Ed
    reading is the student's, not the rule's). Matt 27:66's σφραγίσαντες reads
    W/Ed only because the BSB writes "by sealing the stone"; with no cue the
    residual stands, as here in Mark 1:31 ἤγειρεν αὐτὴν κρατήσας τῆς χειρός."""
    segs, _ = passage("Mark 1:31")
    i = opened_by(segs, "κρατέω")
    assert call_for(segs, i, precedes=False) == ("Tmp", True)


def test_an_apposition_joins_minimal():
    """RULING Q2. Eph 1:13 … τὸν λόγον τῆς ἀληθείας, | τὸ εὐαγγέλιον τῆς
    σωτηρίας ὑμῶν — the apposition restates what it stands beside, which is
    what makes it an apposition, so the Ft/In is a sensible default like any
    other and JOINS MINIMAL (it used to be a Full-only guess). What keeps the
    IMPLICIT-PROPOSITION PPs of the same passage out of minimal is a different
    question — whether the proposition is drawable at all."""
    segs, _ = passage("Ephesians 1:13-14")
    i = [k for k, s in enumerate(segs)
         if s.opener is not None and s.opener.kind == "appos"][0]
    assert call_for(segs, i, precedes=False) == ("FtIn", True)
    kept = list(brackets(build_document(segs, confident_only=True)["forest"][0]))
    assert any(b["rel"] == "FtIn" for b in kept)


def test_no_document_ever_carries_flags():
    """Confidence labeling is not part of the product: the builder sets no
    ``flag`` anywhere, so no document it produces can carry one."""
    doc = build_document(J_HAND_SEGMENTS)
    for bracket in brackets(the_root(doc)):
        assert "flag" not in bracket
