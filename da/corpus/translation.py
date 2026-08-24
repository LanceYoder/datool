"""English reference translation, verse by verse — shown alongside the Greek.

The text is the World English Bible (WEB, https://worldenglishbible.org),
public domain, generated into ``data/web-nt.tsv`` as
``book<TAB>chapter<TAB>verse<TAB>text`` with MorphGNT book numbers (1 Matthew …
27 Revelation). Display-only: nothing in the analysis model references it.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from .loader import format_ref, load_words

_DATA = Path(__file__).parent / "data" / "web-nt.tsv"


@lru_cache(maxsize=1)
def load_translation() -> dict[tuple[int, int, int], str]:
    """(book, chapter, verse) -> English text, for the whole NT."""
    out: dict[tuple[int, int, int], str] = {}
    with open(_DATA, encoding="utf-8") as f:
        for line in f:
            book, chapter, verse, text = line.rstrip("\n").split("\t", 3)
            out[(int(book), int(chapter), int(verse))] = text
    return out


def verses_for_range(start: int, end: int) -> list[dict]:
    """The verses intersecting the INCLUSIVE corpus word range [start, end].

    Each entry carries the verse's identity, its English text (missing verses
    are skipped), its human reference, and ``start`` — the corpus index of the
    verse's FIRST word (which may precede the requested range when the range
    begins mid-verse; the UI clamps).
    """
    words = load_words()
    translation = load_translation()

    # Walk back to the true first word of the verse the range opens in.
    first = words[start]
    verse_start = start
    while verse_start > 0:
        prev = words[verse_start - 1]
        if (prev.book, prev.chapter, prev.verse) != (first.book, first.chapter, first.verse):
            break
        verse_start -= 1

    out: list[dict] = []
    seen: set[tuple[int, int, int]] = set()
    for i in range(start, end + 1):
        w = words[i]
        key = (w.book, w.chapter, w.verse)
        if key in seen:
            continue
        seen.add(key)
        text = translation.get(key)
        if text is None:
            continue
        out.append({
            "book": w.book,
            "chapter": w.chapter,
            "verse": w.verse,
            "start": verse_start if key == (first.book, first.chapter, first.verse) else i,
            "ref": format_ref(i, i),
            "text": text,
        })
    return out
