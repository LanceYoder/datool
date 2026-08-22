"""In-code corpus: the MorphGNT SBLGNT, loaded once per process.

Public API:
    load_words() -> tuple[Word, ...]     the corpus; index == stable word ID
    Word                                 frozen dataclass with parsing helpers
    format_ref(start, end) -> str        human reference for an index range
    align(text) -> Alignment | None      locate pasted text in the corpus
"""

from .align import Alignment, align
from .loader import BOOK_NAMES, Word, format_ref, load_words

__all__ = ["Alignment", "align", "BOOK_NAMES", "Word", "format_ref", "load_words"]
