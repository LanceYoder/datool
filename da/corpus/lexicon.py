"""Lemma glosses for the word-info popover.

``data/glosses.tsv`` (``folded_lemma<TAB>lemma<TAB>transliteration<TAB>gloss``)
is generated from TBESG — the Translators Brief lexicon of Extended Strongs
for Greek, STEPBible.org data by Tyndale House, Cambridge (CC BY 4.0,
https://github.com/STEPBible/STEPBible-Data). Lookup is by accent-folded
lemma, so MorphGNT lemmas and TBESG headwords meet in the middle.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from .normalize import fold

_DATA = Path(__file__).parent / "data" / "glosses.tsv"


@lru_cache(maxsize=1)
def _glosses() -> dict[str, tuple[str, str]]:
    """folded lemma -> (transliteration, gloss)."""
    out: dict[str, tuple[str, str]] = {}
    with open(_DATA, encoding="utf-8") as f:
        for line in f:
            folded, _lemma, translit, gloss = line.rstrip("\n").split("\t", 3)
            out[folded] = (translit, gloss)
    return out


def gloss_for(lemma: str) -> tuple[str, str] | None:
    """(transliteration, short English gloss) for a MorphGNT lemma, or None."""
    return _glosses().get(fold(lemma))
