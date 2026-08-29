"""BSB document structure — paragraph, heading, and quotation marks.

``data/bsb-structure.tsv`` (``corpus_index<TAB>comma-separated marks``) is
generated from the Berean Standard Bible interlinear tables
(https://bereanbible.com, public domain), joined to SBLGNT corpus indices
through the BSB word alignment. Marks:

    P          a paragraph begins at this word
    H:<text>   a BSB section heading stands before this word
    Q+         a quotation opens at this word
    Q-         a quotation closes after this word

These are the surface signals of the sectioning pass (docs/sectioning.md):
the translators' own paragraphing and pericope headings, and the bounds of
direct discourse. Quote REOPENS at paragraph starts inside a long speech are
recorded as Q+ like any other open (English typography reopens without
closing), so Q+ counts exceed Q- counts by design.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import NamedTuple

_DATA = Path(__file__).parent / "data" / "bsb-structure.tsv"


class WordMarks(NamedTuple):
    paragraph: bool          # a paragraph begins at this word
    heading: str | None      # BSB section heading before this word
    quote_opens: bool        # a quotation opens at this word
    quote_closes: bool       # a quotation closes after this word


_NONE = WordMarks(False, None, False, False)


@lru_cache(maxsize=1)
def _table() -> dict[int, WordMarks]:
    out: dict[int, WordMarks] = {}
    with open(_DATA, encoding="utf-8") as f:
        for line in f:
            index, raw = line.rstrip("\n").split("\t", 1)
            heading: str | None = None
            paragraph = opens = closes = False
            for mark in raw.split(","):
                if mark == "P":
                    paragraph = True
                elif mark == "Q+":
                    opens = True
                elif mark == "Q-":
                    closes = True
                elif mark.startswith("H:"):
                    heading = mark[2:]
            out[int(index)] = WordMarks(paragraph, heading, opens, closes)
    return out


def marks_for(index: int) -> WordMarks:
    """The structure marks at one corpus word (all-false when unmarked)."""
    return _table().get(index, _NONE)
