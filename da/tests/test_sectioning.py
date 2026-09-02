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

The 2026-08-29 rulings widened the indicator table (Q8 b–h: vocatives,
διό/διὰ τοῦτο, narrative scene-setters, mood/person shifts, epistolary
asyndeton, rhetorical-question openers, lexical-cohesion drops), made the
English period a SOFT vote that combines with the other softs (Q12), required
a promoted because-block to cross a sentence boundary and let causal-ὅτι
blocks promote too (Q10), and widened the speech machinery (Q11: the
βοάω/κράζω class, and the elided speech verb in front of a quotation). Each
has its own test below, and every recomputed expectation names the ruling.
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
    _causal_hoti_sentence,
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
    """One sentence's marks, everything false but what is named. The four
    non-boolean fields (RULING Q8's mood/person shift and cohesion drop are
    read across a PAIR of sentences) default to "nothing known", so a
    synthetic pair fires neither."""
    base = dict(heading=False, paragraph=False, quote_begin=False,
                quote_end=False, oun=False, dicendi=False,
                english_period=False, epistle=False, vocative=False,
                dio=False, scene_setter=False, asyndeton=False,
                question=False, first_mood=None, first_person=None,
                imperative=False, all_third=False, content=frozenset())
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
        self.marks = [
            _sentence_marks(p.opening, self.words,
                            self.packets[i + 1].opening
                            if i + 1 < len(self.packets) else None)
            for i, p in enumerate(self.packets)]
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


def the_one(iterable):
    found = list(iterable)
    assert len(found) == 1, f"expected exactly one, found {len(found)}"
    return found[0]


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
    """Headings and quotation bounds are HARD (2), and each of the STRONG (1)
    indicators seams on its own; the SOFT ones are 0.5 and never do.

    RULING Q8 added b–h and RULING Q12 re-weighted the English period. The
    grading: a vocative is strong in the EPISTLES and soft elsewhere (two
    entries, since it is the same detection graded twice), διό/διὰ τοῦτο,
    narrative scene-setters and rhetorical-question openers are strong, and
    the mood/person shift, epistolary asyndeton, cohesion drop and English
    period are soft. This test names weights rather than freezing the table,
    so adding an indicator stays a one-line affair."""
    assert SEAM_THRESHOLD == 1
    assert SEAM_WEIGHTS["heading"] == 2
    assert SEAM_WEIGHTS["quote_begin"] == 2
    assert SEAM_WEIGHTS["quote_end"] == 2
    assert SEAM_WEIGHTS["paragraph"] == 1
    assert SEAM_WEIGHTS["oun"] == 1
    assert SEAM_WEIGHTS["dio"] == 1
    assert SEAM_WEIGHTS["scene_setter"] == 1
    assert SEAM_WEIGHTS["question"] == 1
    assert SEAM_WEIGHTS["vocative"] == 1
    assert SEAM_WEIGHTS["vocative_soft"] == 0.5
    assert SEAM_WEIGHTS["mood_shift"] == 0.5
    assert SEAM_WEIGHTS["asyndeton"] == 0.5
    assert SEAM_WEIGHTS["cohesion"] == 0.5
    assert SEAM_WEIGHTS["english_period"] == 0.5


@pytest.mark.parametrize("indicator", ["dio", "scene_setter", "question"])
def test_the_new_strong_indicators_seam_on_their_own(indicator):
    """RULING Q8: διό/διὰ τοῦτο, a narrative scene-setter and a
    rhetorical-question opener are each a seam by themselves, exactly like a
    paragraph break or an οὖν. (The vocative is the genre-graded one — see
    the test below.)"""
    marks = [M(), M(**{indicator: True}), M()]
    assert _indicators(marks, 1) == (indicator,)
    assert _seams(marks) == [1]


def test_a_vocative_is_strong_in_a_letter_and_soft_in_a_story():
    """The one indicator RULING Q8 grades by genre. "Ἀδελφοί μου, …" opening a
    sentence in a letter is how the writer turns to a new topic — a seam. The
    same vocative in a Gospel is usually a character being addressed inside a
    scene, so it is only a vote."""
    letter = [M(), M(epistle=True, vocative=True), M()]
    assert _indicators(letter, 1) == ("vocative",)
    assert _seams(letter) == [1]
    story = [M(), M(vocative=True), M()]
    assert _indicators(story, 1) == ("vocative_soft",)
    assert _seam_score(_indicators(story, 1)) < SEAM_THRESHOLD
    assert _seams(story) == []


def test_two_soft_indicators_reach_the_threshold_together():
    """RULING Q12, and the answer to how the softs combine: a soft signal is
    never a seam alone, but two of them are — 0.5 + 0.5 = 1. Here the English
    period at the end of the first sentence and the lexical-cohesion drop
    between the two (RULING Q8(h): not one content lemma in common)."""
    marks = [M(english_period=True, content=frozenset({"λόγος"})),
             M(content=frozenset({"μάχαιρα"}))]
    assert _indicators(marks, 1) == ("cohesion", "english_period")
    assert _seam_score(_indicators(marks, 1)) == 1
    assert _seams(marks) == [1]
    # One shared content lemma and the cohesion vote is gone, so the English
    # period stands alone and there is no seam.
    joined = [M(english_period=True, content=frozenset({"λόγος"})),
              M(content=frozenset({"λόγος", "μάχαιρα"}))]
    assert _indicators(joined, 1) == ("english_period",)
    assert _seams(joined) == []


def test_the_mood_and_person_shift():
    """RULING Q8(e), both halves. An imperative opening a sentence whose
    predecessor had none is a shift; so is a sustained third-person stretch
    followed by a second-person verb. Neither is a seam alone."""
    to_command = [M(content=frozenset({"a"})),
                  M(first_mood="D", content=frozenset({"a"}))]
    assert _indicators(to_command, 1) == ("mood_shift",)
    assert _seams(to_command) == []
    # …but not when the previous sentence was already commanding.
    already = [M(imperative=True, content=frozenset({"a"})),
               M(first_mood="D", content=frozenset({"a"}))]
    assert _indicators(already, 1) == ()
    to_you = [M(all_third=True, content=frozenset({"a"})),
              M(first_person="2", content=frozenset({"a"}))]
    assert _indicators(to_you, 1) == ("mood_shift",)


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
    """The soft signal: detected and scored, but never a seam on its own.
    RULING Q12 raised its weight from 0 to 0.5, which changes nothing here —
    "never a seam alone" is the ruling — and everything about what it can do
    beside another soft indicator (see the soft-pair test above)."""
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
    the passage, so it seams nothing; the other two are section starts.

    RECOMPUTED for RULING Q8/Q12: the letter also seams on its soft
    indicators now — this is an epistle, so a sentence with no connective at
    its start votes (asyndeton), and so do the English period and a
    lexical-cohesion drop. Four further boundaries reach the threshold that
    way, and 2:1's "Τεκνία μου" adds the epistolary VOCATIVE, which is strong
    on its own."""
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
    # 2:1 Τεκνία μου, ταῦτα γράφω ὑμῖν — the vocative stands in the first
    # three words of the sentence and this is a letter, so it is STRONG.
    assert p.marks[9].vocative and p.marks[9].epistle
    assert p.words[p.first_word(9)].chapter == 2
    assert "vocative" in _indicators(p.marks, 9)

    assert p.seams == [2, 3, 4, 6, 7, 8, 9]
    assert p.sections == [(0, 1), (2, 2), (3, 3), (4, 5), (6, 6), (7, 7),
                          (8, 8), (9, 10)]
    # 1:5 still opens a section, and so does 1:8.
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


def test_matthew3_narrative_scene_setters():
    """RULING Q8(d), in a narrative book. Matt 3:1 opens "Ἐν δὲ ταῖς ἡμέραις
    ἐκείναις …" and 3:5 "τότε ἐξεπορεύετο πρὸς αὐτὸν Ἱεροσόλυμα …" — two of
    the formulae that move a Gospel to a new scene, and each is a STRONG
    indicator that seams on its own (3:1 opens the passage, so only 3:5
    actually cuts)."""
    p = Sectioned("Matthew 3:1-12")
    assert p.marks[0].scene_setter                 # ἐν … ταῖς ἡμέραις ἐκείναις
    assert p.marks[6].scene_setter                 # τότε
    assert p.words[p.first_word(6)].verse == 5
    assert _indicators(p.marks, 6)[0] == "scene_setter"
    assert 6 in p.seams
    # …and nowhere else in the passage: the formulae are a closed list.
    assert [m.scene_setter for m in p.marks].count(True) == 2


def test_matthew3_a_crying_out_verb_introduces_its_speech():
    """RULING Q11(a). Matt 3:3 "Φωνὴ βοῶντος ἐν τῇ ἐρήμῳ·" — a voice CRYING
    OUT, with the Isaiah quotation after it. βοάω was not a verbum dicendi
    before the ruling, so the seam fell between the introduction and its
    speech; now the βοῶντος sentence is a speech introduction like any
    "εἶπεν αὐτοῖς·" and rides with the speech it opens."""
    p = Sectioned("Matthew 3:1-12")
    assert p.marks[3].dicendi
    assert _dicendi_sentence(p.packets[3].closing, p.words)
    assert p.marks[4].quote_begin                  # Ἑτοιμάσατε τὴν ὁδὸν κυρίου
    assert 4 not in p.seams and 3 in p.seams
    assert (3, 4) in p.sections


def test_acts2_an_elided_speech_verb_introduces_its_speech():
    """RULING Q11(b). Acts 2:38 "Πέτρος δὲ πρὸς αὐτούς·" — "And Peter [said]
    to them": the verb of saying is ELIDED, so the sentence has no finite verb
    at all and no dicendi lemma to find. It counts as a speech introduction
    because DIRECT SPEECH FOLLOWS (the next sentence, Μετανοήσατε, carries the
    BSB's quotation-open mark), which is the corroboration the ruling
    requires. The seam therefore rides back over it, and the Ft/In join over
    the speech content applies — the same test now serves both."""
    p = Sectioned("Acts 2:37-41")
    words = p.words
    intro, speech = 2, 3
    assert p.words[p.first_word(intro)].verse == 38
    assert not any(words[i].is_finite_verb
                   for i in range(p.first_word(intro), p.last_word(intro) + 1))
    assert marks_for(p.first_word(speech)).quote_opens
    assert p.marks[intro].dicendi
    # …and only because the speech follows: with no next sentence to check,
    # the elided branch cannot fire.
    assert not _dicendi_sentence(p.packets[intro].closing, words)
    assert speech not in p.seams and intro in p.seams
    assert (intro, speech) in p.sections

    doc = build_document(p.segments)
    ftin = [b for b in brackets(doc["forest"][0])
            if b["rel"] == "FtIn"
            and span_of(doc, b) == (p.first_word(intro), p.last_word(speech))]
    assert len(ftin) == 1 and ftin[0]["prominent"] == 1


# James 1 — the epistolary indicators: a vocative, asyndeton, διό.

def test_james1_epistolary_indicators():
    """RULING Q8(b), (c) and (f) in a letter.

      1:19  Ἴστε, ἀδελφοί μου ἀγαπητοί.      — vocative (STRONG in an epistle)
      1:17  Πᾶσα δόσις ἀγαθὴ …               — no connective at all (asyndeton)
      1:21  διὸ ἀποθέμενοι πᾶσαν ῥυπαρίαν …  — διό (STRONG)
    """
    p = Sectioned("James 1:16-21")
    assert all(m.epistle for m in p.marks)

    # (b) the vocative — ἀδελφοί is a vocative NOUN (MorphGNT case 'V') and it
    # stands in the sentence's first three words.
    assert p.words[p.first_word(3)].verse == 19
    assert p.marks[3].vocative
    assert any(w.case == "V" for w in p.words[p.first_word(3):
                                              p.first_word(3) + 3])
    assert "vocative" in _indicators(p.marks, 3)
    assert 3 in p.seams

    # (f) epistolary asyndeton — the connective scan finds nothing at 1:17.
    assert p.words[p.first_word(1)].verse == 17
    assert p.marks[1].asyndeton
    assert "asyndeton" in _indicators(p.marks, 1)

    # (c) διό.
    assert p.words[p.first_word(5)].verse == 21
    assert p.marks[5].dio
    assert "dio" in _indicators(p.marks, 5)
    assert 5 in p.seams


def test_romans8_rhetorical_question_openers():
    """RULING Q8(g). Rom 8:31 "Τί οὖν ἐροῦμεν πρὸς ταῦτα;", 8:33 "τίς
    ἐγκαλέσει κατὰ ἐκλεκτῶν θεοῦ;", 8:34 "τίς ὁ κατακρινῶν;" — each opens on
    an interrogative and closes on the Greek question mark, which is the pair
    of conditions the ruling names (the question mark alone would catch every
    question inside a dialogue). Each is a strong seam."""
    p = Sectioned("Romans 8:29-34")
    questions = [i for i, m in enumerate(p.marks) if m.question]
    assert [p.words[p.first_word(i)].verse for i in questions] == [31, 33, 34]
    for i in questions:
        assert p.words[p.last_word(i)].text.rstrip().endswith(";")
        assert "question" in _indicators(p.marks, i)
        assert i in p.seams
    # 8:32's ὅς γε τοῦ ἰδίου υἱοῦ … πῶς οὐχὶ … χαρίσεται; ends on the question
    # mark too, but does not OPEN with the interrogative, so it is no opener.
    assert p.words[p.last_word(6)].text.rstrip().endswith(";")
    assert not p.marks[6].question


def test_romans12_oun_opens_the_exhortation():
    """Παρακαλῶ οὖν (Rom 12:1) with the doxology of 11:33–36 in front of it:
    the οὖν seam closes the doxology and the section fold joins the two with
    the Inference οὖν names.

    RECOMPUTED for RULING Q8/Q12. The doxology is a chain of rhetorical
    questions — "Τίς γὰρ ἔγνω νοῦν κυρίου;", "τίς σύμβουλος αὐτοῦ ἐγένετο;" —
    and Q8(g) makes each of those a strong seam, so every sentence of this
    passage now stands as its own section. The Inference is still drawn where
    the οὖν puts it; what changed is that its supported side is the 12:1
    sentence alone, with 12:2 chaining on as a further Series."""
    p = Sectioned("Romans 11:33-12:2")
    assert p.marks[7].oun
    assert p.words[p.first_word(7)].chapter == 12
    assert 7 in p.seams
    assert [m.question for m in p.marks].count(True) == 3
    assert p.sections[-2:] == [(7, 7), (8, 8)]

    doc = build_document(p.segments)
    inference = the_one(b for b in brackets(doc["forest"][0])
                        if b["rel"] == "Inf")
    assert inference["prominent"] == 1
    assert span_of(doc, inference["children"][1]) == (p.first_word(7),
                                                      p.last_word(7))
    assert span_of(doc, inference["children"][0]) == (p.first_word(0),
                                                      p.last_word(6))


# ---------------------------------------------------------------------------
# The promotion pass — the one structure-dependent indicator

def test_gar_block_that_crosses_a_sentence_is_promoted_to_its_own_section():
    """Romans 5:9–11 has no surface indicator at all inside it, so the
    promotion pass alone sections it: the γάρ of 5:10 opens a because-block
    that RUNS ON into 5:11 (οὐ μόνον δέ, ἀλλὰ καὶ καυχώμενοι …, a Series
    join), and a support that develops across a sentence boundary is
    section-sized.

    The consequence is the tree: the Ground supports the whole block
    (5:10–11) instead of 5:10 alone, which is what a flat sentence fold gives.

    (This test used to run on Hebrews 4:11–13, which the RULING Q8/Q12 soft
    indicators now seam on the surface — the same two sections, but no longer
    the promotion pass's doing.)"""
    p = Sectioned("Romans 5:9-11")
    assert len(p.packets) == 3
    assert p.seams == []                      # nothing on the surface
    assert p.sections == [(0, 0), (1, 2)]     # …the promotion did this

    doc = build_document(p.segments)
    root = doc["forest"][0]
    assert root["rel"] == "Grnd" and root["prominent"] == 0
    assert span_of(doc, root["children"][0]) == (p.first_word(0), p.last_word(0))
    support = root["children"][1]
    assert span_of(doc, support) == (p.first_word(1), p.last_word(2))


def test_a_within_sentence_gar_is_not_a_section():
    """RULING Q10: the development must CROSS A SENTENCE BOUNDARY.

    1 Thess 1:6–10 has two γάρ Grounds. The 1:8 one (ἀφ᾽ ὑμῶν γὰρ ἐξήχηται …)
    never qualified — it develops a Neg/Pos and a Cause–Effect inside its own
    sentence. The 1:9 one (αὐτοὶ γὰρ περὶ ἡμῶν ἀπαγγέλλουσιν …) used to be
    promoted on the strength of the coordinate INSIDE it, and no longer is:
    nothing Ser-chains onto it, so its support stays a supporting clause and
    the passage is one section. The two Grounds nest exactly as the student
    drew them."""
    p = Sectioned("1 Thessalonians 1:6-10")
    assert p.seams == []
    assert p.sections == [(0, 2)]
    doc = build_document(p.segments)
    root = doc["forest"][0]
    assert root["rel"] == "Grnd"
    inner = root["children"][0]
    assert inner["rel"] == "Grnd"
    assert span_of(doc, inner) == (p.first_word(0), p.last_word(1))


def test_a_causal_hoti_block_is_promoted_too():
    """RULING Q10's second half: a CAUSAL ὅτι whose ground runs on into the
    following sentences is a because-block like a γάρ, and promotes.

    1 John 3:2–3: "οἴδαμεν ὅτι ἐὰν φανερωθῇ ὅμοιοι αὐτῷ ἐσόμεθα, ὅτι ὀψόμεθα
    αὐτὸν καθώς ἐστιν." — the first ὅτι is the content of οἴδαμεν, the second
    is causal ("because we will see Him as He is"), and 3:3 ("καὶ πᾶς ὁ ἔχων
    τὴν ἐλπίδα ταύτην …") Ser-chains onto it. The surface indicators put 3:2's
    two sentences and 3:3 in ONE section; the promotion cuts the block out."""
    p = Sectioned("1 John 3:1-4")
    assert _causal_hoti_sentence(p.packets[3].opening, p.words)
    assert p.words[p.first_word(3)].verse == 2
    surface = _section_bounds(len(p.packets), p.seams)
    assert (2, 4) in surface                  # what the seams alone give
    assert p.sections == [(0, 0), (1, 1), (2, 2), (3, 4), (5, 5)]

    doc = build_document(p.segments)
    starts = {pr["id"]: pr["source"]["start"] for pr in doc["propositions"]}
    assert starts[doc["sections"][-2]["start"]] == p.first_word(3)


def test_a_causal_hoti_inside_one_sentence_is_not_a_section():
    """The same crossing rule guards the ὅτι half. Matt 5:3 Μακάριοι οἱ πτωχοὶ
    τῷ πνεύματι, ὅτι αὐτῶν ἐστιν ἡ βασιλεία τῶν οὐρανῶν — a causal ὅτι with
    nothing chained onto its sentence, so the block is one sentence long and
    the verse stays a single section."""
    p = Sectioned("Matthew 5:3")
    assert _causal_hoti_sentence(p.packets[0].opening, p.words)
    assert p.sections == [(0, 0)]


# ---------------------------------------------------------------------------
# The section fold, and what it does to the minimal tier

def test_the_section_fold_reuses_the_sentence_join_table():
    """The big fold asks the same question of a section's FIRST sentence that
    the small fold asks of every sentence, through the same
    ``_sentence_join``: γάρ → Ground, οὖν → Inference, δέ/καί/asyndeton →
    Series. 1 John's sections are asyndeton and δέ, so they chain as Series;
    Hebrews' last section opens with the γάρ of 4:12, so the outermost
    bracket there is that Ground (RECOMPUTED for RULING Q8/Q12: 4:12 is a
    section of its own now — see test_firstpass_golden), and the Inference the
    οὖν seam produced sits inside it."""
    john = build_document(Sectioned("1 John 1:1-2:2").segments)
    assert john["forest"][0]["rel"] == "Ser"
    hebrews = build_document(Sectioned("Hebrews 4:9-12").segments)
    assert hebrews["forest"][0]["rel"] == "Grnd"
    assert hebrews["forest"][0]["children"][0]["rel"] == "Inf"


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
    assert [b["color"] for b in doc["sections"]] == list(range(1, 8))
    assert [starts[b["start"]] for b in doc["sections"]] == [
        p.first_word(lo) for lo, _ in p.sections[1:]]
    # Two of them are the BSB's own divisions: the 1:5 heading and the 1:8
    # paragraph (the others are RULING Q8's indicators — see
    # test_1john_headings_and_paragraphs_section_the_letter_opening).
    assert {"p20", "p34"} <= {b["start"] for b in doc["sections"]}
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
    """1 Thess 1:6–10: no heading, no paragraph, no quotation, no οὖν, no soft
    pair (each boundary carries the English period and nothing else), and no
    because-block that crosses a sentence — nothing to section on, so the
    passage is one block and the document carries no ``sections`` key at all
    (the shape the editor writes when the analyst has drawn no breaks).

    (This test used to run on 1 John 1:5–7, whose 5→6 boundary now carries
    three soft indicators — RULING Q8/Q12.)"""
    p = Sectioned("1 Thessalonians 1:6-10")
    assert p.seams == []
    assert p.sections == [(0, 2)]
    doc = build_document(p.segments)
    assert "sections" not in doc
    validate_document(doc, corpus_size=len(p.words))
