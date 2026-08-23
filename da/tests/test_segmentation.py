"""Stage 1 (proposition segmentation) tests against the real corpus.

Passages are located by pasting their Greek through da.corpus.align, so the
tests never hardcode corpus indexes. Segment contents are compared as folded
word sequences (da.corpus.normalize folding), making them robust to accent
encoding and apparatus sigla.
"""

from dataclasses import FrozenInstanceError, fields
from unicodedata import normalize

import pytest

from da.corpus import align, load_words
from da.corpus.normalize import tokenize
from da.segmentation import Opener, Segment, segment


def nrm(s: str) -> str:
    return normalize("NFC", s)


def locate(text: str):
    al = align(text)
    assert al is not None, f"could not align paste: {text[:50]}…"
    assert al.exact, f"paste did not align exactly: {text[:50]}…"
    return al


def folded(seg: Segment) -> list[str]:
    words = load_words()
    return [words[i].folded for i in range(seg.start, seg.end + 1)]


def opener_of(seg: Segment):
    if seg.opener is None:
        return None
    return (seg.opener.kind, nrm(seg.opener.lemma))


def book_range(book: int) -> tuple[int, int]:
    idx = [w.index for w in load_words() if w.book == book]
    return idx[0], idx[-1]


# --- 1 John 1:5–7 (SBLGNT) ---------------------------------------------------

FIRST_JOHN_PROPS = [
    "Καὶ ἔστιν αὕτη ἡ ἀγγελία",                                        # 5a
    "ἣν ἀκηκόαμεν ἀπʼ αὐτοῦ",                                          # 5b
    "καὶ ἀναγγέλλομεν ὑμῖν,",                                          # 5c
    "ὅτι ὁ θεὸς φῶς ἐστιν",                                            # 5d
    "καὶ σκοτία ἐν αὐτῷ οὐκ ἔστιν οὐδεμία.",                           # 5e
    "ἐὰν εἴπωμεν",                                                     # 6a
    "ὅτι κοινωνίαν ἔχομεν μετʼ αὐτοῦ",                                 # 6b
    "καὶ ἐν τῷ σκότει περιπατῶμεν,",                                   # 6c
    "ψευδόμεθα",                                                       # 6d
    "καὶ οὐ ποιοῦμεν τὴν ἀλήθειαν·",                                   # 6e
    "ἐὰν δὲ ἐν τῷ φωτὶ περιπατῶμεν",                                   # 7a
    "ὡς αὐτός ἐστιν ἐν τῷ φωτί,",                                      # 7b
    "κοινωνίαν ἔχομεν μετʼ ἀλλήλων",                                   # 7c
    "καὶ τὸ αἷμα Ἰησοῦ τοῦ υἱοῦ αὐτοῦ καθαρίζει ἡμᾶς ἀπὸ πάσης ἁμαρτίας.",  # 7d
]


@pytest.fixture(scope="module")
def first_john_segments():
    al = locate(" ".join(FIRST_JOHN_PROPS))
    return segment(al.start, al.end)


def test_1john_1_5_7_proposition_texts(first_john_segments):
    expected = [tokenize(p) for p in FIRST_JOHN_PROPS]
    actual = [folded(s) for s in first_john_segments]
    assert actual == expected


def test_1john_1_5_7_openers(first_john_segments):
    ops = [opener_of(s) for s in first_john_segments]
    assert ops[1] == ("rel", nrm("ὅς"))                                # 5b
    assert ops[2] == ("coord", nrm("καί"))                             # 5c
    assert ops[3] == ("sub_conj", nrm("ὅτι"))                          # 5d
    assert ops[4] == ("coord", nrm("καί"))                             # 5e
    assert ops[5] in (None, ("sub_conj", nrm("ἐάν")))                  # 6a
    assert ops[6] == ("sub_conj", nrm("ὅτι"))                          # 6b
    assert ops[7] == ("coord", nrm("καί"))                             # 6c
    assert ops[8] is None or ops[8][0] == "coord"                      # 6d apodosis
    assert ops[9] == ("coord", nrm("καί"))                             # 6e
    assert ops[10] in (("coord", nrm("δέ")), ("sub_conj", nrm("ἐάν"))) # 7a
    assert ops[11] == ("sub_conj", nrm("ὡς"))                          # 7b
    assert ops[12] is None                                             # 7c
    assert ops[13] == ("coord", nrm("καί"))                            # 7d


def test_1john_1_5_7_sentences(first_john_segments):
    assert [s.sentence for s in first_john_segments] == [0] * 5 + [1] * 5 + [2] * 4


def test_1john_1_7_boundary_before_ean(first_john_segments):
    # Postpositive δέ: the 7a boundary must fall before ἐάν, not after it.
    words = load_words()
    seg_7a = first_john_segments[10]
    assert words[seg_7a.start].lemma == nrm("ἐάν")


# --- Matthew 7:8 — substantival participles stay inline ----------------------

def test_matthew_7_8_three_segments():
    parts = [
        "πᾶς γὰρ ὁ αἰτῶν λαμβάνει",
        "καὶ ὁ ζητῶν εὑρίσκει",
        "καὶ τῷ κρούοντι ἀνοιγήσεται.",
    ]
    al = locate(" ".join(parts))
    segs = segment(al.start, al.end)
    assert [folded(s) for s in segs] == [tokenize(p) for p in parts]
    # Postpositive γάρ: the first clause starts at πᾶς, classified coord γάρ.
    assert segs[0].start == al.start
    assert opener_of(segs[0]) == ("coord", nrm("γάρ"))
    assert opener_of(segs[1]) == ("coord", nrm("καί"))
    assert opener_of(segs[2]) == ("coord", nrm("καί"))
    # ὁ αἰτῶν / ὁ ζητῶν / τῷ κρούοντι must NOT split as participles.
    assert all(s.opener is None or s.opener.kind != "ptcp" for s in segs)


# --- Matthew 2:9b — embedded relative and ἰδού stay inline -------------------

def test_matthew_2_9b_one_segment():
    al = locate("καὶ ἰδοὺ ὁ ἀστὴρ ὃν εἶδον ἐν τῇ ἀνατολῇ προῆγεν αὐτούς")
    segs = segment(al.start, al.end)
    assert len(segs) == 1
    assert (segs[0].start, segs[0].end) == (al.start, al.end)
    assert opener_of(segs[0]) == ("coord", nrm("καί"))


def test_matthew_2_9_full_verse_keeps_9b_whole():
    # Same clause segmented in its full-verse context: still one piece.
    al = locate("καὶ ἰδοὺ ὁ ἀστὴρ ὃν εἶδον ἐν τῇ ἀνατολῇ προῆγεν αὐτούς")
    words = load_words()
    verse = [w.index for w in words if w.book == 1 and w.chapter == 2 and w.verse == 9]
    segs = segment(verse[0], verse[-1])
    assert (al.start, al.end) in [(s.start, s.end) for s in segs]


# --- Romans 1:16 — postpositive γάρ back-off ---------------------------------

def test_romans_1_16_postpositive_gar():
    al = locate("Οὐ γὰρ ἐπαισχύνομαι τὸ εὐαγγέλιον")
    words = load_words()
    verse = [w.index for w in words if w.book == 6 and w.chapter == 1 and w.verse == 16]
    segs = segment(verse[0], verse[-1])
    assert len(segs) == 2
    # Boundary before Οὐ; opener is the postpositive γάρ.
    assert (segs[0].start, segs[0].end) == (al.start, al.end)
    assert opener_of(segs[0]) == ("coord", nrm("γάρ"))
    assert segs[0].opener.index == al.start + 1
    # δύναμις γὰρ θεοῦ ἐστιν …: clause boundary backs off to after the comma,
    # before δύναμις; Ἰουδαίῳ τε … καὶ Ἕλληνι joins nouns and must not split.
    assert segs[1].start == al.end + 1
    assert opener_of(segs[1]) == ("coord", nrm("γάρ"))


# --- Matthew 8:25 — adverbial participles split ------------------------------

def test_matthew_8_25_participles_split():
    al = locate("καὶ προσελθόντες ἤγειραν αὐτὸν λέγοντες")
    segs = segment(al.start, al.end)
    assert [s.opener.kind if s.opener else None for s in segs] == ["ptcp", None, "ptcp"]
    assert nrm(segs[0].opener.lemma) == nrm("προσέρχομαι")
    assert nrm(segs[2].opener.lemma) == nrm("λέγω")
    words = load_words()
    ptcps = [i for i in range(al.start, al.end + 1) if words[i].is_participle]
    assert segs[0].start <= ptcps[0] <= segs[0].end
    assert segs[2].start <= ptcps[1] <= segs[2].end
    # ἤγειραν αὐτόν resumes the host clause as its own segment.
    assert words[segs[1].start].is_finite_verb


# --- Property: segments exactly tile their range -----------------------------

@pytest.mark.parametrize("book", [23, 6, 20])  # 1 John, Romans, James
def test_segments_tile_range(book):
    words = load_words()
    start, end = book_range(book)
    segs = segment(start, end)
    assert segs, "no segments produced"
    pos = start
    eos_before = 0
    last_sentence = -1
    for s in segs:
        # exact tiling: no gaps, no overlaps, never empty
        assert s.start == pos
        assert s.start <= s.end
        # sentences: 0-based, monotonic, increment exactly at ends_sentence
        assert s.sentence == eos_before
        assert s.sentence >= last_sentence
        last_sentence = s.sentence
        # a sentence break can only sit at the very end of a segment
        assert not any(words[i].ends_sentence for i in range(s.start, s.end))
        if s.opener is not None:
            assert s.opener.kind in {"sub_conj", "rel", "ptcp", "inf", "coord", "pp", "appos"}
            assert s.start <= s.opener.index <= s.end
            assert s.opener.lemma
        eos_before += sum(1 for i in range(s.start, s.end + 1) if words[i].ends_sentence)
        pos = s.end + 1
    assert pos == end + 1


# --- Contract ----------------------------------------------------------------

def test_contract_shapes():
    assert [f.name for f in fields(Segment)] == ["start", "end", "sentence", "opener"]
    assert [f.name for f in fields(Opener)] == ["kind", "lemma", "index"]
    segs = segment(0, 0)  # Matthew 1:1, first word
    assert segs == [Segment(start=0, end=0, sentence=0, opener=None)]
    with pytest.raises(FrozenInstanceError):
        segs[0].start = 1  # type: ignore[misc]
    with pytest.raises(ValueError):
        segment(5, 4)
    with pytest.raises(ValueError):
        segment(-1, 3)
