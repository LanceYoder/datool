"""The BSB structure marks: paragraphs, headings, quotation bounds."""

from da.corpus import load_words
from da.corpus.structure import _table, marks_for


class TestStructureMarks:
    def test_1john_headings_land_on_their_words(self):
        words = load_words()
        v1 = next(w.index for w in words
                  if w.book == 23 and w.chapter == 1 and w.verse == 1)
        v5 = next(w.index for w in words
                  if w.book == 23 and w.chapter == 1 and w.verse == 5)
        assert marks_for(v1).heading == "The Word of Life"
        assert marks_for(v1).paragraph
        assert marks_for(v5).heading == "Walking in the Light"

    def test_paragraphs_inside_1john_1(self):
        words = load_words()
        v8 = next(w.index for w in words
                  if w.book == 23 and w.chapter == 1 and w.verse == 8)
        assert marks_for(v8).paragraph          # ἐὰν εἴπωμεν opens a paragraph
        assert marks_for(v8 + 1) == (False, None, False, False)

    def test_speech_opens_in_matthew(self):
        # Matt 3:2 opens the Baptist's first speech: [λέγων] Μετανοεῖτε…
        words = load_words()
        v2 = [w for w in words
              if w.book == 1 and w.chapter == 3 and w.verse == 2]
        assert any(marks_for(w.index).quote_opens for w in v2)

    def test_whole_nt_coverage_is_sane(self):
        table = _table()
        n = len(load_words())
        assert all(0 <= i < n for i in table)
        paragraphs = sum(1 for m in table.values() if m.paragraph)
        headings = sum(1 for m in table.values() if m.heading is not None)
        opens = sum(1 for m in table.values() if m.quote_opens)
        closes = sum(1 for m in table.values() if m.quote_closes)
        # The NT has a few thousand paragraphs, ~a thousand BSB headings,
        # and thousands of quote opens (reopens included). Bounds are loose —
        # they catch a broken regeneration, not drift of a few marks.
        assert 3000 < paragraphs < 8000
        assert 700 < headings < 1500
        assert 1500 < opens < 4000
        assert 200 < closes < 1500
