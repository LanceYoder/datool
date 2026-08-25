"""Typed passage references: fuzzy book matching, spans, and the entry point."""

import pytest

from da.corpus import load_words, looks_like_reference, match_book, resolve
from da.corpus.reference import ReferenceError, parse_reference
from da.firstpass import first_pass


class TestMatchBook:
    def test_matches_full_names_and_case(self):
        assert match_book("Ephesians") == 10
        assert match_book("ephesians") == 10
        assert match_book("1 Corinthians") == 7

    def test_matches_common_abbreviations(self):
        assert match_book("Eph") == 10
        assert match_book("Phil") == 11
        assert match_book("Phlm") == 18
        assert match_book("1 Jn") == 23
        assert match_book("Rev") == 27

    def test_absorbs_typos(self):
        assert match_book("philipians") == 11
        assert match_book("ephesains") == 10
        assert match_book("thessalonians 1") == 13

    def test_rejects_what_is_not_a_book(self):
        assert match_book("") is None
        assert match_book("Genesis") is None  # Old Testament: not in this corpus
        assert match_book("zzzzz") is None


class TestParseReference:
    def test_verse_span_inside_one_chapter(self):
        assert parse_reference("Eph 1:3-14") == (10, 1, 3, 1, 14)

    def test_accepts_period_and_en_dash_and_the_word_to(self):
        assert parse_reference("Eph 1.3–14") == (10, 1, 3, 1, 14)
        assert parse_reference("Eph 1:3 to 14") == (10, 1, 3, 1, 14)

    def test_span_across_chapters(self):
        assert parse_reference("Eph 1:20-2:3") == (10, 1, 20, 2, 3)

    def test_bare_chapter_and_bare_book(self):
        assert parse_reference("Romans 8") == (6, 8, 0, 8, 0)
        assert parse_reference("Jude") == (26, 0, 0, 0, 0)

    def test_a_bare_number_after_the_dash_is_a_chapter(self):
        assert parse_reference("Eph 1-2") == (10, 1, 0, 2, 0)

    def test_a_chapter_and_verse_after_the_dash_ends_at_that_verse(self):
        # "Phil 1-1:19" is chapter 1 up to verse 19 — not chapters 1 to 19,
        # which asked the corpus for a Philippians 19 and then blamed the
        # start for being missing.
        assert parse_reference("Phil 1-1:19") == (11, 1, 0, 1, 19)

    def test_rejects_empty_and_unknown(self):
        with pytest.raises(ReferenceError):
            parse_reference("")
        with pytest.raises(ReferenceError):
            parse_reference("Genesis 1:1")


class TestResolve:
    def test_resolves_to_the_corpus_words_of_the_span(self):
        ref = resolve("Eph 1:3-14")
        words = load_words()
        assert (words[ref.start].book, words[ref.start].chapter, words[ref.start].verse) == (10, 1, 3)
        assert (words[ref.end].book, words[ref.end].chapter, words[ref.end].verse) == (10, 1, 14)
        assert ref.ref == "Ephesians 1:3–14"

    def test_a_bare_chapter_spans_the_whole_chapter(self):
        ref = resolve("Romans 8")
        words = load_words()
        assert words[ref.start].verse == 1
        assert words[ref.end].verse == 39
        assert ref.ref == "Romans 8:1–39"

    def test_a_typo_still_lands_on_the_passage(self):
        assert resolve("philipians 1.9-11").ref == "Philippians 1:9–11"

    def test_a_one_chapter_book_numbers_verses_not_chapters(self):
        """"Jude 20-21" can only mean verses: the book has no chapter 20."""
        assert resolve("Jude 20-21").ref == "Jude 1:20–21"
        assert resolve("Philemon 6").ref == "Philemon 1:6"
        assert resolve("3 jn 2").ref == "3 John 1:2"
        # The whole book still works, and so does an explicit 1:n.
        assert resolve("Jude").ref == "Jude 1:1–25"
        assert resolve("Jude 1:3").ref == "Jude 1:3"

    def test_a_verse_the_book_does_not_have(self):
        with pytest.raises(ReferenceError):
            resolve("Eph 99:1")

    def test_a_span_reads_to_the_verse_after_the_dash(self):
        assert resolve("Phil 1-1:19").ref == "Philippians 1:1–19"

    def test_a_bad_END_is_named_rather_than_the_start(self):
        with pytest.raises(ReferenceError, match="Philippians 1:99"):
            resolve("Phil 1-1:99")


class TestLooksLikeReference:
    def test_greek_is_never_a_reference(self):
        assert not looks_like_reference("καὶ τοῦτο προσεύχομαι ἵνα ἡ ἀγάπη")

    def test_a_long_line_is_never_a_reference(self):
        assert not looks_like_reference("Ephesians " + "x" * 80)

    def test_references_are(self):
        assert looks_like_reference("Eph 1:3-14")
        assert looks_like_reference("1 jn 1:5 to 7")
        assert looks_like_reference("Jude")


class TestFirstPassEntry:
    def test_a_reference_pulls_the_passage_out_of_the_corpus(self):
        result = first_pass("Eph 1:3-14")
        assert result.alignment is not None
        assert result.alignment.ref == "Ephesians 1:3–14"
        assert result.alignment.exact
        source = result.document["propositions"][0]["source"]
        assert source["kind"] == "corpus"
        assert source["start"] == resolve("Eph 1:3-14").start

    def test_a_paste_still_aligns_as_text(self):
        words = load_words()
        ref = resolve("1 John 1:5-7")
        text = " ".join(w.text for w in words[ref.start:ref.end + 1])
        result = first_pass(text)
        assert result.alignment is not None
        assert result.alignment.ref == "1 John 1:5–7"

    def test_a_reference_to_nowhere_is_a_value_error(self):
        with pytest.raises(ValueError):
            first_pass("Eph 99:1")
