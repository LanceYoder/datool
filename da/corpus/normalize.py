"""Greek text normalization for corpus matching.

Pasted text arrives from many sources (SBLGNT, NA28 via Logos, web pages) with
different accent encodings (oxia vs. tonos), critical-apparatus sigla, verse
numbers, and punctuation. ``fold`` reduces a token to a bare-letters matching
key; ``tokenize`` turns arbitrary pasted text into a list of foldable tokens.
"""

import re
import unicodedata

# Editorial / critical sigla seen in pastes (NA28 & SBLGNT apparatus marks),
# plus brackets and footnote markers. Removed before tokenization.
_SIGLA = re.compile(r"[⸀⸁⸂⸃⸄⸅⸆⸇⸈⸉⸊⸋°†‡*\[\]()⟦⟧{}⸢⸣⸤⸥]")

# Verse/chapter numbers and other latin/digit runs are dropped as whole tokens.
_GREEK_LETTER = re.compile(r"[Ͱ-Ͽἀ-῿]")


def nfc(text: str) -> str:
    """NFC-normalize one string. MorphGNT lemmas are NFC already, so this is
    what makes a literal lemma written in this source comparable to them
    whatever form the editor saved it in."""
    return unicodedata.normalize("NFC", text)


def nfc_set(*items: str) -> frozenset[str]:
    """A frozenset of NFC-normalized lemmas — the lemma tables' constructor."""
    return frozenset(nfc(item) for item in items)


def strip_diacritics(text: str) -> str:
    decomposed = unicodedata.normalize("NFD", text)
    return "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")


def fold(token: str) -> str:
    """Reduce a token to its matching key: lowercase Greek letters only.

    Handles oxia/tonos differences (via decomposition + mark stripping),
    final sigma, elision apostrophes, and attached punctuation. Returns ""
    for tokens with no Greek letters (verse numbers, latin words, sigla).
    """
    stripped = strip_diacritics(token).lower()
    letters = "".join(ch for ch in stripped if _GREEK_LETTER.match(ch))
    return letters.replace("ς", "σ")


def tokenize(text: str) -> list[str]:
    """Split pasted text into folded, non-empty matching keys."""
    cleaned = _SIGLA.sub(" ", unicodedata.normalize("NFC", text))
    folded = (fold(tok) for tok in cleaned.split())
    return [f for f in folded if f]
