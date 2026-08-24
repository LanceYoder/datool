"""Initial entry: pasted text in, a PRE-SPLIT analysis document out.

Auto-SPLITTING is on: a located paste runs stage 1 (:mod:`da.segmentation`)
and becomes one proposition per clause segment. Auto-RELATIONING stays off:
the propositions arrive as DISCONNECTED forest roots — no brackets, no tree —
and all structure is built by hand in the editor. (Stage 2,
:mod:`da.treebuild`, remains in the codebase with its tests for a later
opt-in.)

Labels mirror the editor's own re-derivation exactly (see
relabelCorpusInTransaction): a segment within one verse is labeled by the
verse, lettered (11a, 11b, …) when the verse holds several; a segment
spanning verses is labeled by its span ("10–12", "1:28–2:3" across chapters).

A paste that does not align — non-Greek text, or Greek that is not the NT —
splits on sentence punctuation into raw propositions instead (no morphology,
so no clause analysis).
"""

from __future__ import annotations

import re
import unicodedata
from collections import Counter
from dataclasses import dataclass

from .corpus import Alignment, align, load_words
from .documents import SCHEMA_VERSION, validate_document

# NFC (below) maps the Greek question mark U+037E to ';' and ano teleia
# U+0387 to U+00B7, but both stay in the class as defense in depth.
_SENTENCE_SPLIT = re.compile(r"[.;·;·]+")


@dataclass
class FirstPassResult:
    document: dict
    alignment: Alignment | None


def first_pass(text: str) -> FirstPassResult:
    """Locate the paste and pre-split it into disconnected propositions."""
    alignment = align(text)
    if alignment is None:
        return FirstPassResult(_raw_document(text), None)
    # Imported here, not at module top: stage 1 lives in its own module and
    # raw-mode entry must keep working even while it is being reworked.
    from .segmentation import segment

    segments = segment(alignment.start, alignment.end)
    return FirstPassResult(_segmented_document(segments), alignment)


def _verse_letter(i: int) -> str:
    """0 → 'a', 25 → 'z', 26 → 'aa', … (bijective base 26)."""
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(97 + r) + s
    return s


def _document(props: list[dict]) -> dict:
    doc = {
        "schemaVersion": SCHEMA_VERSION,
        "propositions": props,
        # No auto-relationing: every proposition is its own forest root.
        "forest": [{"kind": "prop", "ref": p["id"]} for p in props],
    }
    validate_document(doc)
    return doc


def _segmented_document(segments: list) -> dict:
    """One corpus proposition per segment, verse-labeled, all disconnected."""
    words = load_words()

    keyed: list[tuple[object, str]] = []
    group_counts: Counter = Counter()
    for seg in segments:
        first, last = words[seg.start], words[seg.end]
        if (first.book, first.chapter, first.verse) == (last.book, last.chapter, last.verse):
            key = (first.book, first.chapter, first.verse)
            label = str(first.verse)
            group_counts[key] += 1
        elif (first.book, first.chapter) == (last.book, last.chapter):
            key, label = None, f"{first.verse}–{last.verse}"
        else:
            key, label = None, f"{first.chapter}:{first.verse}–{last.chapter}:{last.verse}"
        keyed.append((key, label))

    seen: Counter = Counter()
    props = []
    for i, (seg, (key, label)) in enumerate(zip(segments, keyed)):
        if key is not None and group_counts[key] > 1:
            label += _verse_letter(seen[key])
            seen[key] += 1
        props.append({
            "id": f"p{i + 1}",
            "label": label,
            "source": {"kind": "corpus", "start": seg.start, "end": seg.end},
        })
    return _document(props)


def _raw_document(text: str) -> dict:
    """Punctuation-split raw propositions for unaligned pastes."""
    text = unicodedata.normalize("NFC", text)
    chunks = [" ".join(c.split()) for c in _SENTENCE_SPLIT.split(text)]
    chunks = [c for c in chunks if c]
    if not chunks:
        raise ValueError("no analyzable text in the paste")
    props = [
        {"id": f"p{i + 1}", "label": str(i + 1),
         "source": {"kind": "raw", "text": chunk}}
        for i, chunk in enumerate(chunks)
    ]
    return _document(props)
