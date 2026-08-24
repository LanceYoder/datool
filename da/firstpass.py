"""Initial entry: pasted text OR a typed reference in, a complete first-pass
analysis out.

The automatic analyzer is ON for located passages. Stage 1
(:mod:`da.segmentation`) splits the passage into clause propositions and
stage 2 (:mod:`da.treebuild`) connects them into one labeled tree — the
document arrives in the editor fully analyzed, and the editor is where the
analyst overrides it: every split, connection, relationship, and star stays
editable.

Two ways in, one result. Text that reads as a REFERENCE ("Eph 1:3-14",
"1 jn 1:5 to 7", typos and abbreviations included — see
:mod:`da.corpus.reference`) is looked up in the corpus. Anything else is
treated as a PASTE and aligned against it. Either way the analysis runs on a
corpus range, which is what gives it morphology to work from.

A paste that does not align — non-Greek text, or Greek that is not the NT —
splits on sentence punctuation into raw propositions instead, left as
DISCONNECTED forest roots: without morphology there is no clause analysis,
so the tool proposes no structure.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from .corpus import Alignment, align, looks_like_reference, resolve
from .documents import SCHEMA_VERSION, validate_document

# NFC (below) maps the Greek question mark U+037E to ';' and ano teleia
# U+0387 to U+00B7, but both stay in the class as defense in depth.
_SENTENCE_SPLIT = re.compile(r"[.;·;·]+")


@dataclass
class FirstPassResult:
    document: dict
    alignment: Alignment | None


def first_pass(text: str) -> FirstPassResult:
    """Locate the input — reference or paste — and analyze it."""
    if looks_like_reference(text):
        # resolve() raises ReferenceError (a ValueError) for a reference that
        # names no real passage; the view turns that into a 400 the same way
        # it does an unanalyzable paste.
        reference = resolve(text)
        return FirstPassResult(
            _analyzed(reference.start, reference.end),
            _reference_alignment(reference),
        )
    alignment = align(text)
    if alignment is None:
        return FirstPassResult(_raw_document(text), None)
    return FirstPassResult(_analyzed(alignment.start, alignment.end), alignment)


def _analyzed(start: int, end: int) -> dict:
    """Segment a corpus range into clauses and build its tree."""
    # Imported here, not at module top: the analyzer lives in its own modules
    # and raw-mode entry must keep working even while they are being reworked.
    from .segmentation import segment
    from .treebuild import build_document

    return build_document(segment(start, end))


def _reference_alignment(reference) -> Alignment:
    """A resolved reference reported in the same shape as a located paste: it
    matched the corpus exactly, because it came FROM the corpus."""
    count = reference.end - reference.start + 1
    return Alignment(
        start=reference.start,
        end=reference.end,
        ref=reference.ref,
        total_tokens=count,
        matched_tokens=count,
        mismatched_positions=(),
    )


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
    doc = {
        "schemaVersion": SCHEMA_VERSION,
        "propositions": props,
        # No morphology, so no proposed structure: every raw proposition is
        # its own forest root.
        "forest": [{"kind": "prop", "ref": p["id"]} for p in props],
    }
    validate_document(doc)
    return doc
