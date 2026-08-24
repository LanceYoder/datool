"""Word-level contextual English — the per-proposition reference line.

``data/word-english.tsv`` (``corpus_index<TAB>english``) is generated from
TAGNT — the Translators Amalgamated Greek NT, STEPBible.org data by Tyndale
House, Cambridge (CC BY 4.0) — by aligning each verse's SBL-edition words to
the SBLGNT corpus tokens. Because the mapping is per corpus WORD, any
proposition can show exactly the English of its own words, however the verse
is divided. Angle brackets (``<the>``) mark words the translators supplied.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

_DATA = Path(__file__).parent / "data" / "word-english.tsv"


@lru_cache(maxsize=1)
def _table() -> dict[int, str]:
    out: dict[int, str] = {}
    with open(_DATA, encoding="utf-8") as f:
        for line in f:
            index, text = line.rstrip("\n").split("\t", 1)
            out[int(index)] = text
    return out


def english_for(index: int) -> str | None:
    """Contextual English for one corpus word, or None (≈2% unaligned)."""
    return _table().get(index)
