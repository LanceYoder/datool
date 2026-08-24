"""The reference layers: WEB translation verses and TBESG lemma glosses."""

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
        # SBLGNT and WEB versification differ in a handful of places (verses
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
    @pytest.fixture()
    def client(self):
        from rest_framework.test import APIClient

        return APIClient()

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
