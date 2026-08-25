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


@pytest.mark.parametrize("path", DIAGRAMS, ids=lambda p: p.stem)
def test_confident_mode_never_contradicts_the_diagram(path):
    """The standing audit for every NEW diagram: confident-only mode may keep
    a bracket only if this diagram drew it EXACTLY (relationship, star, and
    grouping). Adding a worked example to examples/ automatically tightens
    the sure-call table in da/treebuild.py against it."""
    golden = load(path)
    if golden["language"] != "greek":
        pytest.skip("an English diagram gives the analyzer no morphology")
    props = golden["document"]["propositions"]
    start = props[0]["source"]["start"]
    end = props[-1]["source"]["end"]
    student = _bracket_set(golden["document"])
    kept = _bracket_set(build_document(segment(start, end), confident_only=True))
    stray = kept - student
    assert not stray, (
        f"confident mode kept brackets the diagram does not draw: {sorted(stray)}"
    )
