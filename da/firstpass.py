"""Initial entry: pasted text in, a ONE-BLOCK analysis document out.

The automatic analyzer (stage 1 segmentation + stage 2 tree construction,
:mod:`da.segmentation` and :mod:`da.treebuild`) is switched OFF for initial
entry: every analysis starts as the bare block of text — a single proposition,
no tree — and all structure is built by hand in the editor. The analyzer
modules and their tests remain in the codebase for a possible later opt-in.

Corpus alignment still runs, because a located paste gets a corpus source
(canonical SBLGNT text, per-word morphology tooltips) and a passage reference.
A paste that does not align — non-Greek text, or Greek that is not the NT —
becomes a single raw-source proposition instead.
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass

from .corpus import Alignment, align, load_words
from .documents import SCHEMA_VERSION, validate_document


@dataclass
class FirstPassResult:
    document: dict
    alignment: Alignment | None


def first_pass(text: str) -> FirstPassResult:
    """Locate the paste and wrap it as one block proposition."""
    alignment = align(text)
    if alignment is None:
        return FirstPassResult(_raw_document(text), None)
    return FirstPassResult(_block_document(alignment), alignment)


def _one_prop_document(label: str, source: dict) -> dict:
    doc = {
        "schemaVersion": SCHEMA_VERSION,
        "propositions": [{"id": "p1", "label": label, "source": source}],
        "forest": [{"kind": "prop", "ref": "p1"}],
    }
    validate_document(doc)
    return doc


def _block_document(alignment: Alignment) -> dict:
    """One corpus-sourced proposition spanning the whole located range,
    labeled with its verse span (splits then prime from it: 5–7, 5–7′, …)."""
    words = load_words()
    first = words[alignment.start]
    last = words[alignment.end]
    if (first.chapter, first.verse) == (last.chapter, last.verse):
        label = str(first.verse)
    elif first.chapter == last.chapter:
        label = f"{first.verse}–{last.verse}"
    else:
        label = f"{first.chapter}:{first.verse}–{last.chapter}:{last.verse}"
    return _one_prop_document(
        label,
        {"kind": "corpus", "start": alignment.start, "end": alignment.end},
    )


def _raw_document(text: str) -> dict:
    """One raw-source proposition holding the whole unaligned paste."""
    text = " ".join(unicodedata.normalize("NFC", text).split())
    if not text:
        raise ValueError("no analyzable text in the paste")
    return _one_prop_document("1", {"kind": "raw", "text": text})
