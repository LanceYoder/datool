"""The derived TEXT FLOW (da.treebuild.build_text_flow) and its endpoint.

GROUND TRUTH is documents/"Text Flow Instructions.pdf": its two worked
examples, Matthew 8:23–29 (p. 6) and 1 John 1:5–10 (p. 7), are transcribed
below as ``PDF_MATTHEW`` / ``PDF_1JOHN`` — the indent of every line the course
handout draws. (The four DA spreadsheets in examples/ carry no indentation of
their own: their Greek propositions all sit flush in one column, so the PDF is
the only student-authored flow there is to check against.)

The flow's LINES are the first pass's segments, so where our clause division
differs from the handout's the line count differs too; what the tests pin is
therefore the handout's indent RELATIONSHIPS — a participle opener one step
over its main clause, speech one step under λέγοντες which is one step under
its host, ὥστε one step under what it results from, coordinated clauses level
with what they coordinate with, main clauses flush. 1 John comes out
line-for-line identical to the handout; Matthew's three divergences are named
and asserted as they actually are, never forced.
"""

import pytest

from da.corpus import load_words, resolve
from da.documents import MAX_INDENT, DocumentError, validate_document
from da.firstpass import first_pass
from da.segmentation import segment
from da.treebuild import build_document, build_text_flow


@pytest.fixture
def client():
    from rest_framework.test import APIClient
    return APIClient()


def _range(ref: str) -> tuple[int, int]:
    passage = resolve(ref)
    return passage.start, passage.end


def flow_for(ref: str) -> list[tuple[int, str]]:
    """(indent, Greek text) per line of the flow derived for ``ref``."""
    words = load_words()
    passage = resolve(ref)
    flow = build_text_flow(segment(passage.start, passage.end), words)
    return [
        (line["indent"],
         " ".join(words[i].text for i in range(line["start"], line["end"] + 1)))
        for line in flow["lines"]
    ]


def indents(ref: str) -> list[int]:
    return [indent for indent, _ in flow_for(ref)]


# --- The handout's own flows -------------------------------------------------

MATTHEW = "Matthew 8:23-29"
ONE_JOHN = "1 John 1:5-10"

#: Text Flow Instructions.pdf p. 7, indent per line, in order. Our segmentation
#: produces exactly these 26 lines, so this is a line-for-line comparison.
PDF_1JOHN = [
    0, 1, 1, 1, 1,        # v5  ἔστιν ἡ ἀγγελία / ἣν … / καὶ ἀναγγέλλομεν / ὅτι … / καὶ σκοτία …
    1, 2, 1, 0, 0,        # v6  ἐὰν εἴπωμεν / ὅτι … / καὶ … περιπατῶμεν / ψευδόμεθα / καὶ οὐ ποιοῦμεν
    1, 2, 0, 0,           # v7  ἐὰν … περιπατῶμεν / ὡς … / κοινωνίαν ἔχομεν / καὶ τὸ αἷμα …
    1, 2, 0, 0,           # v8  ἐὰν εἴπωμεν / ὅτι … / ἑαυτοὺς πλανῶμεν / καὶ ἡ ἀλήθεια …
    1, 0, 1, 1,           # v9  ἐὰν ὁμολογῶμεν / πιστός ἐστιν / ἵνα ἀφῇ / καὶ καθαρίσῃ
    1, 2, 0, 0,           # v10 ἐὰν εἴπωμεν / ὅτι … / ψεύστην ποιοῦμεν / καὶ ὁ λόγος …
]


def test_one_john_matches_the_handout_line_for_line():
    """The PDF's second worked example, reproduced exactly.

    Every rule the handout exercises is here: the ἐάν protasis held one step
    in, its ὅτι content another step, the apodosis back at the margin, and
    five coordinated καί clauses each landing level with the clause it
    coordinates with rather than under the dependent standing between them
    (1:6's καὶ … περιπατῶμεν beside the subjunctive ἐὰν εἴπωμεν, 1:5's καὶ
    ἀναγγέλλομεν beside the relative ἣν ἀκηκόαμεν).
    """
    assert indents(ONE_JOHN) == PDF_1JOHN


def test_one_john_lines_are_the_students_clauses():
    lines = flow_for(ONE_JOHN)
    assert len(lines) == len(PDF_1JOHN) == 26
    assert lines[0][1].startswith("Καὶ")
    assert lines[5][1].startswith("ἐὰν εἴπωμεν")
    assert lines[8][1].startswith("ψευδόμεθα")


def test_matthew_indent_relationships_follow_the_handout():
    """The PDF's first worked example (p. 6), relationship by relationship.

    Three DOCUMENTED DIVERGENCES, asserted as they are rather than forced:

      * ``τότε`` is a line of its own at 0 where the handout writes ``τότε
        ἐγερθεὶς`` as one indented line — a SEGMENTATION difference (the
        postpositive-free adverb opens no segment of the participle's), not an
        indent one: the participle itself still stands one step over its main
        clause.
      * 8:28's ``δαιμονιζόμενοι …`` / ``ἐξερχόμενοι …`` are two indented lines
        where the handout keeps them inline and sets the second off in
        parentheses (its rule 10) — again segmentation; both still sit one step
        under ὑπήντησαν.
      * 8:29's ``ἦλθες ὧδε πρὸ καιροῦ`` returns to the margin where the handout
        keeps it at the speech's depth. Only the sentence DIRECTLY after a
        dicendi clause is placed under it (see build_text_flow): a speech that
        runs on for further sentences is not something the within-sentence
        assembly can see. The +1 under it (βασανίσαι) is unaffected.
    """
    lines = flow_for(MATTHEW)
    text = [t for _, t in lines]
    at = {}
    for i, (indent, t) in enumerate(lines):
        at[t.split()[0].strip(",;·")] = indent

    # 23  a participle opener one step over the main clause it modifies
    assert (lines[0][0], lines[1][0]) == (1, 0)
    assert text[0].startswith("Καὶ ἐμβάντι")
    # 24  ὥστε one step under the clause it results from; the δέ clause is
    #     another INDEPENDENT clause, so it goes back to the margin — level
    #     with ἐγένετο, not under the ὥστε infinitive standing between them.
    assert [lines[i][0] for i in (2, 3, 4)] == [0, 1, 0]
    assert text[3].startswith("ὥστε")
    # 25  held participle 1, main 0, λέγοντες 1, and the speech at 2 — the
    #     handout's signature shape.
    assert [lines[i][0] for i in (5, 6, 7, 8, 9)] == [1, 0, 1, 2, 2]
    assert text[7].startswith("λέγοντες")
    # 26  a dicendi main clause at 0 and its speech one step under it.
    assert (lines[10][0], lines[11][0]) == (0, 1)
    # 26  τότε (divergence 1) / ἐγερθεὶς over ἐπετίμησεν / καὶ ἐγένετο level.
    assert [lines[i][0] for i in (12, 13, 14, 15)] == [0, 1, 0, 0]
    # 27  ἐθαύμασαν 0, λέγοντες 1, speech 2, its ὅτι 3 — the full ladder.
    assert [lines[i][0] for i in (16, 17, 18, 19)] == [0, 1, 2, 3]
    assert text[19].startswith("ὅτι")
    # 28  genitive absolute held at 1, main 0, the two participles 1
    #     (divergence 2), ὥστε 1.
    assert [lines[i][0] for i in (20, 21, 22, 23, 24)] == [1, 0, 1, 1, 1]
    # 29  ἔκραξαν 0, λέγοντες 1, speech 2 — then the speech's SECOND sentence
    #     back at the margin (divergence 3), its infinitive still +1.
    assert [lines[i][0] for i in (25, 26, 27, 28, 29)] == [0, 1, 2, 0, 1]
    assert at["βασανίσαι"] == 1


# --- The rules on their own --------------------------------------------------

def test_main_clauses_are_flush_and_dependents_are_deeper():
    """Across a long narrative passage every line stays inside the schema's
    0–8, and both extremes occur: main clauses at 0, dependents deeper."""
    values = indents("Matthew 3:1-17")
    assert values
    assert min(values) == 0
    assert max(values) >= 1
    assert all(0 <= v <= MAX_INDENT for v in values)


def test_a_sentence_that_is_only_a_held_dependent_stays_flush():
    """A question sentence inside a speech is a single held unit that never
    gets its main clause — it IS the sentence's clause, so it does not hang
    one step in off nothing (Matt 8:26's Τί δειλοί ἐστε, at 1 under its
    dicendi clause, not at 2)."""
    lines = flow_for(MATTHEW)
    assert lines[10][0] == 0 and lines[10][1].startswith("καὶ λέγει")
    assert lines[11][0] == 1 and lines[11][1].startswith("Τί δειλοί")


def test_inter_sentence_logic_does_not_indent():
    """1 John's sentences are chained by δέ and asyndeton and every one of
    them opens at the margin: the flow is grammatical, and the blank line —
    not an indent — is what separates sentences."""
    lines = flow_for(ONE_JOHN)
    words = load_words()
    flow = build_text_flow(segment(*_range(ONE_JOHN)), words)
    starts = [i for i, line in enumerate(flow["lines"])
              if i == 0 or words[flow["lines"][i - 1]["end"]].ends_sentence]
    # Each of those sentence openers is a protasis, held one step in; the
    # apodosis that follows it is what stands flush. No sentence is indented
    # BECAUSE of the sentence before it.
    assert [lines[i][0] for i in starts] == [0, 1, 1, 1, 1, 1]


def test_embedded_interrupting_relative_is_marked_in_place():
    """Matt 2:9's ὁ ἀστὴρ ⟨ὃν εἶδον ἐν τῇ ἀνατολῇ⟩ προῆγεν: the segmenter
    keeps the relative inline, and the flow sets it off with parentheses
    without moving a single boundary."""
    words = load_words()
    start, end = _range("Matthew 2:7-12")
    segments = segment(start, end)
    flow = build_text_flow(segments, words)
    marked = [(line, span) for line in flow["lines"]
              for span in line.get("embedded", ())]
    assert marked, "the interrupting relative should be reported"
    line, span = marked[0]
    assert span["style"] == "paren"
    assert line["start"] <= span["start"] <= span["end"] <= line["end"]
    assert " ".join(words[i].text for i in range(span["start"], span["end"] + 1)) \
        == "ὃν εἶδον ἐν τῇ ἀνατολῇ"
    # … and a document carrying those marks validates.
    document = build_document(segments)
    document["textFlow"] = flow
    validate_document(document, corpus_size=len(words))


def test_surfacing_embedded_spans_changed_no_boundary():
    """The Segment field is additive: the goldens' boundaries are untouched."""
    start, end = _range("Matthew 2:7-12")
    segments = segment(start, end)
    assert [s.start for s in segments[1:]] == [s.end + 1 for s in segments[:-1]]
    assert any(s.embedded for s in segments)
    assert all(all(s.start <= a <= b <= s.end for a, b in s.embedded)
               for s in segments)


# --- Contiguity & validation -------------------------------------------------

def test_flow_tiles_the_passage_and_validates_in_a_document():
    start, end = _range(ONE_JOHN)
    segments = segment(start, end)
    flow = build_text_flow(segments, load_words())
    lines = flow["lines"]
    assert lines[0]["start"] == start and lines[-1]["end"] == end
    # Contiguous by construction: the segments tile the range.
    assert all(b["start"] == a["end"] + 1 for a, b in zip(lines, lines[1:]))

    document = build_document(segments)
    document["textFlow"] = flow
    validate_document(document, corpus_size=len(load_words()))


def test_a_broken_flow_would_be_caught():
    """The validator is what guarantees the contiguity above — a sanity check
    that this test would notice if the derivation ever left a gap."""
    start, end = _range(ONE_JOHN)
    segments = segment(start, end)
    document = build_document(segments)
    flow = build_text_flow(segments, load_words())
    flow["lines"][1]["start"] += 1          # open a one-word gap
    document["textFlow"] = flow
    with pytest.raises(DocumentError):
        validate_document(document)


def test_empty_segments_are_refused():
    with pytest.raises(ValueError):
        build_text_flow([])


# --- The first pass ships it -------------------------------------------------

def test_first_pass_documents_carry_the_flow_at_both_levels():
    minimal = first_pass("1 John 1:5-10").document
    maximal = first_pass("1 John 1:5-10", maximal=True).document
    assert minimal["textFlow"]["lines"]
    # The flow is grammatical, not semantic: the analysis tier does not touch
    # it, so both levels ship the very same flow.
    assert minimal["textFlow"] == maximal["textFlow"]
    assert [line["indent"] for line in minimal["textFlow"]["lines"]] == PDF_1JOHN
    # One line per proposition, over the same words.
    corpus = [p["source"] for p in minimal["propositions"]
              if p["source"]["kind"] == "corpus"]
    assert [(line["start"], line["end"]) for line in minimal["textFlow"]["lines"]] \
        == [(s["start"], s["end"]) for s in corpus]


def test_an_unaligned_paste_has_no_flow():
    """No morphology, no clause analysis — and so no flow to derive."""
    document = first_pass("The quick brown fox. Jumps over the dog.").document
    assert "textFlow" not in document


# --- The endpoint ------------------------------------------------------------

class TestTextFlowEndpoint:
    def test_happy_path(self, client):
        start, end = _range(ONE_JOHN)
        response = client.get("/api/text-flow", {"start": start, "end": end})
        assert response.status_code == 200
        flow = response.json()["textFlow"]
        assert [line["indent"] for line in flow["lines"]] == PDF_1JOHN
        assert flow["lines"][0]["start"] == start
        assert flow["lines"][-1]["end"] == end

    def test_matches_what_the_first_pass_ships(self, client):
        start, end = _range(ONE_JOHN)
        response = client.get("/api/text-flow", {"start": start, "end": end})
        assert response.json()["textFlow"] == first_pass(ONE_JOHN).document["textFlow"]

    def test_range_cap(self, client):
        ok = client.get("/api/text-flow", {"start": 0, "end": 1999})
        assert ok.status_code == 200
        over = client.get("/api/text-flow", {"start": 0, "end": 2000})
        assert over.status_code == 400
        assert any("cap" in e for e in over.json()["errors"])

    def test_bad_ranges(self, client):
        n = len(load_words())
        for params in (
            {},                                # missing both
            {"start": 5},                      # missing end
            {"start": "x", "end": "3"},        # non-integer
            {"start": 5, "end": 2},            # start > end
            {"start": -3, "end": 2},           # negative
            {"start": n - 1, "end": n},        # past the corpus
        ):
            response = client.get("/api/text-flow", params)
            assert response.status_code == 400, params
            assert response.json()["errors"], params
