"""The reference layers: BSB translation verses and TBESG lemma glosses."""

import pytest

from da.corpus import gloss_for, load_words, verses_for_range
from da.corpus.translation import load_translation

# 1 John 1:5-7 = corpus words 124747..124816; verse boundaries 124747 (v5),
# 124771 (v6), 124789 (v7).
J_START, J_V6, J_V7, J_END = 124747, 124771, 124789, 124816


class TestTranslation:
    def test_covers_the_whole_nt(self):
        table = load_translation()
        assert len(table) > 7900
        # First and last verses of the NT exist and read like English.
        assert "genealogy" in table[(1, 1, 1)]
        assert (27, 22, 21) in table
        assert "In the beginning was the Word" in table[(4, 1, 1)]

    def test_verses_for_range_lists_each_verse_once_with_its_start(self):
        verses = verses_for_range(J_START, J_END)
        assert [(v["chapter"], v["verse"]) for v in verses] == [(1, 5), (1, 6), (1, 7)]
        assert [v["start"] for v in verses] == [J_START, J_V6, J_V7]
        assert all(v["book"] == 23 for v in verses)
        assert "God is light" in verses[0]["text"]
        assert verses[0]["ref"] == "1 John 1:5"

    def test_range_opening_mid_verse_reports_the_true_verse_start(self):
        verses = verses_for_range(J_V6 + 3, J_END)  # opens inside verse 6
        assert [(v["verse"], v["start"]) for v in verses] == [(6, J_V6), (7, J_V7)]

    def test_every_corpus_verse_has_translation(self):
        table = load_translation()
        missing = set()
        for w in load_words():
            key = (w.book, w.chapter, w.verse)
            if key not in table:
                missing.add(key)
        # SBLGNT and BSB versification differ in a handful of places (verses
        # the critical text omits, e.g. Matt 17:21); anything beyond a small
        # tail means the data generation broke.
        assert len(missing) < 30, sorted(missing)[:10]


class TestGlosses:
    @pytest.mark.parametrize(
        ("lemma", "gloss_word"),
        [
            ("ἀγάπη", "love"),
            ("ψεύδομαι", "lie"),
            ("σκοτία", "darkness"),
            ("θεός", "God"),
        ],
    )
    def test_known_lemmas(self, lemma, gloss_word):
        entry = gloss_for(lemma)
        assert entry is not None
        translit, gloss = entry
        assert translit
        assert gloss_word in gloss

    def test_unknown_lemma_is_none(self):
        assert gloss_for("ουκλεξισ") is None

    def test_most_corpus_lemmas_resolve(self):
        lemmas = {w.lemma for w in load_words()}
        hits = sum(1 for lemma in lemmas if gloss_for(lemma) is not None)
        assert hits / len(lemmas) > 0.9, f"{hits}/{len(lemmas)} lemmas glossed"


class TestVersesEndpoint:
    """The corpus endpoints need a session too now (accounts-spec §6); the
    ``client`` from da/tests/conftest.py comes signed in.
    """

    def test_range(self, client):
        res = client.get(f"/api/corpus/verses?start={J_START}&end={J_END}")
        assert res.status_code == 200
        body = res.json()
        assert [v["verse"] for v in body] == [5, 6, 7]
        assert "fellowship" in body[1]["text"]

    def test_bad_input(self, client):
        assert client.get("/api/corpus/verses").status_code == 400
        assert client.get("/api/corpus/verses?start=5&end=4").status_code == 400
        assert client.get("/api/corpus/verses?start=0&end=99999").status_code == 400

    def test_words_carry_glosses(self, client):
        res = client.get(f"/api/corpus/words?start={J_V6}&end={J_V6 + 1}")
        assert res.status_code == 200
        first = res.json()[0]  # ἐάν
        assert first["gloss"] is not None
        assert first["translit"]


class TestWordEnglish:
    def test_phil_1_9_reads_per_word(self):
        from da.corpus import english_for, english_order
        # Phil 1:9 opens καὶ τοῦτο προσεύχομαι — BSB "And this [is] my prayer"
        words = load_words()
        start = next(w.index for w in words
                     if w.book == 11 and w.chapter == 1 and w.verse == 9)
        joined = " ".join(
            english_for(i) or "" for i in range(start, start + 3)
        )
        assert joined == "And this [is] my prayer"
        # The BSB order keys of consecutive aligned words are strictly
        # increasing here (the BSB keeps these three in Greek order).
        orders = [english_order(i) for i in range(start, start + 3)]
        assert orders == sorted(orders)

    def test_coverage_is_high(self):
        from da.corpus.interlinear import _table
        assert len(_table()) / len(load_words()) > 0.95


class TestEsvParsing:
    # Real shapes from api.esv.org/v3/passage/html/: a chapter-num opener,
    # a plain verse, a verse split across paragraphs, and a poetry line with
    # class "verse-num inline". No network — parsing only.
    HTML = (
        '<p><b class="chapter-num" id="v50001001-1">1:1&nbsp;</b>Paul and Timothy,</p>\n'
        '<p><b class="verse-num" id="v50001003-1">3&nbsp;</b>I thank my <span>God</span></p>\n'
        '<p><b class="verse-num" id="v50001003-2">3&nbsp;</b>in all my remembrance of you,</p>\n'
        '<span class="line"><b class="verse-num inline" id="v50001004-1">4&nbsp;</b>'
        '&nbsp;&nbsp;always in every prayer</span>'
    )

    def test_parse_chapter(self):
        from da.corpus.esv import _parse_chapter
        table = _parse_chapter(self.HTML)
        assert table[(11, 1, 1)] == "Paul and Timothy,"
        assert table[(11, 1, 3)] == "I thank my God in all my remembrance of you,"
        assert table[(11, 1, 4)] == "always in every prayer"

    def test_esv_source_without_key_is_503(self, settings, client):
        settings.ESV_API_KEY = ""
        from da.corpus.esv import _chapter
        _chapter.cache_clear()
        res = client.get("/api/corpus/verses",
                         {"start": 0, "end": 5, "translation": "esv"})
        assert res.status_code == 503
        assert "ESV_API_KEY" in res.json()["errors"][0]

    def test_bad_translation_param(self, client):
        res = client.get("/api/corpus/verses",
                         {"start": 0, "end": 5, "translation": "kjv"})
        assert res.status_code == 400
