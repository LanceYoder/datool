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
    # 6 → 8 with SECTIONING: the γάρ promotion at 4:15 (τοῦτο γὰρ ὑμῖν
    # λέγομεν, whose because-block runs 4:15–17 and develops — a Ft/In and a
    # Series inside it) cuts that block out as its own section, so the block's
    # two Series joins become brackets of their own instead of links in one
    # flat left-nested chain running from 4:13.
    "1-thessalonians-4-13-18": (8, 3),
    # 4 → 5 with the English-cue layer: the BSB's "When the people heard this"
    # over Ἀκούσαντες (v37) turns the attendant-circumstance Series of chart
    # rule 7 into the Temporal the diagram draws.
    # 11 → 12 (and 5 → 6 exact) with SECTIONING: the quote seam at the speech
    # of 2:40 rides back over its dicendi sentence (… παρεκάλει αὐτοὺς
    # λέγων·), so the Ft/In over the speech content now scopes to that
    # introduction alone — which is the diagram's own ftin-40 bracket.
    "acts-2-37-41": (12, 6),
    "ephesians-3-8-13": (8, 1),
    # 4 → 5 with SECTIONING: the BSB paragraph seam at 4:11 (καὶ ἔλεγεν
    # αὐτοῖς·, which the speech's quote seam also rides back onto) closes v10
    # as its own section, so v11's dicendi sentence and its speech pair off
    # instead of extending the flat sentence chain.
    "mark-4-10-12": (5, 0),
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
