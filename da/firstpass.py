"""Initial entry: pasted text OR a typed reference in, a first-pass
analysis out.

The automatic analyzer has two levels, the caller's choice. MINIMAL (the
default) draws the connections that belong in the MINIMAL ANALYSIS as the DA
expert re-tiered it (docs/DESIGN.md §5): both the calls the GRAMMAR FORCES (an
explicit subordinator, οὐ … ἀλλά, μέν … δέ) and the SENSIBLE DEFAULTS a
competent analyst would start from (δέ → Series, ἵνα → purpose, causal ὅτι →
Ground, an aorist participle before its clause → Temporal, asyndeton → Series,
and the readings the aligned English states outright). A default that is
usually right is worth drawing — re-labelling one bracket beats drawing the
structure by hand — so only the GENUINELY UNDECIDABLE joins are left
disconnected for the analyst: a bare ἀλλά, an apposition, an
implicit-proposition prepositional phrase, an unknown subordinator, and which
clauses of an asyndetic run belong together. MAXIMAL runs the full classifier:
every judgment call included, the whole passage proposed as one tree. Stage 1
(:mod:`da.segmentation`) pre-splits into clause propositions either way.

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

# Sentence-final punctuation for a RAW (unaligned) paste: period, Greek
# question mark, raised dot — the same three as
# :data:`da.corpus.loader.SENTENCE_FINAL`, which is what the aligned path uses.
# One member each: the NFC normalization in :func:`_raw_document` runs before
# the split and already maps the Greek question mark U+037E to ';' and the ano
# teleia U+0387 to the middle dot U+00B7, so there is nothing else to match.
_SENTENCE_SPLIT = re.compile(r"[.;·]+")


@dataclass
class FirstPassResult:
    document: dict
    alignment: Alignment | None


def first_pass(text: str, maximal: bool = False) -> FirstPassResult:
    """Locate the input — reference or paste — and analyze it. ``maximal``
    runs the full classifier; the default draws only the sure connections."""
    if looks_like_reference(text):
        # resolve() raises ReferenceError (a ValueError) for a reference that
        # names no real passage; the view turns that into a 400 the same way
        # it does an unanalyzable paste.
        reference = resolve(text)
        return FirstPassResult(
            _analyzed(reference.start, reference.end, maximal),
            _reference_alignment(reference),
        )
    alignment = align(text)
    if alignment is None:
        return FirstPassResult(_raw_document(text), None)
    return FirstPassResult(_analyzed(alignment.start, alignment.end, maximal),
                           alignment)


def _analyzed(start: int, end: int, maximal: bool) -> dict:
    """Segment a corpus range into clauses and draw its connections."""
    # Imported here, not at module top: the analyzer lives in its own modules
    # and raw-mode entry must keep working even while they are being reworked.
    from .segmentation import segment
    from .treebuild import build_document

    return build_document(segment(start, end), confident_only=not maximal)


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
