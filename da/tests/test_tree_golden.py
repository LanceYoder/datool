"""Golden tests for the worked bracket diagrams in examples/*.json.

Each file holds one hand-drawn analysis from the course transcribed into a
schema-v2 document, plus the reference and the main point the diagram itself
marks (the underlined/highlighted proposition — arrived at independently of
the tree, which makes it a real check on the transcription):

    {"reference": ..., "language": "greek"|"english", "source": ...,
     "mainPoint": ["p15"], "document": {...v2 document...}}

Where the xlsx goldens (test_examples_golden) pin SEGMENTATION, these pin
STRUCTURE: the document must validate, the star walk must land where the
student's star walk landed, and every bracket's derived ``reversed`` flag must
put each label on the end the student wrote it on.
"""

import json
from pathlib import Path

import pytest

from da.corpus import align, load_words
from da.documents import main_point, validate_document
from da.segmentation import segment
from da.taxonomy import RELATIONSHIPS
from da.treebuild import _propositions, build_document

EXAMPLES = Path(__file__).resolve().parent.parent.parent / "examples"
DIAGRAMS = sorted(EXAMPLES.glob("*.json"))


class Seg:
    """A segment stand-in for _propositions (which only reads start/end)."""

    def __init__(self, start: int, end: int):
        self.start, self.end = start, end


def brackets(node):
    if node["kind"] == "bracket":
        yield node
        for child in node["children"]:
            yield from brackets(child)


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_examples_folder_has_diagrams():
    assert DIAGRAMS, "examples/ should hold the transcribed diagrams"


@pytest.mark.parametrize("path", DIAGRAMS, ids=lambda p: p.stem)
def test_diagram_is_a_valid_document(path):
    golden = load(path)
    validate_document(golden["document"], corpus_size=len(load_words()))


@pytest.mark.parametrize("path", DIAGRAMS, ids=lambda p: p.stem)
def test_diagram_main_point(path):
    """The star walk lands on the proposition(s) the diagram marks."""
    golden = load(path)
    assert main_point(golden["document"]) == golden["mainPoint"]


@pytest.mark.parametrize("path", DIAGRAMS, ids=lambda p: p.stem)
def test_diagram_labels_follow_the_stars(path):
    """``reversed`` is derived, never chosen: on a binary subordinate bracket
    it is (prominent != starredLabel), which is what keeps the starred label
    on the starred end — the arrangement the student drew."""
    golden = load(path)
    for bracket in brackets(golden["document"]["forest"][0]):
        rel = RELATIONSHIPS[bracket["rel"]]
        binary_subordinate = not rel.coordinate and len(bracket["children"]) == 2
        expected = binary_subordinate and bracket["prominent"] != rel.starred_label
        assert bracket.get("reversed", False) is expected, (
            f"{bracket['rel']} bracket: reversed must be {expected}"
        )


@pytest.mark.parametrize("path", DIAGRAMS, ids=lambda p: p.stem)
def test_diagram_propositions(path):
    """Corpus diagrams tile their passage exactly and carry the labels the
    editor would re-derive; English ones are raw text, numbered in order."""
    golden = load(path)
    props = golden["document"]["propositions"]
    sources = [p["source"] for p in props]

    if golden["language"] == "english":
        assert all(s["kind"] == "raw" and s["text"].strip() for s in sources)
        assert [p["label"] for p in props] == [str(i + 1) for i in range(len(props))]
        return

    assert all(s["kind"] == "corpus" for s in sources)
    for previous, following in zip(sources, sources[1:]):
        assert following["start"] == previous["end"] + 1, "propositions must tile"

    words = load_words()
    start, end = sources[0]["start"], sources[-1]["end"]
    alignment = align(" ".join(w.text for w in words[start:end + 1]))
    assert alignment is not None
    assert alignment.ref == golden["reference"]
    assert (alignment.start, alignment.end) == (start, end)

    segments = [Seg(s["start"], s["end"]) for s in sources]
    assert [p["label"] for p in _propositions(segments, words)] == [
        p["label"] for p in props
    ]


def _bracket_set(doc) -> set:
    """Every bracket as (rel, starred child index, child word-spans)."""
    sources = {p["id"]: p["source"] for p in doc["propositions"]}

    def span(node):
        if node["kind"] == "prop":
            s = sources[node["ref"]]
            return (s["start"], s["end"])
        return (span(node["children"][0])[0], span(node["children"][-1])[1])

    out = set()

    def walk(node):
        if node["kind"] != "bracket":
            return
        out.add((node["rel"], node.get("prominent"),
                 tuple(span(c) for c in node["children"])))
        for child in node["children"]:
            walk(child)

    for root in doc["forest"]:
        walk(root)
    return out


# The minimal-tier audit, pinned per diagram: (brackets minimal draws,
# brackets it reproduces from the diagram exactly). Adding a worked example to
# examples/ raises a KeyError here, which is the point — a new diagram forces
# a deliberate look at what the tiering does to it.
#
# The old contract was stricter: minimal could keep a bracket ONLY if the
# diagram drew it exactly. The DA expert's re-tier retires that — minimal now
# carries sensible defaults as well as grammar-forced calls, and a default is
# by definition a reading a given diagram may not share. What survives as a
# hard invariant is that minimal is a SUBSET of Full (same brackets, fewer of
# them); the agreement numbers below are the pinned scorecard.
MINIMAL_VS_DIAGRAM = {
    # 8 → 7 with RULING Q8/Q10: the 4:15 γάρ block no longer promotes — the
    # surface indicators now seam at 4:16 anyway, which leaves the γάρ
    # sentence alone in its section, and RULING Q10 requires a because-block
    # to CROSS a sentence boundary before it counts as section-sized. Three
    # sections (4:13–15 | 4:16–17 | the ὥστε of 4:18), and the three brackets
    # the diagram draws are unchanged.
    "1-thessalonians-4-13-18": (7, 3),
    # 4 → 5 with the English-cue layer: the BSB's "When the people heard this"
    # over Ἀκούσαντες (v37) turns the attendant-circumstance Series of chart
    # rule 7 into the Temporal the diagram draws.
    # 11 → 12 (and 5 → 6 exact) with SECTIONING: the quote seam at the speech
    # of 2:40 rides back over its dicendi sentence (… παρεκάλει αὐτοὺς
    # λέγων·), so the Ft/In over the speech content now scopes to that
    # introduction alone — which is the diagram's own ftin-40 bracket.
    # 12 → 16 with RULING Q11(b) and RULING Q8/Q12. Q11(b): "Πέτρος δὲ πρὸς
    # αὐτούς·" ("And Peter [said] to them") is an ELIDED speech verb in front
    # of a quotation, so it counts as a speech introduction — the 2:38 seam
    # rides back over it and its speech joins as Ft/In, exactly as a "εἶπεν
    # αὐτοῖς·" would. Q8/Q12 adds a seam before the γάρ of 2:39 (a cohesion
    # drop plus the English period). Five sections instead of four, and the
    # section fold has brackets to draw where a flat Series chain used to run.
    "acts-2-37-41": (16, 6),
    "ephesians-3-8-13": (8, 1),
    # 5 → 8, and 0 → 1 exact, with RULING Q2 and RULING Q1. Q2 is what earns
    # the exact match: 4:10's apposition (οἱ περὶ αὐτὸν σὺν τοῖς δώδεκα) is a
    # sure Ft/In now, so the whole 4:10 sentence is sure and its Temporal
    # bracket (ὅτε ἐγένετο κατὰ μόνας | ἠρώτων αὐτόν …) reaches minimal —
    # which is the bracket the diagram draws there. Q1 adds the Alternative
    # over 4:11b (ἐκείνοις δὲ τοῖς ἔξω, "But to those on the outside"), which
    # the diagram also draws but over different rows.
    "mark-4-10-12": (8, 1),
}


@pytest.mark.parametrize("path", DIAGRAMS, ids=lambda p: p.stem)
def test_minimal_tier_against_the_diagram(path):
    """The standing audit for every NEW diagram: minimal mode must stay a
    subset of the full analysis, and its agreement with this diagram is
    pinned so any classifier change has to be argued for."""
    golden = load(path)
    if golden["language"] != "greek":
        pytest.skip("an English diagram gives the analyzer no morphology")
    props = golden["document"]["propositions"]
    start = props[0]["source"]["start"]
    end = props[-1]["source"]["end"]
    student = _bracket_set(golden["document"])
    segments = segment(start, end)
    full = _bracket_set(build_document(segments))
    kept = _bracket_set(build_document(segments, confident_only=True))

    stray = kept - full
    assert not stray, (
        f"minimal drew brackets the full analysis does not: {sorted(stray)}"
    )
    assert (len(kept), len(kept & student)) == MINIMAL_VS_DIAGRAM[path.stem], (
        f"minimal kept {len(kept)} brackets, {len(kept & student)} of them "
        f"drawn by the diagram; expected {MINIMAL_VS_DIAGRAM[path.stem]}"
    )
