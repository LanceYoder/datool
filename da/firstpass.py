"""The first pass: pasted text in, complete annotated analysis document out.

Pipeline (docs/DESIGN.md §5): align the paste against the corpus; when it
locates, run stage 1 (:mod:`da.segmentation`) over the aligned range and
stage 2 (:mod:`da.treebuild`) over the segments. When alignment fails —
non-Greek text, or Greek that is not the NT — fall back to raw mode: split
the paste into propositions on sentence punctuation (``.``, ``;``, ``·``),
chain them in one n-ary Series bracket flagged for review, and let the user
take it from there. No classification without morphology.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .corpus import Alignment, align
from .documents import validate_document
from .treebuild import build_document

_SENTENCE_SPLIT = re.compile(r"[.;·]+")


@dataclass
class FirstPassResult:
    document: dict
    alignment: Alignment | None


def first_pass(text: str) -> FirstPassResult:
    """Run the whole first pass over pasted text."""
    alignment = align(text)
    if alignment is None:
        return FirstPassResult(_raw_document(text), None)
    # Imported here, not at module top: stage 1 lives in its own module and
    # raw-mode analysis must keep working even while it is being reworked.
    from .segmentation import segment

    segments = segment(alignment.start, alignment.end)
    return FirstPassResult(build_document(segments), alignment)


def _raw_document(text: str) -> dict:
    """Punctuation-only segmentation for unaligned pastes."""
    chunks = [c.strip() for c in _SENTENCE_SPLIT.split(text) if c.strip()]
    if not chunks:
        raise ValueError("no analyzable text in the paste")
    props = [
        {"id": f"p{i + 1}", "label": str(i + 1),
         "source": {"kind": "raw", "text": chunk}}
        for i, chunk in enumerate(chunks)
    ]
    leaves = [{"kind": "prop", "ref": p["id"]} for p in props]
    tree = leaves[0] if len(leaves) == 1 else {
        "kind": "bracket", "rel": "Ser", "prominent": None,
        "flag": "review", "children": leaves,
    }
    doc = {"schemaVersion": 1, "propositions": props, "tree": tree}
    validate_document(doc)
    return doc
