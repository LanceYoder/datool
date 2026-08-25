"""Turn a typed passage reference into a corpus word range.

The user types what they would say — "Eph 1:3-14", "philipians 1.9–11",
"1 jn 1:5 to 7", "Romans 8" — and this module answers with the inclusive word
indices that span it. Nothing here is strict: book names match FUZZILY (any
unambiguous prefix, common abbreviations, and a similarity fallback that
absorbs typos), separators may be colons, periods or spaces, and the dash may
be any of the hyphen/en-dash/em-dash family or the word "to".

A reference that names no verses means the whole chapter; one that names no
chapter (a one-chapter book, "Jude") means the whole book.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from difflib import SequenceMatcher

from .loader import BOOK_NAMES, load_words

# Abbreviations the prefix rule alone cannot reach — either because they skip
# letters (Mt, Rom) or because the plain prefix would be ambiguous (J).
_ALIASES: dict[str, int] = {
    "mt": 1, "matt": 1,
    "mk": 2, "mrk": 2,
    "lk": 3, "luk": 3,
    "jn": 4, "joh": 4, "jhn": 4,
    "ac": 5, "acts": 5,
    "rom": 6, "rm": 6,
    "1co": 7, "1cor": 7, "1c": 7,
    "2co": 8, "2cor": 8, "2c": 8,
    "gal": 9, "ga": 9,
    "eph": 10, "ep": 10,
    "phil": 11, "php": 11, "pp": 11,
    "col": 12, "cl": 12,
    "1thess": 13, "1th": 13, "1ts": 13,
    "2thess": 14, "2th": 14, "2ts": 14,
    "1tim": 15, "1ti": 15, "1tm": 15,
    "2tim": 16, "2ti": 16, "2tm": 16,
    "tit": 17, "tt": 17,
    "phlm": 18, "phm": 18, "philem": 18,
    "heb": 19, "hb": 19,
    "jas": 20, "jm": 20, "jam": 20,
    "1pet": 21, "1pe": 21, "1pt": 21, "1p": 21,
    "2pet": 22, "2pe": 22, "2pt": 22, "2p": 22,
    "1jn": 23, "1joh": 23, "1j": 23, "1john": 23,
    "2jn": 24, "2joh": 24, "2j": 24, "2john": 24,
    "3jn": 25, "3joh": 25, "3j": 25, "3john": 25,
    "jud": 26, "jde": 26,
    "rev": 27, "rv": 27, "apoc": 27,
}

# How close a typo has to be to a book name before it counts as that book.
_FUZZY_CUTOFF = 0.72


class ReferenceError(ValueError):
    """The text is not a passage reference this module can resolve."""


@dataclass(frozen=True, slots=True)
class Reference:
    """A resolved reference: the book, the verse span, and the word range."""

    book: int
    start_chapter: int
    start_verse: int
    end_chapter: int
    end_verse: int
    start: int  # inclusive corpus word index
    end: int    # inclusive corpus word index
    ref: str    # canonical display form, e.g. "Ephesians 1:3–14"

    @property
    def book_name(self) -> str:
        return BOOK_NAMES[self.book - 1]


def _fold(text: str) -> str:
    """Lowercase, unaccented, punctuation-free — how names are compared."""
    decomposed = unicodedata.normalize("NFKD", text.lower())
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]", "", stripped)


def _book_keys() -> dict[str, int]:
    """Folded full names ('1corinthians') → book number."""
    return {_fold(name): i + 1 for i, name in enumerate(BOOK_NAMES)}


def match_book(text: str) -> int | None:
    """The book a typed name refers to, or None when nothing is close enough.

    Tried in order: exact name, alias table, unambiguous prefix, then closest
    name by similarity. A prefix matching several books (e.g. "1" or "phi")
    resolves only if the alias table already claimed it.
    """
    key = _fold(text)
    if not key:
        return None
    names = _book_keys()
    if key in names:
        return names[key]
    if key in _ALIASES:
        return _ALIASES[key]
    prefixed = [book for name, book in names.items() if name.startswith(key)]
    if len(prefixed) == 1:
        return prefixed[0]
    best, best_score = None, 0.0
    for name, book in names.items():
        score = SequenceMatcher(None, key, name).ratio()
        if score > best_score:
            best, best_score = book, score
    return best if best_score >= _FUZZY_CUTOFF else None


# "<book> <chapter>[:.<verse>] [-–— | to] [<chapter>:]<verse>"
_DASH = r"(?:\s*(?:[-–—]|\bto\b|\bthrough\b)\s*)"
_PATTERN = re.compile(
    r"^\s*(?P<book>[1-3]?\s*[^\d]+?)\s*"
    r"(?:(?P<c1>\d+)\s*(?:[:.]\s*(?P<v1>\d+))?)?"
    rf"(?:{_DASH}(?:(?P<c2>\d+)\s*[:.]\s*)?(?P<v2>\d+))?"
    r"\s*$",
    re.IGNORECASE,
)


def looks_like_reference(text: str) -> bool:
    """Whether `text` should be READ as a reference rather than as a paste.

    Greek is never a reference, and neither is anything long: a paste that
    happens to start with a word resembling a book name must still be aligned
    as text. Everything else is left to :func:`resolve` to accept or reject.
    """
    if not isinstance(text, str):
        return False
    stripped = text.strip()
    if not stripped or len(stripped) > 60:
        return False
    if any("\u0370" <= c <= "\u03ff" or "\u1f00" <= c <= "\u1fff" for c in stripped):
        return False
    match = _PATTERN.match(stripped.replace("–", "-").replace("—", "-"))
    return match is not None and match_book(match.group("book")) is not None


def parse_reference(text: str) -> tuple[int, int, int, int, int]:
    """(book, start_chapter, start_verse, end_chapter, end_verse) from text.

    Verses are 0 where the reference named none, meaning "the whole chapter";
    the caller resolves that against the corpus.
    """
    if not isinstance(text, str) or not text.strip():
        raise ReferenceError("type a passage reference")
    match = _PATTERN.match(text.replace("–", "-").replace("—", "-"))
    if match is None:
        raise ReferenceError(f"“{text.strip()}” is not a passage reference")
    book = match_book(match.group("book"))
    if book is None:
        raise ReferenceError(f"no New Testament book matches “{match.group('book').strip()}”")

    c1 = int(match.group("c1")) if match.group("c1") else 0
    v1 = int(match.group("v1")) if match.group("v1") else 0
    c2 = int(match.group("c2")) if match.group("c2") else 0
    v2 = int(match.group("v2")) if match.group("v2") else 0

    # "Eph 1" is a whole chapter; "Jude" is a whole book; "Eph 1:3-14" spans
    # verses inside one chapter; "Eph 1:3-2:5" spans chapters.
    if c1 == 0:
        return book, 0, 0, 0, 0
    if v1 == 0:
        # "Eph 1-2" reads as chapters, not verses — a bare number on the right
        # of the dash is another chapter. But "Phil 1-1:19" names a chapter
        # AND a verse there, so it ends at that verse; reading its 19 as a
        # chapter asked the corpus for Philippians 19.
        if c2:
            return book, c1, 0, c2, v2
        return (book, c1, 0, v2 or c1, 0)
    end_chapter = c2 or c1
    end_verse = v2 or v1
    return book, c1, v1, end_chapter, end_verse


def _max_chapter(book: int) -> int:
    """Highest chapter number the corpus has for a book (0 when unknown)."""
    return max((w.chapter for w in load_words() if w.book == book), default=0)


def _verse_bounds(book: int, chapter: int, verse: int) -> tuple[int, int] | None:
    """(first, last) word index of a verse — or of a chapter when verse is 0,
    or of a whole book when chapter is 0. None when the corpus has no such
    place."""
    first = last = None
    for word in load_words():
        if word.book != book:
            continue
        if chapter and word.chapter != chapter:
            continue
        if verse and word.verse != verse:
            continue
        if first is None:
            first = word.index
        last = word.index
    return None if first is None else (first, last)


def resolve(text: str) -> Reference:
    """A typed reference resolved against the corpus. Raises ReferenceError."""
    book, c1, v1, c2, v2 = parse_reference(text)
    # A one-chapter book has no chapters to name: "Jude 20-21" is verses, and
    # so is "Philemon 6". The parser cannot know this — the corpus can.
    if c1 and not v1 and _max_chapter(book) == 1:
        c1, v1, c2, v2 = 1, c1, 1, (c2 or v2 or c1)
    start_bounds = _verse_bounds(book, c1, v1)
    end_bounds = _verse_bounds(book, c2, v2)
    name = BOOK_NAMES[book - 1]
    if start_bounds is None or end_bounds is None:
        # Name the end that is actually missing. Reporting the start for a
        # bad end said "Philippians 1 is not in the New Testament", which is
        # both untrue and no help in finding the typo.
        bad_c, bad_v = (c1, v1) if start_bounds is None else (c2, v2)
        where = f"{name} {bad_c}:{bad_v}" if bad_v else (f"{name} {bad_c}" if bad_c else name)
        raise ReferenceError(f"{where} is not in the New Testament")
    start, end = start_bounds[0], end_bounds[1]
    if start > end:
        raise ReferenceError("the passage ends before it begins")
    words = load_words()
    a, b = words[start], words[end]
    if (a.chapter, a.verse) == (b.chapter, b.verse):
        ref = f"{name} {a.chapter}:{a.verse}"
    elif a.chapter == b.chapter:
        ref = f"{name} {a.chapter}:{a.verse}–{b.verse}"
    else:
        ref = f"{name} {a.chapter}:{a.verse}–{b.chapter}:{b.verse}"
    return Reference(book, a.chapter, a.verse, b.chapter, b.verse, start, end, ref)
