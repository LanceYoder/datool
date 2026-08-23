"""Locate pasted Greek text in the corpus (paste alignment).

Strategy: fold the pasted tokens and the corpus words to bare-letter keys,
index the corpus by folded n-grams, vote on candidate start offsets, then run
a token-level sequence match over a padded corpus window around each
candidate. The sequence match (rather than a fixed-offset comparison) is what
makes pastes from other editions work: NA28 differs from SBLGNT by occasional
one-word insertions/omissions (e.g. SBLGNT's δὲ in 1 John 1:7), which would
otherwise shift every following token off by one.
"""

import difflib
from dataclasses import dataclass
from functools import lru_cache

from .loader import Word, format_ref, load_words
from .normalize import tokenize

NGRAM = 3
MIN_MATCH_RATIO = 0.75
# Corpus words of slack on each side of a candidate window, allowing for the
# paste having words the corpus lacks and vice versa.
WINDOW_PAD = 8


@dataclass(frozen=True)
class Alignment:
    start: int                 # inclusive corpus word index
    end: int                   # inclusive
    ref: str                   # e.g. "1 John 1:5–7"
    total_tokens: int          # tokens in the paste
    matched_tokens: int
    mismatched_positions: tuple[int, ...]  # paste token positions that differ

    @property
    def exact(self) -> bool:
        return self.matched_tokens == self.total_tokens


@lru_cache(maxsize=1)
def _ngram_index() -> dict[tuple[str, ...], tuple[int, ...]]:
    words = load_words()
    folded = [w.folded for w in words]
    index: dict[tuple[str, ...], list[int]] = {}
    for i in range(len(folded) - NGRAM + 1):
        key = tuple(folded[i:i + NGRAM])
        index.setdefault(key, []).append(i)
    return {k: tuple(v) for k, v in index.items()}


def align(text: str) -> Alignment | None:
    """Best corpus window for the pasted text, or None if nothing plausible."""
    tokens = tokenize(text)
    if len(tokens) < NGRAM:
        return None
    words = load_words()
    index = _ngram_index()

    # Vote: each matching n-gram at paste offset i and corpus position p
    # implies the paste starts at corpus position p - i.
    votes: dict[int, int] = {}
    for i in range(len(tokens) - NGRAM + 1):
        key = tuple(tokens[i:i + NGRAM])
        for p in index.get(key, ()):
            start = p - i
            if start >= 0:
                votes[start] = votes.get(start, 0) + 1
    if not votes:
        return None

    # Sequence-match the paste against a padded window around each candidate.
    best: Alignment | None = None
    candidates = sorted(votes, key=votes.get, reverse=True)[:5]
    for start in candidates:
        lo = max(0, start - WINDOW_PAD)
        hi = min(len(words) - 1, start + len(tokens) + WINDOW_PAD)
        window = [words[k].folded for k in range(lo, hi + 1)]
        matcher = difflib.SequenceMatcher(None, tokens, window, autojunk=False)
        blocks = [b for b in matcher.get_matching_blocks() if b.size > 0]
        if not blocks:
            continue
        c_start = lo + blocks[0].b
        c_end = lo + blocks[-1].b + blocks[-1].size - 1
        if words[c_start].book != words[c_end].book:
            continue  # a paste never spans a book boundary
        matched_paste: set[int] = set()
        for b in blocks:
            matched_paste.update(range(b.a, b.a + b.size))
        mismatches = tuple(i for i in range(len(tokens)) if i not in matched_paste)
        matched = len(tokens) - len(mismatches)
        if best is None or matched > best.matched_tokens:
            best = Alignment(
                start=c_start,
                end=c_end,
                ref=format_ref(c_start, c_end),
                total_tokens=len(tokens),
                matched_tokens=matched,
                mismatched_positions=mismatches,
            )

    if best is None or best.matched_tokens < MIN_MATCH_RATIO * best.total_tokens:
        return None
    return best
