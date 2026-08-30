"""Sectioning — the big–small–big pass (docs/sectioning.md).

The DA expert's ruling: chunk the passage into its major logical sections
before relationship generation, connect sentence-to-sentence WITHIN each
section, then connect the sections to each other. These tests pin it at three
levels:

  * the SEAM SCORER on its own — marks in, seams out, no corpus — so the
    indicator weights and the speech-verb ruling are fixed independently of
    any passage;
  * the DETECTION against real passages, every expectation first verified
    against ``da.corpus.structure.marks_for`` in the test itself (the marks
    are asserted beside the seam they cause, so a regeneration of
    bsb-structure.tsv that moves a mark fails here loudly rather than
    silently changing a tree);
  * the CONSEQUENCES — the promotion pass, the section fold reusing
    ``_sentence_join``, the invariant that a within-section join never spans a
    seam, and the sections emitted as the document's colour blocks.
"""

import pytest

from da.corpus import load_words
from da.corpus.reference import resolve
from da.corpus.structure import marks_for
from da.documents import validate_document
from da.segmentation import segment
from da.treebuild import (
    SEAM_THRESHOLD,
    SEAM_WEIGHTS,
    _Packet,
    _SentenceMarks,
    _assemble_sentence,
    _dicendi_sentence,
    _indicators,
    _seam_score,
    _seams,
    _section_bounds,
    _sections,
    _sentence_marks,
    _sentences,
    build_document,
)


# ---------------------------------------------------------------------------
# Helpers

def M(**overrides) -> _SentenceMarks:
    """One sentence's marks, everything false but what is named."""
    base = dict(heading=False, paragraph=False, quote_begin=False,
                quote_end=False, oun=False, dicendi=False,
                english_period=False)
    return _SentenceMarks(**(base | overrides))


class Sectioned:
    """A live passage, sentence by sentence, with its marks and sections."""

    def __init__(self, ref: str):
        self.words = load_words()
        located = resolve(ref)
        self.ref = located.ref
        self.segments = segment(located.start, located.end)
        self.packets = []
        for group in _sentences(self.segments):
            segs = [s for _, s in group]
            self.packets.append(
                _Packet(_assemble_sentence(group, segs, self.words), segs, segs))
        self.marks = [_sentence_marks(p.opening, self.words) for p in self.packets]
        self.seams = _seams(self.marks)
        self.sections = _sections(self.packets, self.words)

    def first_word(self, sentence: int) -> int:
        return self.packets[sentence].opening[0].start

    def last_word(self, sentence: int) -> int:
        return self.packets[sentence].closing[-1].end

    def text(self, sentence: int) -> str:
        return " ".join(w.text for w in self.words[self.first_word(sentence):
                                                   self.last_word(sentence) + 1])

    def section_words(self) -> list[tuple[int, int]]:
        return [(self.first_word(lo), self.last_word(hi))
                for lo, hi in self.sections]


def brackets(node):
    if node["kind"] == "bracket":
        yield node
        for child in node["children"]:
            yield from brackets(child)


def span_of(doc, node):
    sources = {p["id"]: p["source"] for p in doc["propositions"]}

    def walk(n):
        if n["kind"] == "prop":
            s = sources[n["ref"]]
            return (s["start"], s["end"])
        return (walk(n["children"][0])[0], walk(n["children"][-1])[1])

    return walk(node)


# ---------------------------------------------------------------------------
# The seam scorer, on its own: marks in, seams out

def test_indicator_weights_are_the_expert_grading():
    """Headings and quotation bounds are HARD, paragraph breaks and οὖν
    STRONG — each of those seams on its own — and the English period is the
    one SOFT vote, which by the ruling is not yet a seam by itself. Adding a
    further indicator (Open #8) is one line in SEAM_WEIGHTS plus its
    detection, so this test names weights rather than freezing the table."""
    assert SEAM_THRESHOLD == 1
    assert SEAM_WEIGHTS["heading"] == 2
    assert SEAM_WEIGHTS["quote_begin"] == 2
    assert SEAM_WEIGHTS["quote_end"] == 2
    assert SEAM_WEIGHTS["paragraph"] == 1
    assert SEAM_WEIGHTS["oun"] == 1
    assert SEAM_WEIGHTS["english_period"] == 0


@pytest.mark.parametrize("indicator", ["heading", "paragraph", "oun"])
def test_an_opening_indicator_seams_on_its_own(indicator):
    """Hard and strong indicators read off the NEW sentence both reach the
    threshold alone."""
    marks = [M(), M(**{indicator: True}), M()]
    assert _indicators(marks, 1) == (indicator,)
    assert _seam_score(_indicators(marks, 1)) >= SEAM_THRESHOLD
    assert _seams(marks) == [1]


def test_a_quotation_seams_at_both_ends():
    """A speech BEGIN is read off the new sentence, a speech END off the one
    it follows: "a quotation closes after this word" (structure.py) means the
    seam falls at the sentence AFTER the closing sentence."""
    begin = [M(), M(quote_begin=True), M()]
    assert _seams(begin) == [1]
    end = [M(), M(quote_end=True), M()]
    assert _indicators(end, 2) == ("quote_end",)
    assert _seams(end) == [2]


def test_the_english_period_is_a_vote_not_a_seam():
    """The soft signal: it is detected and scored, but at weight 0 it never
    tips a boundary on its own — the ruling for this first implementation."""
    marks = [M(english_period=True), M(), M()]
    assert _indicators(marks, 1) == ("english_period",)
    assert _seam_score(_indicators(marks, 1)) < SEAM_THRESHOLD
    assert _seams(marks) == []
    # …and it does not weaken anything either: with a real indicator beside
    # it the boundary is a seam exactly as it would have been.
    assert _seams([M(english_period=True), M(paragraph=True)]) == [1]


def test_a_passage_with_no_indicator_is_one_section():
    marks = [M(), M(), M(), M()]
    assert _seams(marks) == []
    assert _section_bounds(len(marks), _seams(marks)) == [(0, 3)]


def test_the_speech_verb_rides_with_its_speech():
    """THE RULING. A quotation is a hard seam, but the clause introducing it
    belongs to the speech: the seam moves BACK over the dicendi sentence, and
    the boundary between the introduction and the speech stops being a seam —
    leaving both would strand the introduction as a section of its own."""
    marks = [M(), M(dicendi=True), M(quote_begin=True), M()]
    assert _seams(marks) == [1]
    # It moves even when the speech sentence carries its own paragraph break
    # (the BSB starts long quotations on a new line): there must be no seam
    # between "he said," and what he said.
    with_paragraph = [M(), M(dicendi=True), M(quote_begin=True, paragraph=True)]
    assert _seams(with_paragraph) == [1]
    # A speech whose introduction is not a dicendi sentence keeps its seam.
    assert _seams([M(), M(), M(quote_begin=True), M()]) == [2]


def test_a_speech_opening_the_passage_seams_nowhere():
    """When the dicendi sentence is the passage's first, the seam it would
    move onto is the passage start — which is no seam at all."""
    assert _seams([M(dicendi=True), M(quote_begin=True), M()]) == []


def test_section_bounds_tile_the_sentences():
    assert _section_bounds(6, [2, 5]) == [(0, 1), (2, 4), (5, 5)]
    assert _section_bounds(3, []) == [(0, 2)]


# ---------------------------------------------------------------------------
# Detection on real passages
#
# 1 John 1:1–2:2 — the BSB's own pericope headings and the ἐάν-run paragraphs.

def test_1john_headings_and_paragraphs_section_the_letter_opening():
    """Two BSB headings ("The Word of Life" at 1:1, "Walking in the Light" at
    1:5) and the paragraph the ἐάν run restarts at 1:8. The 1:1 heading opens
    the passage, so it seams nothing; the other two are the section starts."""
    p = Sectioned("1 John 1:1-2:2")
    assert len(p.packets) == 11

    # The marks themselves, read straight from the BSB structure data.
    assert marks_for(p.first_word(0)).heading == "The Word of Life"
    assert marks_for(p.first_word(3)).heading == "Walking in the Light"
    assert marks_for(p.first_word(3)).paragraph
    assert marks_for(p.first_word(6)).paragraph      # ἐὰν εἴπωμεν, 1:8
    assert marks_for(p.first_word(6)).heading is None
    assert not any(m.quote_begin or m.quote_end for m in p.marks)

    assert _indicators(p.marks, 3)[:2] == ("heading", "paragraph")
    assert _indicators(p.marks, 6)[0] == "paragraph"
    assert p.seams == [3, 6]
    assert p.sections == [(0, 2), (3, 5), (6, 10)]
    # 1:5 opens the second section and 1:8 the third.
    assert p.words[p.first_word(3)].verse == 5
    assert p.words[p.first_word(6)].verse == 8


def test_1john_sections_are_runs_of_whole_sentences():
    """Sections never cut into a sentence: each one starts where a sentence
    starts, ends where a sentence ends, and together they tile the passage."""
    p = Sectioned("1 John 1:1-2:2")
    starts = {p.first_word(i) for i in range(len(p.packets))}
    words = p.section_words()
    assert words[0][0] == p.segments[0].start
    assert words[-1][1] == p.segments[-1].end
    for (_, end), (start, _) in zip(words, words[1:]):
        assert start == end + 1
    for start, end in words:
        assert p.words[end].ends_sentence
        assert start in starts


# Matthew 3:1–12 — a Gospel speech: quote seams, and the dicendi sentence
# riding with the speech it introduces.

def test_matthew3_speech_verb_rides_with_the_speech():
    """Three speech openings in one passage, all three with the seam BEFORE
    the introduction rather than between it and the speech:

      3:1–2  … κηρύσσων … λέγων· | Μετανοεῖτε        (the passage's own start)
      3:7    Ἰδὼν δὲ … εἶπεν αὐτοῖς· | Γεννήματα ἐχιδνῶν
      3:8–9  … μὴ δόξητε λέγειν ἐν ἑαυτοῖς· | Πατέρα ἔχομεν
    """
    p = Sectioned("Matthew 3:1-12")
    assert len(p.packets) == 17

    # The quotations, as the BSB marks them.
    assert marks_for(p.first_word(1)).quote_opens       # Μετανοεῖτε (3:2)
    assert marks_for(p.first_word(8)).quote_opens       # Γεννήματα (3:7)
    assert any(marks_for(i).quote_opens
               for i in range(p.first_word(10), p.last_word(10) + 1))

    # Each speech is preceded by a dicendi sentence, so each seam rides back.
    for speech, introduction in ((1, 0), (8, 7), (10, 9)):
        assert p.marks[speech].quote_begin
        assert p.marks[introduction].dicendi
        assert _dicendi_sentence(p.packets[introduction].closing, p.words)
        assert _seam_score(_indicators(p.marks, speech)) >= SEAM_THRESHOLD
        assert speech not in p.seams          # never between verb and speech
    # The Baptist's first speech rides onto the passage's own first sentence,
    # so it seams nothing at all; the other two land on their introductions.
    assert 7 in p.seams and 9 in p.seams
    assert p.sections[0] == (0, 1)            # 3:1 + its speech, one section
    assert (7, 8) in p.sections               # 3:7's rebuke with its εἶπεν


def test_matthew3_quotation_end_returns_to_the_narrative():
    """The Isaiah quotation closes inside 3:3; the sentence after it (3:4,
    αὐτὸς δὲ ὁ Ἰωάννης …) opens a section on the strength of that close."""
    p = Sectioned("Matthew 3:1-12")
    assert p.marks[4].quote_end
    assert any(marks_for(i).quote_closes
               for i in range(p.first_word(4), p.last_word(4) + 1))
    assert _indicators(p.marks, 5)[0] == "quote_end"
    assert 5 in p.seams
    assert p.words[p.first_word(5)].verse == 4


def test_matthew3_oun_is_a_transition_between_chunks_of_logic():
    """Matt 3:8 ποιήσατε οὖν and 3:10 πᾶν οὖν δένδρον: sentence-initial οὖν
    (postpositive, so it stands second) seams on its own — "basically always a
    transition between chunks of logic"."""
    p = Sectioned("Matthew 3:1-12")
    for sentence, verse in ((9, 8), (12, 10)):
        assert p.marks[sentence].oun
        assert p.words[p.first_word(sentence)].verse == verse
        assert "oun" in _indicators(p.marks, sentence)
        assert sentence in p.seams
    # Neither carries any other indicator: οὖν alone did it.
    assert _indicators(p.marks, 12) == ("oun",)


def test_romans12_oun_opens_the_exhortation():
    """Παρακαλῶ οὖν (Rom 12:1) with the doxology of 11:33–36 in front of it:
    the οὖν seam closes the doxology and the section fold joins the two with
    the Inference οὖν names."""
    p = Sectioned("Romans 11:33-12:2")
    assert p.marks[7].oun
    assert p.words[p.first_word(7)].chapter == 12
    assert 7 in p.seams
    assert p.sections[-1] == (7, 8)

    doc = build_document(p.segments)
    root = doc["forest"][0]
    assert root["rel"] == "Inf" and root["prominent"] == 1
    assert span_of(doc, root["children"][1]) == (p.first_word(7), p.last_word(8))


# ---------------------------------------------------------------------------
# The promotion pass — the one structure-dependent indicator

def test_gar_block_that_develops_is_promoted_to_its_own_section():
    """Hebrews 4:11–13 has no surface indicator at all inside it (the οὖν of
    4:11 opens the passage), so the promotion pass alone sections it: the γάρ
    of 4:12 opens a because-block that runs on into 4:13 — a Series joining
    the two sentences, a Ft/In and a Ground inside the second — and a
    developed support like that is section-sized.

    The consequence is the tree: the Ground now supports the whole block
    (4:12–13) instead of 4:12 alone, which is what a flat sentence fold gave
    (Ser[Grnd[4:11, 4:12], 4:13])."""
    p = Sectioned("Hebrews 4:11-13")
    assert len(p.packets) == 3
    assert p.seams == []                      # nothing on the surface
    assert p.sections == [(0, 0), (1, 2)]     # …the promotion did this

    doc = build_document(p.segments)
    root = doc["forest"][0]
    assert root["rel"] == "Grnd" and root["prominent"] == 0
    assert span_of(doc, root["children"][0]) == (p.first_word(0), p.last_word(0))
    support = root["children"][1]
    assert span_of(doc, support) == (p.first_word(1), p.last_word(2))
    # The support develops: the Series is the block's own join, and the Ft/In
    # and Ground are inside 4:13.
    rels = {b["rel"] for b in brackets(support)}
    assert {"Ser", "FtIn", "Grnd"} <= rels


def test_an_undeveloped_gar_stays_a_supporting_clause():
    """The promotion is not "every γάρ": 1 Thess 1:8's ground (ἀφ᾽ ὑμῶν γὰρ
    ἐξήχηται …) develops a Neg/Pos and a Cause–Effect but no coordinate and no
    Ft/In, so it is not section-sized and the sentence fold keeps it — the two
    γάρ Grounds of the passage stay nested exactly as the student drew them.
    (The 1:9 ground IS promoted, and produces the same bracket the flat fold
    did, so the diagram's scorecard is untouched — see
    test_relationing_golden.)"""
    p = Sectioned("1 Thessalonians 1:6-10")
    assert p.seams == []
    assert p.sections == [(0, 1), (2, 2)]
    doc = build_document(p.segments)
    root = doc["forest"][0]
    assert root["rel"] == "Grnd"
    inner = root["children"][0]
    assert inner["rel"] == "Grnd"
    assert span_of(doc, inner) == (p.first_word(0), p.last_word(1))


# ---------------------------------------------------------------------------
# The section fold, and what it does to the minimal tier

def test_the_section_fold_reuses_the_sentence_join_table():
    """The big fold asks the same question of a section's FIRST sentence that
    the small fold asks of every sentence, through the same
    ``_sentence_join``: γάρ → Ground, οὖν → Inference, δέ/καί/asyndeton →
    Series. 1 John's three sections are asyndeton and δέ, so they chain as
    Series; Hebrews' two are joined by the οὖν that made the seam."""
    john = build_document(Sectioned("1 John 1:1-2:2").segments)
    assert john["forest"][0]["rel"] == "Ser"
    hebrews = build_document(Sectioned("Hebrews 4:9-12").segments)
    assert hebrews["forest"][0]["rel"] == "Inf"


@pytest.mark.parametrize("ref", ["1 John 1:1-2:2", "Matthew 3:1-12",
                                 "Acts 2:37-41", "Romans 11:33-12:2"])
def test_a_within_section_join_never_spans_a_seam(ref):
    """The minimal-tier consequence of sectioning, stated as an invariant:
    every bracket the SMALL fold makes lies inside one section, so the only
    brackets crossing a seam are the section fold's own — and those pair whole
    sections, never a piece of one with a piece of another."""
    p = Sectioned(ref)
    sections = p.section_words()
    assert len(sections) > 1, "pick a passage that actually sections"
    starts = {lo for lo, _ in sections}
    ends = {hi for _, hi in sections}

    crossing = 0
    for confident_only in (False, True):
        doc = build_document(p.segments, confident_only=confident_only)
        for root in doc["forest"]:
            for bracket in brackets(root):
                for child in bracket["children"]:
                    start, end = span_of(doc, child)
                    inside = any(lo <= start and end <= hi for lo, hi in sections)
                    if inside:
                        continue
                    # Crosses a seam: then it must be a whole run of sections.
                    crossing += 1
                    assert start in starts and end in ends, (
                        f"{bracket['rel']} bracket joins across the seam at "
                        f"{start}–{end} without covering whole sections"
                    )
    # Not a vacuous check: the section fold really does bracket across seams —
    # sectioning gates the SHAPE of those joins, it does not forbid them.
    assert crossing > 0


# ---------------------------------------------------------------------------
# The sections as the document's colour blocks

def test_sections_are_emitted_as_colour_blocks():
    """Every section after the first is stored as the proposition it opens,
    with a colour of its own — the editor's own model (documents.py: the
    document already opens inside its first block, so that one is never
    stored). This is what makes the analyzer's reading of the passage visible
    the moment it is opened."""
    p = Sectioned("1 John 1:1-2:2")
    doc = build_document(p.segments)
    validate_document(doc, corpus_size=len(p.words))

    starts = {pr["id"]: pr["source"]["start"] for pr in doc["propositions"]}
    assert doc["sections"] == [{"start": "p20", "color": 1},
                               {"start": "p34", "color": 2}]
    assert [starts[b["start"]] for b in doc["sections"]] == [
        p.first_word(3), p.first_word(6)]
    # …which are the two BSB divisions: the 1:5 heading and the 1:8 paragraph.
    assert doc["propositions"][19]["label"] == "5a"
    assert doc["propositions"][33]["label"] == "8a"


def test_colour_blocks_match_the_sections_in_both_modes():
    """The blocks are a reading of the passage, not of its structure, so
    minimal and Full carry the same ones."""
    p = Sectioned("Matthew 3:1-12")
    full = build_document(p.segments)
    minimal = build_document(p.segments, confident_only=True)
    assert full["sections"] == minimal["sections"]
    assert len(full["sections"]) == len(p.sections) - 1
    assert [b["color"] for b in full["sections"]] == list(range(1, len(p.sections)))
    starts = {pr["id"]: pr["source"]["start"] for pr in full["propositions"]}
    assert [starts[b["start"]] for b in full["sections"]] == [
        p.first_word(lo) for lo, _ in p.sections[1:]]


def test_one_section_means_no_colour_blocks():
    """1 John 1:5–7: no heading, no paragraph, no quotation, no οὖν, and its
    two sentence joins are Series — nothing to section on, so the passage is
    one block and the document carries no ``sections`` key at all (the shape
    the editor writes when the analyst has drawn no breaks)."""
    p = Sectioned("1 John 1:5-7")
    assert p.seams == []
    assert p.sections == [(0, 2)]
    doc = build_document(p.segments)
    assert "sections" not in doc
    validate_document(doc, corpus_size=len(p.words))
