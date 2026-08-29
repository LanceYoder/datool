"""Golden tests for stage 2 (auto-relationing) against the students' trees.

The four example spreadsheets carry the students' full bracket analyses:
relationship symbols with stars, nested by grid column. Those trees are
hand-encoded below (cell coordinates in comments) over 0-based proposition
ROW indexes, and scored against ``build_document`` bracket by bracket.
Further worked examples exist only as photographed hand-drawn trees over an
English translation; those are encoded the same way, except the row → Greek
span mapping is hand-transcribed (see IMAGE_CASES) instead of derived from
a spreadsheet. Scoring is identical:

  EXACT     the tool has a bracket with the same child word-spans (grouping),
            the same relationship, and the same starred child;
  GROUPED   same child spans, different relationship/star;
  missed    no bracket with that grouping at all.

The pinned expectations ARE the current scorecard — DA1 8/13, DA2 2/5,
DA3 5/6 (the connective-driven chain), DA4 1/6, Acts 2:37–41 4/15 — so any
classifier change that loses a currently-correct call fails loudly, and any
improvement shows up as a deliberate expectation update. The known
divergences, in comments, are the discussion list for improving stage 2.

DA3's verses 9d-10b interior is NOT pinned: the student's bare purpose
infinitives (δουλεύειν / ἀναμένειν) are not first-pass splits (an OPEN
method question — contextual, not grammatical), so the structure above them
is unreachable, and the sheet's label grid alone does not settle the
student's exact nesting there.
"""

import pytest

openpyxl = pytest.importorskip("openpyxl")

from da.corpus import align
from da.segmentation import segment
from da.treebuild import build_document

from .test_examples_golden import CASES, boundary_positions, student_rows


def B(name: str, rel: str, star, *children) -> dict:
    """A student bracket: children are row indexes, [row…] spans, or brackets."""
    return {"name": name, "rel": rel, "star": star, "children": list(children)}


# --- Student trees (cell coordinates from the spreadsheets in comments) ------

# DA1 rows: 0-4 = 5a-5e, 5-9 = 6a-6e, 10-13 = 7a-7d.
DA1 = B("top-inf", "Inf", 1,                              # B30 '∴*'
        B("v5-ftin", "FtIn", 1,                           # D12 'Ft' / D16 'In*'
          B("v5-ftin-inner", "FtIn", 1, 0,                # E9 'Ft' / E13 'In*'
            B("v5-ser", "Ser", None, 1, 2)),              # F13 'S'
          B("v5-inf", "Inf", 1, 3, 4)),                   # F18 '∴*' on 5e
        B("alt", "Alt", None,                             # C30 'Alt'
          B("v6-cnde", "CndE", 1,                         # D21 'C?' / D27 'E*'
            B("v6-adv", "Adv", 0,                         # E24 'Adv', E21 '*'
              B("v6-ftin", "FtIn", 1, 5, 6), 7),          # F19 'Ft' / F22 'In*'
            B("v6-ser", "Ser", None, 8, 9)),              # F27 'S'
          B("v7-cnde", "CndE", 1,                         # E29 'C?' / E35 'E*'
            B("v7-cmp", "Cmp", 0, 10, 11),                # F32 '//', F29 '*'
            B("v7-ser", "Ser", None, 12, 13))))           # F35 'S'

# DA2 rows: 0-5 = 9a, 9b, 10a, 10b, 11a, 11b.
DA2 = B("top-med", "MEd", 1,                              # E15 'M' / E18 'Ed*'
        B("med-10a", "MEd", 1,                            # F13 'M' / F16 'Ed*'
          B("ftin-9", "FtIn", 1, 0, 1), 2),               # G11 'Ft' / G14 'In*'
        B("wed", "WEd", 0, 3,                             # F17 'Ed*' / F22 'W'
          B("ftin-11", "FtIn", 1, 4, 5)))                 # G19 'Ft' / G22 'In*'

# DA3 rows: 0-11 = 6a, 6b, 7, 8a, 8b, 8c, 9a, 9b, 9c, 9d, 10a, 10b.
# (Right-hand copy, columns X-AE.) The 9d-10b interior stays unpinned — see
# the module docstring; the v9-10 packet appears only as a leaf SPAN.
DA3 = B("grnd-outer", "Grnd", 0,                          # Y27 '*' / Y34 'G'
        B("grnd-inner", "Grnd", 0,                        # X21 '*' / X28 'G'
          B("ce-67", "CE", 1,                             # AC17 'C' / AC22 'E*'
            B("wed-6", "WEd", 0, 0, 1), 2),               # AD17 'Ed*' / AD20 'W'
          B("ce-8", "CE", 1,                              # AC25 'C' / AC28 'E*'
            B("negpos", "NegPos", 1, 3, 4), 5)),          # AD23 '-' / AD26 '+*'
        list(range(6, 12)))

# DA4 rows: 0-6 = 13a, 13b, 13c, 13d, 14a, 14b, 14c.
DA4 = B("top-med", "MEd", 1,                              # D18 'M' (Ed side implied)
        B("tmp-13", "Tmp", 1,                             # E13 'T' / E19 '*'
          B("prog", "Prog", None,                         # F14 'P'
            B("ftin-13ab", "FtIn", 1, 0, 1), 2),          # G10 'Ft' / G13 'In*'
          B("ftin-13d", "FtIn", 1, 3,                     # F16 'Ft' / F19 'In*'
            B("tmp-14", "Tmp", 0, 4, 5))),                # G21 'T', G18 '*'
        6)

STUDENT_TREES = {
    "1 John 1:5–7": DA1,
    "Philippians 1:9–11": DA2,
    "1 Thessalonians 1:6–10": DA3,
    "Ephesians 1:13–14": DA4,
}

# --- Image-sourced cases (hand-drawn trees over an English translation) ------
#
# Each case hand-transcribes the drawing: the English rows are mapped to the
# corpus span of the SAME clause in the SBLGNT (contiguous, tiling the
# passage in order), and the bracket tree is encoded with B() exactly as for
# the spreadsheets. Where the translation reorders words, a row's span is the
# Greek words whose content it carries.

# Acts 2:37–41 (photo). 16 rows; labels in the drawing quoted in comments.
ACTS_ROWS = [
    (65642, 65643),  # 0  37a Ἀκούσαντες δὲ            "Now when they heard this,"
    (65644, 65646),  # 1  37b κατενύγησαν τὴν καρδίαν  "they were cut to the heart"
    (65647, 65655),  # 2  37c εἶπόν τε πρὸς …          "and they said to Peter …,"
    (65656, 65659),  # 3  37d Τί ποιήσωμεν …           "What shall we do, brothers?"
    (65660, 65663),  # 4  38a Πέτρος δὲ πρὸς αὐτούς·   "And Peter said to them,"
    (65664, 65664),  # 5  38b Μετανοήσατε,             "Repent
    (65665, 65678),  # 6  38c καὶ βαπτισθήτω …         "and be baptized … your sins"
    (65679, 65685),  # 7  38d καὶ λήμψεσθε …           "and you will receive …"
    (65686, 65699),  # 8  39a ὑμῖν γάρ ἐστιν …         "For the promise is …far off"
    (65700, 65706),  # 9  39b ὅσους ἂν προσκαλέσηται … "as many as the Lord … calls"
    (65707, 65711),  # 10 40a ἑτέροις τε λόγοις …      "…other words he testified"
    (65712, 65714),  # 11 40b καὶ παρεκάλει αὐτοὺς     "and was exhorting them"
    (65715, 65715),  # 12 40c λέγων·                   "saying,"
    (65716, 65722),  # 13 40d Σώθητε ἀπὸ …             "Be saved from …"
    (65723, 65730),  # 14 41a οἱ μὲν οὖν ἀποδεξάμενοι… "So those who received …"
    (65731, 65739),  # 15 41b καὶ προσετέθησαν …       "and there were added …"
]

ACTS = B("top-sr", "SR", 1,                           # far-left 'S' / 'R*'
         B("sr-37", "SR", 1,                          # 's' / 'R*' inside v37
           B("tmp-37", "Tmp", 1, 0,                   # 'T' on 37a, '*' on pair
             B("ser-37bc", "Ser", None, 1, 2)),       # 'S'
           3),
         B("ser-38-41", "Ser", None,                  # 'S' at the fold
           B("ftin-38", "FtIn", 1, 4,                 # 'Ft' / 'In*'
             B("grnd-38", "Grnd", 0,                  # '*' / 'G' (γάρ v39)
               B("prog-38", "Prog", None,             # 'P'
                 B("ser-38bc", "Ser", None, 5, 6), 7),  # 'S'
               B("ftin-39", "FtIn", 1, 8, 9))),       # 'Ft' / 'In*'
           B("ce-40-41", "CE", 1,                     # 'C' / 'E*'
             B("ftin-40", "FtIn", 1,                  # 'Ft' / 'In*'
               B("wed-40", "WEd", 0,                  # 'Ed*' / 'W' (λέγων)
                 B("ser-40ab", "Ser", None, 10, 11), 12),  # 'S'
               13),
             B("prog-41", "Prog", None, 14, 15))))    # 'P'

# The pinned Acts scorecard: narrative is the classifier's weak suit. What
# matches is again the connective/participle-driven tail of v40 — the λέγων
# W/Ed exactly (reversed, star on the Ed side; chart rule 4 keeps the
# redundant participle of saying riding with its dicendi clause) and both
# v40/v37 series. Binary coordinate chaining is what earns ser-38bc: a run of
# τε/δέ/asyndeton clauses nests to the left, one bracket per join, so the
# pairs the student drew can appear instead of one flat packet. tmp-37 is
# GAINED by the English-cue layer: chart rule 7 (aorist participle before an
# aorist indicative) coordinates Ἀκούσαντες as attendant-circumstance Series,
# and its simplified test cannot tell "when they heard" from "they heard and
# …" — but the BSB writes "When the people heard this", and the cue outranks
# rules 5–11. The student's Temporal reading now matches exactly.
# ftin-40 is GAINED by SECTIONING (docs/sectioning.md): the speech of v40
# opens a quotation, which is a hard seam — and by the expert's ruling the
# speech verb rides WITH the speech, so the seam falls before the dicendi
# sentence (… καὶ παρεκάλει αὐτοὺς λέγων·) rather than between it and
# "Σώθητε …". That dicendi sentence and its speech are therefore one section,
# and the Ft/In over the speech content scopes to it alone instead of to
# everything from v37 — exactly the bracket the drawing puts there.
# Still missed: the S/R speech frames have no morphological signal, the tool
# splits v39 at τοῖς εἰς μακράν rather than ὅσους, reads οὖν (v41) as Inf
# where the student draws C/E — the expert's ruling makes that Inference sure
# — and it over-splits ὡσεὶ τρισχίλιαι in v41.
IMAGE_CASES = [
    ("Acts 2:37–41", ACTS_ROWS, ACTS, {
        "exact": {"ser-37bc", "ser-38bc", "wed-40", "ser-40ab", "tmp-37",
                  "ftin-40"},
        "grouped": {"sr-37", "prog-38"},
    }),
]

# The pinned scorecard. EXACT entries must stay exact; GROUPED entries must
# keep at least their grouping (they name the current relationship/star
# divergences — the improvement backlog for stage 2).
EXPECTED = {
    "1 John 1:5–7": {
        # Missing: top-inf + alt (asyndeton between sentences folds to a flat
        # Ser default) and the student's Adv reading of 6c (v6-adv, v6-ftin).
        "exact": {"v5-ftin", "v5-ftin-inner", "v5-ser", "v6-cnde", "v6-ser",
                  "v7-cnde", "v7-cmp", "v7-ser"},
        # 5d-5e: student hears "and THEREFORE" (∴); the tool's καί says Ser.
        "grouped": {"v5-inf"},
    },
    "Philippians 1:9–11": {
        # ftin-9 GAINED by the expert's ἵνα conditional rule: προσεύχομαι is
        # an asking verb, so "καὶ τοῦτο προσεύχομαι ἵνα …" states the CONTENT
        # of the prayer (Ft/In) — exactly the student's reading — instead of
        # the old flat purpose default. The 10b-11b tail still nests
        # differently throughout.
        "exact": {"med-10a", "ftin-9"},
        "grouped": set(),
    },
    "1 Thessalonians 1:6–10": {
        # The connective-driven chain: two γάρ Grounds, both ὥστε C/E pairs
        # (both are ὥστε + infinitive, so both stay sure), and the ἀλλά -/+.
        # wed-6 LOST to exact by the participle ruling: δεξάμενοι is an aorist
        # participle FOLLOWING its clause, a case the Wallace/Keating chart
        # gives no rule for, so it lands in the residual tier (Tmp) where the
        # student reads means (W/Ed). The grouping still matches — the analyst
        # re-labels one bracket. Flagged for the expert as the residual tier's
        # main cost.
        "exact": {"grnd-outer", "grnd-inner", "ce-67", "ce-8", "negpos"},
        "grouped": {"wed-6"},
    },
    "Ephesians 1:13–14": {
        "exact": {"ftin-13ab"},
        # prog: student joins 13c as a coordinate Progression; the tool
        # subordinates it (Ft/In). The temporal readings (tmp-13, tmp-14) have
        # no morphological signal, and the tool's top splits differently.
        "grouped": {"prog"},
    },
}


def _leaf_span(node, row_spans):
    if isinstance(node, int):
        return row_spans[node]
    if isinstance(node, list):
        return (row_spans[node[0]][0], row_spans[node[-1]][1])
    first = _leaf_span(node["children"][0], row_spans)
    last = _leaf_span(node["children"][-1], row_spans)
    return (first[0], last[1])


def _student_brackets(node, row_spans, out):
    if isinstance(node, (int, list)):
        return out
    out.append({
        "name": node["name"],
        "rel": node["rel"],
        "star": node["star"],
        "kids": tuple(_leaf_span(c, row_spans) for c in node["children"]),
    })
    for child in node["children"]:
        _student_brackets(child, row_spans, out)
    return out


def _tool_brackets(doc):
    sources = {p["id"]: p["source"] for p in doc["propositions"]}

    def span(node):
        if node["kind"] == "prop":
            s = sources[node["ref"]]
            return (s["start"], s["end"])
        return (span(node["children"][0])[0], span(node["children"][-1])[1])

    out = []

    def walk(node):
        if node["kind"] != "bracket":
            return
        out.append({
            "rel": node["rel"],
            "star": node.get("prominent"),
            "kids": tuple(span(c) for c in node["children"]),
        })
        for child in node["children"]:
            walk(child)

    for root in doc["forest"]:
        walk(root)
    return out


def _assert_scorecard(tree, row_spans, start, end, expected):
    student = _student_brackets(tree, row_spans, [])
    doc = build_document(segment(start, end))
    tool = _tool_brackets(doc)
    tool_exact = {(b["rel"], b["star"], b["kids"]) for b in tool}
    tool_groupings = {b["kids"] for b in tool}

    exact = {b["name"] for b in student
             if (b["rel"], b["star"], b["kids"]) in tool_exact}
    grouped = {b["name"] for b in student
               if b["name"] not in exact and b["kids"] in tool_groupings}

    assert exact == expected["exact"], (
        f"exact-match set changed: gained {sorted(exact - expected['exact'])}, "
        f"lost {sorted(expected['exact'] - exact)}"
    )
    assert grouped >= expected["grouped"], (
        f"grouping lost for {sorted(expected['grouped'] - grouped)}"
    )


@pytest.mark.parametrize(
    "filename,ref", [(c[0], c[1]) for c in CASES], ids=[c[0][:21] for c in CASES]
)
def test_relationing_scorecard(filename, ref):
    rows = student_rows(filename)
    alignment = align(" ".join(rows))
    assert alignment is not None and alignment.ref == ref

    bounds = sorted(boundary_positions(rows, alignment.start, alignment.end))
    row_spans = list(zip(
        [alignment.start] + bounds,
        [b - 1 for b in bounds] + [alignment.end],
    ))
    assert len(row_spans) == len(rows)

    _assert_scorecard(STUDENT_TREES[ref], row_spans, alignment.start,
                      alignment.end, EXPECTED[ref])


# Minimal mode: what entry actually ships.
#
# The old contract here was "every surviving bracket is one the student drew
# EXACTLY" — 100% precision against the diagrams. The DA expert's re-tier
# RETIRES that contract: minimal now carries sensible defaults (a reading
# right ~80%+ of the time) as well as grammar-forced calls, and a default is
# by definition something a particular student may read otherwise. What
# replaces it is a pinned scorecard, so every classifier change still has to
# be argued for bracket by bracket:
#
#   kept          how many brackets minimal draws (the recall side);
#   exact         the student brackets minimal reproduces exactly;
#   contradicts   the student brackets minimal groups the same way but
#                 labels differently — the price of the defaults, named.
#
# Everything else minimal draws is structure the student's diagram simply
# does not pair (usually because the tool's segmentation differs there).
MINIMAL_SCORECARD = {
    "1 John 1:5–7": {
        "kept": 13,
        "exact": {"v5-ftin", "v5-ftin-inner", "v5-ser", "v6-cnde", "v6-ser",
                  "v7-cnde", "v7-cmp", "v7-ser"},
        # 5d-5e: the student hears "and THEREFORE" (∴); the καί says Series.
        "contradicts": {"v5-inf"},
    },
    "Philippians 1:9–11": {
        # Only the ἵνα content bracket: the 10b-11b tail is built out of
        # appositions and implicit-proposition PPs, which stay unruled and
        # therefore out of minimal — and their uncertainty cascades upward.
        "kept": 1,
        "exact": {"ftin-9"},
        "contradicts": set(),
    },
    "1 Thessalonians 1:6–10": {
        "kept": 10,
        "exact": {"grnd-outer", "grnd-inner", "ce-67", "ce-8", "negpos"},
        # δεξάμενοι: residual-tier Tmp where the student reads W/Ed.
        "contradicts": {"wed-6"},
    },
    "Ephesians 1:13–14": {
        # The relative clause of 13b (ἐν ᾧ καὶ πιστεύσαντες …) is the only
        # sure join; the student's own bracket there spans different rows.
        "kept": 1,
        "exact": set(),
        "contradicts": set(),
    },
    "Acts 2:37–41": {
        "kept": 12,
        # tmp-37 GAINED by the English cue: the BSB's "When the people heard
        # this" overrides the attendant-circumstance Series of chart rule 7.
        # ftin-40 GAINED by SECTIONING: the v40 quote seam rides back over the
        # dicendi sentence it belongs to, so the speech's Ft/In scopes to that
        # introduction (40a–40c | 40d) instead of to everything since v37.
        "exact": {"ser-37bc", "ser-38bc", "wed-40", "ser-40ab", "tmp-37",
                  "ftin-40"},
        # The narrative frames: the tool coordinates where the drawing reads
        # Situation–Response and Progression.
        "contradicts": {"sr-37", "prog-38"},
    },
}


def _assert_minimal_scorecard(tree, row_spans, start, end, ref):
    student = _student_brackets(tree, row_spans, [])
    by_exact = {(b["rel"], b["star"], b["kids"]): b["name"] for b in student}
    by_grouping = {b["kids"]: b["name"] for b in student}

    segments = segment(start, end)
    kept = _tool_brackets(build_document(segments, confident_only=True))
    full = {(b["rel"], b["star"], b["kids"])
            for b in _tool_brackets(build_document(segments))}

    exact, contradicts = set(), set()
    for b in kept:
        key = (b["rel"], b["star"], b["kids"])
        # Tiering invariant: minimal is a SUBSET of Full, never its own tree.
        assert key in full, f"minimal drew a bracket Full does not: {b}"
        if key in by_exact:
            exact.add(by_exact[key])
        elif b["kids"] in by_grouping:
            contradicts.add(by_grouping[b["kids"]])

    expected = MINIMAL_SCORECARD[ref]
    assert len(kept) == expected["kept"], (
        f"minimal kept {len(kept)} brackets, expected {expected['kept']}"
    )
    assert exact == expected["exact"], (
        f"minimal's exact set changed: gained {sorted(exact - expected['exact'])}, "
        f"lost {sorted(expected['exact'] - exact)}"
    )
    assert contradicts == expected["contradicts"], (
        f"minimal now contradicts {sorted(contradicts)}, "
        f"expected {sorted(expected['contradicts'])}"
    )


@pytest.mark.parametrize(
    "filename,ref", [(c[0], c[1]) for c in CASES], ids=[c[0][:21] for c in CASES]
)
def test_minimal_tier_scorecard(filename, ref):
    rows = student_rows(filename)
    alignment = align(" ".join(rows))
    assert alignment is not None and alignment.ref == ref
    bounds = sorted(boundary_positions(rows, alignment.start, alignment.end))
    row_spans = list(zip(
        [alignment.start] + bounds,
        [b - 1 for b in bounds] + [alignment.end],
    ))
    _assert_minimal_scorecard(STUDENT_TREES[ref], row_spans, alignment.start,
                              alignment.end, ref)


@pytest.mark.parametrize(
    "ref,row_spans,tree,expected", IMAGE_CASES, ids=[c[0] for c in IMAGE_CASES]
)
def test_minimal_tier_scorecard_image(ref, row_spans, tree, expected):
    _assert_minimal_scorecard(tree, row_spans, row_spans[0][0],
                              row_spans[-1][1], ref)


@pytest.mark.parametrize(
    "ref,row_spans,tree,expected", IMAGE_CASES, ids=[c[0] for c in IMAGE_CASES]
)
def test_relationing_scorecard_image(ref, row_spans, tree, expected):
    # The hand-transcribed rows must tile their passage contiguously.
    for (_, a_end), (b_start, _) in zip(row_spans, row_spans[1:]):
        assert a_end + 1 == b_start
    _assert_scorecard(tree, row_spans, row_spans[0][0], row_spans[-1][1],
                      expected)
