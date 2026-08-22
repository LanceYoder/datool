"""Locate pasted Greek text in the corpus (paste alignment).

Strategy: fold the pasted tokens and the corpus words to bare-letter keys,
index the corpus by folded n-grams, vote on candidate start offsets, then score
the best-aligned corpus window. A verbatim SBLGNT paste matches 100%; other
editions usually align with a handful of mismatches, which are reported.
"""

from dataclasses import dataclass
from functools import lru_cache

from .loader import Word, format_ref, load_words
from .normalize import tokenize

NGRAM = 3
MIN_MATCH_RATIO = 0.75


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

    # Score the top candidates by per-token agreement over the aligned window.
    best: Alignment | None = None
    candidates = sorted(votes, key=votes.get, reverse=True)[:5]
    for start in candidates:
        end = start + len(tokens) - 1
        if end >= len(words):
            continue
        if words[start].book != words[end].book:
            continue  # a paste never spans a book boundary
        mismatches = tuple(
            i for i, tok in enumerate(tokens) if words[start + i].folded != tok
        )
        matched = len(tokens) - len(mismatches)
        if best is None or matched > best.matched_tokens:
            best = Alignment(
                start=start,
                end=end,
                ref=format_ref(start, end),
                total_tokens=len(tokens),
                matched_tokens=matched,
                mismatched_positions=mismatches,
            )

    if best is None or best.matched_tokens < MIN_MATCH_RATIO * best.total_tokens:
        return None
    return best
