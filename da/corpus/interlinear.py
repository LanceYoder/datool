"""Word-level contextual English — the per-proposition reference line.

``data/bsb-word-english.tsv`` (``corpus_index<TAB>bsb_order<TAB>english``) is
generated from the Berean Standard Bible interlinear tables
(https://bereanbible.com, public domain) by aligning each verse's Greek rows
to the SBLGNT corpus tokens. Because the mapping is per corpus WORD, any
proposition can show exactly the English of its own words, however the verse
is divided; ``bsb_order`` is the word's position in the BSB's own English
word order, so a row's words can be read as the BSB phrase rather than in
Greek order. Square brackets (``[the]``) mark words the translators supplied.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

_DATA = Path(__file__).parent / "data" / "bsb-word-english.tsv"


@lru_cache(maxsize=1)
def _table() -> dict[int, tuple[int, str]]:
    out: dict[int, tuple[int, str]] = {}
    with open(_DATA, encoding="utf-8") as f:
        for line in f:
            index, order, text = line.rstrip("\n").split("\t", 2)
            out[int(index)] = (int(order), text)
    return out


def english_for(index: int) -> str | None:
    """Contextual English for one corpus word, or None (≈0.4% unaligned)."""
    entry = _table().get(index)
    return entry[1] if entry is not None else None


def english_order(index: int) -> int | None:
    """The word's BSB English word-order key, or None when unaligned.

    Only the RELATIVE order of two keys is meaningful, and only within one
    verse — the values themselves are the upstream table's global row numbers.
    """
    entry = _table().get(index)
    return entry[0] if entry is not None else None
