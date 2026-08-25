"""ESV verse text via the Crossway ESV API (https://api.esv.org).

An alternate source for the verse-level reference layer, selected with
``?translation=esv`` on ``GET /api/corpus/verses``. Requires an API key in
``settings.ESV_API_KEY``; Crossway's terms allow free non-commercial use
with attribution ("ESV") and forbid keeping a full local copy, so chapters
are fetched on demand and held only in a small in-process cache.

The HTML endpoint is used rather than plain text because it wraps every
verse number as ``<b class="verse-num" id="vBBBCCCVVV-N">``, which keys each
verse exactly (ESV book numbers: Genesis 1 … Revelation 66; the NT starts at
Matthew 40 = MorphGNT book 1 + 39).
"""

from __future__ import annotations

import html
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from functools import lru_cache

from django.conf import settings

from .loader import BOOK_NAMES, load_words
from .translation import verses_for_range

_API = "https://api.esv.org/v3/passage/html/"
# Everything off except the verse numbers we parse by.
_PARAMS = {
    "include-passage-references": "false",
    "include-headings": "false",
    "include-footnotes": "false",
    "include-short-copyright": "false",
    "include-audio-link": "false",
}
# A chapter's first verse is tagged chapter-num ("1:1") rather than verse-num.
_VERSE_NUM = re.compile(
    r'<b class="(?:verse-num|chapter-num)[^"]*" id="v(\d{2})(\d{3})(\d{3})-\d+">[^<]*</b>'
)
_TAG = re.compile(r"<[^>]+>")

ESV_BOOK_OFFSET = 39  # MorphGNT book 1 (Matthew) is ESV book 40

# Required by Crossway's API license wherever ESV text is shown.
COPYRIGHT_NOTICE = (
    "Scripture quotations are from the ESV® Bible (The Holy Bible, English "
    "Standard Version®), © 2001 by Crossway. Used by permission. "
    "All rights reserved."
)


class EsvError(Exception):
    """The ESV text could not be fetched (no key, network, or API error)."""


def _parse_chapter(page: str) -> dict[tuple[int, int, int], str]:
    """(book, chapter, verse) -> plain text, from one chapter's HTML."""
    out: dict[tuple[int, int, int], str] = {}
    matches = list(_VERSE_NUM.finditer(page))
    for m, nxt in zip(matches, matches[1:] + [None]):
        chunk = page[m.end():nxt.start() if nxt is not None else len(page)]
        # split()/join collapses all whitespace, &nbsp; (U+00A0) included.
        text = " ".join(html.unescape(_TAG.sub(" ", chunk)).split())
        book, chapter, verse = (int(g) for g in m.groups())
        key = (book - ESV_BOOK_OFFSET, chapter, verse)
        # A verse split across paragraphs repeats its number; keep both halves.
        out[key] = f"{out[key]} {text}" if key in out else text
    return out


@lru_cache(maxsize=64)
def _chapter(book: int, chapter: int) -> dict[tuple[int, int, int], str]:
    """Fetch and parse one NT chapter (MorphGNT book numbering)."""
    key = settings.ESV_API_KEY
    if not key:
        raise EsvError("ESV_API_KEY is not configured")
    query = urllib.parse.urlencode(
        {"q": f"{BOOK_NAMES[book - 1]} {chapter}", **_PARAMS}
    )
    req = urllib.request.Request(
        f"{_API}?{query}", headers={"Authorization": f"Token {key}"}
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            body = json.load(res)
    except urllib.error.HTTPError as e:
        raise EsvError(f"ESV API returned {e.code}") from e
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
        raise EsvError(f"ESV API unreachable: {e}") from e
    passages = body.get("passages") or []
    if not passages:
        raise EsvError(f"ESV API returned no passage for {BOOK_NAMES[book - 1]} {chapter}")
    return _parse_chapter(passages[0])


def esv_verses_for_range(start: int, end: int) -> list[dict]:
    """``verses_for_range`` shape, but with ESV text. Raises EsvError."""
    words = load_words()
    lookup: dict[tuple[int, int, int], str] = {}
    for book, chapter in {(w.book, w.chapter) for w in words[start:end + 1]}:
        lookup.update(_chapter(book, chapter))
    return verses_for_range(start, end, lookup)
