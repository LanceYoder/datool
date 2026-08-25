"""In-code corpus: the MorphGNT SBLGNT, loaded once per process — plus the
public-domain BSB English translation and TBESG lemma glosses that ride along
for reference display.

Public API:
    load_words() -> tuple[Word, ...]     the corpus; index == stable word ID
    Word                                 frozen dataclass with parsing helpers
    format_ref(start, end) -> str        human reference for an index range
    align(text) -> Alignment | None      locate pasted text in the corpus
    resolve(ref) -> Reference            locate a TYPED reference ("Eph 1:3-14")
    verses_for_range(start, end)         English (BSB) verses over a word range
    gloss_for(lemma)                     (transliteration, gloss) or None
    english_for(index)                   contextual English of one word (BSB)
    english_order(index)                 the word's BSB English-order key
"""

from .align import Alignment, align
from .reference import Reference, ReferenceError, looks_like_reference, match_book, resolve
from .interlinear import english_for, english_order
from .lexicon import gloss_for
from .loader import BOOK_NAMES, Word, format_ref, load_words
from .translation import verses_for_range

__all__ = [
    "Alignment",
    "align",
    "looks_like_reference",
    "match_book",
    "Reference",
    "ReferenceError",
    "resolve",
    "BOOK_NAMES",
    "Word",
    "english_for",
    "english_order",
    "format_ref",
    "gloss_for",
    "load_words",
    "verses_for_range",
]
