"""Stage 2 of the first pass: tree construction + classification.

Input: the ordered ``Segment`` list produced by :mod:`da.segmentation` (stage 1),
which exactly tiles an inclusive corpus range. Output: a complete, valid
analysis document (see docs/DESIGN.md §3, §5) — every proposition connected
into one tree (a ``forest`` of one root), every bracket labeled with a
taxonomy relationship.

The classifier internally distinguishes confident calls from judgment calls
(the ``review`` markers threaded through the helpers below), but that
bookkeeping never reaches the document: confidence labeling was removed from
the product, so ``build_document`` strips every ``flag`` before returning.

Assembly is a deterministic shift-reduce pass:

Within a sentence
  * A stack holds clause packets. A backward-attaching dependent segment
    (ὅτι/ἵνα-class subordinator, relative, adverbial participle or infinitive)
    pops the top packet and wraps ``[top, dependent]`` — chained trailing
    dependents therefore nest naturally.
  * Protasis-type openers (conditional / temporal / comparative subordinators
    at clause start before any independent clause) are HELD and attach forward:
    the held packet becomes ``children[0]`` of the sentence's conditional-type
    bracket once the apodosis completes at sentence end. Dependents and
    coordinations arriving while a protasis is held build onto the held packet.
  * Coordinate joins (καί/οὐδέ/τε, ἤ, δέ) coordinate at the right edge of the
    target packet, accumulating consecutive clauses into ONE n-ary bracket.
    Postpositive γάρ/οὖν within a sentence relate the new clause to the whole
    packet so far with their table relation.
  * At sentence end leftover stack packets are wrapped as Ser (review).

Between sentences
  * Sentence packets fold left to right. The join comes from the new
    sentence's discourse connective (γάρ → Grnd, οὖν-class → Inf, δέ → Ser
    review, ἀλλά → NegPos review, ἤ → Alt, μέν…δέ → Alt); with none, a
    previous sentence ending in a verbum dicendi + '·' yields FtIn (speech
    content, review), and otherwise the deliberate dumb default: Ser,
    UNFLAGGED. Consecutive Ser-joined sentences accumulate into one n-ary
    Ser bracket.

Star placement is derived from the taxonomy: for each relationship we know
which label index the grammatically marked (dependent) side carries;
``reversed`` is set whenever that side is not ``children[0]``'s default, and
``prominent`` is the child that ends up carrying the starred label.

``segmentation.py`` is developed concurrently; this module codes against the
SEGMENT CONTRACT (``Segment``/``Opener`` attribute shapes) and only imports it
for type checking.
"""

from __future__ import annotations

import unicodedata
from collections import Counter
from typing import TYPE_CHECKING, Iterable, Sequence

from .corpus import load_words
from .documents import SCHEMA_VERSION, validate_document
from .taxonomy import RELATIONSHIPS

if TYPE_CHECKING:  # pragma: no cover — written concurrently, contract-typed
    from .segmentation import Segment


# ---------------------------------------------------------------------------
# Lemma tables (our own compilation from standard grammar — see DESIGN.md §5)

def _L(s: str) -> str:
    return unicodedata.normalize("NFC", s)


def _lset(*items: str) -> frozenset[str]:
    return frozenset(_L(i) for i in items)


GROUND = _lset("γάρ")
INFERENCE = _lset("οὖν", "διό", "ἄρα", "ὅθεν", "τοιγαροῦν", "τοίνυν")
PURPOSE = _lset("ἵνα", "ὅπως")
RESULT = _lset("ὥστε")
CONDITIONAL = _lset("ἐάν", "εἰ", "εἴπερ", "ἐάνπερ")
TEMPORAL = _lset("ὅταν", "ὅτε", "ἐπεί", "ἐπειδή", "ἡνίκα", "ὁσάκις",
                 "ἕως", "ἄχρι", "ἄχρις", "μέχρι", "πρίν")
LOCATIVE = _lset("ὅπου", "οὗ")
COMPARATIVE = _lset("καθώς", "ὥσπερ", "καθάπερ", "ὡς", "ὡσεί")
SERIAL = _lset("καί", "οὐδέ", "μηδέ", "τε", "τέ", "οὔτε", "μήτε")
ALTERNATIVE = _lset("ἤ", "ἤτοι")
ADVERSATIVE = _lset("ἀλλά")
DE = _lset("δέ")
MEN = _lset("μέν")
HOTI = _lset("ὅτι")
NEGATIVES = _lset("οὐ", "μή", "οὐδείς", "μηδείς", "οὐδέ", "μηδέ", "οὔτε",
                  "μήτε", "οὐχί", "οὐκέτι", "μηκέτι", "οὔπω", "μήπω")

# Verbs of saying / perceiving / knowing that take ὅτι-content (Ft/In).
VERBA_DICENDI = _lset(
    "λέγω", "εἶπον", "φημί", "ἀκούω", "οἶδα", "γινώσκω", "πιστεύω",
    "ὁμολογέω", "μαρτυρέω", "γράφω", "ἀποκρίνομαι", "βλέπω", "ὁράω",
    "θεωρέω", "ἀναγγέλλω", "ἀπαγγέλλω", "λαλέω",
)

# Implicit-proposition prepositional phrases: best-guess relation by
# preposition (all review-flagged — these are the interpretive calls).
_PP_REL: dict[str, str] = (
    {_L(p): "MEd" for p in ("εἰς", "πρός")}          # purpose/goal
    | {_L(p): "Tmp" for p in ("ἕως", "ἄχρι", "μέχρι", "πρό", "μετά")}
    | {_L(p): "Loc" for p in ("ἐν", "ἐπί", "ὑπό", "παρά", "πρὸ")}
    | {_L(p): "Grnd" for p in ("διά", "ἐκ", "ἀπό", "χάριν", "ἕνεκα")}
)

# Protasis-type forward-attaching subordinators → their bracket relationship.
_PROTASIS_REL: dict[str, str] = (
    {l: "CndE" for l in CONDITIONAL}
    | {l: "Tmp" for l in TEMPORAL}
    | {l: "Cmp" for l in COMPARATIVE}
)

# Which label index the grammatically marked (dependent) side carries, per
# relationship: e.g. a γάρ clause is the "G" end (labels index 1), a protasis
# the "C?" end (labels index 0), a ὡς clause the "//" end (labels index 0).
_DEP_LABEL: dict[str, int] = {
    "Grnd": 1, "Inf": 1, "MEd": 1, "CE": 1, "FtIn": 1, "NegPos": 1,
    "CndE": 0, "Tmp": 0, "Loc": 0, "Cmp": 0, "WEd": 0,
}

# Discourse connectives recognized at sentence starts (inter-sentence joins).
_DISCOURSE = GROUND | INFERENCE | DE | ADVERSATIVE | ALTERNATIVE | SERIAL
# Postpositives may sit second or third in the sentence; the serial/adversative
# connectives only count in first position (καί later in a clause is adverbial
# "also", ἤ later is comparative "than").
_POSTPOSITIVE = GROUND | DE | _lset("οὖν", "ἄρα", "τοίνυν")


# ---------------------------------------------------------------------------
# Node construction

def _prop_node(global_index: int) -> dict:
    return {"kind": "prop", "ref": f"p{global_index + 1}"}


def _sub(rel: str, first: dict, second: dict, dep_child: int,
         review: bool = False) -> dict:
    """Subordinate bracket over [first, second]; ``dep_child`` says which child
    is the grammatically marked (dependent) side. ``reversed`` and
    ``prominent`` are derived so labels land on the right children."""
    r = RELATIONSHIPS[rel]
    rev = _DEP_LABEL[rel] != dep_child
    node: dict = {
        "kind": "bracket",
        "rel": rel,
        "prominent": (1 - r.starred_label) if rev else r.starred_label,
        "children": [first, second],
    }
    if rev:
        node["reversed"] = True
    if review:
        node["flag"] = "review"
    return node


def _coord(rel: str, children: Sequence[dict], review: bool = False,
           open_: bool = False) -> dict:
    node: dict = {"kind": "bracket", "rel": rel, "prominent": None,
                  "children": list(children)}
    if review:
        node["flag"] = "review"
    if open_:
        node["_open"] = True  # may still accept n-ary siblings; stripped later
    return node


def _edge_coord(node: dict, new: dict, rel: str, review: bool) -> dict:
    """Coordinate ``new`` at the right edge of ``node``: append to an open
    coordinate bracket of the same relationship (n-ary accumulation), descend
    through subordinate brackets to their last child, else open a bracket."""
    if node["kind"] == "bracket":
        if node.get("_open") and node["rel"] == rel and node["prominent"] is None:
            node["children"].append(new)
            if review:
                node["flag"] = "review"
            return node
        if node["prominent"] is not None:
            node["children"][-1] = _edge_coord(node["children"][-1], new, rel, review)
            return node
    return _coord(rel, [node, new], review=review, open_=True)


def _edge_sub(node: dict, new: dict, rel: str, review: bool) -> dict:
    """Subordinate-wrap ``new`` against the right-edge clause of ``node``
    (used for οὐ … ἀλλά, which contrasts with the negated clause)."""
    if node["kind"] == "bracket" and node["prominent"] is not None:
        node["children"][-1] = _edge_sub(node["children"][-1], new, rel, review)
        return node
    return _sub(rel, node, new, dep_child=1, review=review)


# ---------------------------------------------------------------------------
# Segment inspection helpers (contract-typed: .start/.end/.sentence/.opener)

def _seg_words(seg, words) -> Sequence:
    return words[seg.start:seg.end + 1]


def _has_lemma(seg, words, lemmas: frozenset[str]) -> bool:
    return any(_L(w.lemma) in lemmas for w in _seg_words(seg, words))


def _opener_lemma(seg) -> str | None:
    return _L(seg.opener.lemma) if seg.opener is not None else None


def _dependent_call(seg, j: int, segs: Sequence, words) -> tuple[str, bool] | None:
    """(relationship, review) for a backward/forward-attaching dependent
    segment, or None if the segment is not a dependent unit."""
    op = seg.opener
    if op is None:
        return None
    lemma = _L(op.lemma)
    if op.kind == "rel":
        # The relative clause interprets its antecedent's clause: Ft → In*.
        return "FtIn", True
    if op.kind == "appos":
        # Apposition / attributive-article phrase restates: Ft → In*.
        return "FtIn", True
    if op.kind == "pp":
        # Implicit-proposition prepositional phrase: guess by preposition.
        return _PP_REL.get(lemma, "WEd"), True
    if op.kind == "ptcp":
        # Adverbial participle: Way–End best guess, the participle side is W.
        return "WEd", True
    if op.kind == "inf":
        # Adverbial infinitive: purpose (M/Ed, the infinitive is Ed) unless the
        # pattern is ἐν τῷ + inf (temporal) or διὰ τό + inf (causal).
        ws = _seg_words(seg, words)
        if len(ws) >= 2 and ws[1].pos == "RA":
            if _L(ws[0].lemma) == _L("ἐν"):
                return "Tmp", True
            if _L(ws[0].lemma) == _L("διά"):
                return "Grnd", True
        return "MEd", False
    if op.kind == "sub_conj":
        if lemma in PURPOSE:
            return "MEd", False
        if lemma in RESULT:
            return "CE", False
        if lemma in CONDITIONAL:
            return "CndE", False
        if lemma in TEMPORAL:
            return "Tmp", False
        if lemma in LOCATIVE:
            return "Loc", False
        if lemma in COMPARATIVE:
            return "Cmp", False
        if lemma in HOTI:
            prev = segs[j - 1] if j > 0 else None
            if prev is not None and _has_lemma(prev, words, VERBA_DICENDI):
                return "FtIn", True   # content of saying/knowing
            return "Grnd", True       # causal ὅτι
        return None  # unknown subordinator → treated as a serial join, review
    return None


# ---------------------------------------------------------------------------
# Within-sentence assembly

class _Held:
    """A forward-attaching packet (protasis or sentence-initial dependent),
    waiting to become children[0] of its bracket at sentence end."""

    __slots__ = ("packet", "rel", "review")

    def __init__(self, packet: dict, rel: str, review: bool):
        self.packet = packet
        self.rel = rel
        self.review = review


def _assemble_sentence(indexed_segs: list[tuple[int, "Segment"]], words) -> dict:
    """Reduce one sentence's segments to a single packet (tree node)."""
    segs = [s for _, s in indexed_segs]
    stack: list[dict] = []
    held: _Held | None = None

    def join_target_edge(new: dict, rel: str, review: bool, sub: bool) -> None:
        """Right-edge join against the current target (stack top, else held)."""
        edge = _edge_sub if sub else _edge_coord
        if stack:
            stack.append(edge(stack.pop(), new, rel, review))
        elif held is not None:
            held.packet = edge(held.packet, new, rel, review)
        else:
            stack.append(new)

    for j, (gi, seg) in enumerate(indexed_segs):
        leaf = _prop_node(gi)
        op = seg.opener
        kind = op.kind if op is not None else None
        lemma = _opener_lemma(seg)
        fresh = not stack and held is None  # no clause yet in this sentence

        if kind == "sub_conj" and fresh and lemma in _PROTASIS_REL:
            # Sentence-initial conditional/temporal/comparative clause:
            # hold it, it attaches forward to the coming apodosis.
            held = _Held(leaf, _PROTASIS_REL[lemma], False)
            continue

        call = _dependent_call(seg, j, segs, words)
        if call is not None and not (kind == "coord"):
            rel, review = call
            if stack:
                top = stack.pop()
                stack.append(_sub(rel, top, leaf, dep_child=1, review=review))
            elif held is not None:
                held.packet = _sub(rel, held.packet, leaf, dep_child=1, review=review)
            else:
                # Sentence opens with a dependent unit (initial participle,
                # causal ὅτι, …): hold it forward like a protasis.
                held = _Held(leaf, rel, review)
            continue

        if kind == "coord" and not fresh:
            assert lemma is not None
            if lemma in GROUND or lemma in INFERENCE:
                # Postpositive γάρ/οὖν mid-sentence: relate the new clause to
                # the packet so far with the table relation.
                rel = "Grnd" if lemma in GROUND else "Inf"
                if stack:
                    if len(stack) > 1:
                        stack[:] = [_coord("Ser", stack, review=True)]
                    stack.append(_sub(rel, stack.pop(), leaf, dep_child=1))
                else:
                    assert held is not None
                    held.packet = _sub(rel, held.packet, leaf, dep_child=1)
            elif lemma in ADVERSATIVE:
                prev = segs[j - 1]
                confident = _has_lemma(prev, words, NEGATIVES)
                join_target_edge(leaf, "NegPos", not confident, sub=True)
            elif lemma in ALTERNATIVE:
                join_target_edge(leaf, "Alt", False, sub=False)
            elif lemma in DE:
                men_before = any(_has_lemma(s, words, MEN) for s in segs[:j])
                if men_before:
                    join_target_edge(leaf, "Alt", False, sub=False)
                else:
                    join_target_edge(leaf, "Ser", True, sub=False)
            else:
                # καί / οὐδέ / τε (and anything unrecognized): Series, review.
                join_target_edge(leaf, "Ser", True, sub=False)
            continue

        if call is None and kind == "sub_conj" and not fresh:
            # Unknown subordinator: keep the structure, flag the call.
            join_target_edge(leaf, "Ser", True, sub=False)
            continue

        # Independent clause: sentence-initial (any opener) or asyndeton.
        stack.append(leaf)

    main: dict | None = None
    if stack:
        main = stack[0] if len(stack) == 1 else _coord("Ser", stack, review=True)
    if held is not None and main is not None:
        return _sub(held.rel, held.packet, main, dep_child=0, review=held.review)
    if held is not None:
        return held.packet
    assert main is not None, "sentence produced no packet"
    return main


# ---------------------------------------------------------------------------
# Inter-sentence assembly

def _sentence_join(prev_segs: list, cur_segs: list, words) -> tuple[str, bool]:
    """(relationship, review) joining the accumulated packet to the new
    sentence. Ser/False is the deliberate dumb default."""
    first = cur_segs[0]
    lemma = _opener_lemma(first)
    conn = lemma if (lemma in _DISCOURSE and first.opener.kind == "coord") else None
    if conn is None:
        ws = _seg_words(first, words)[:3]
        for i, w in enumerate(ws):
            wl = _L(w.lemma)
            if i == 0 and wl in _DISCOURSE and wl not in _POSTPOSITIVE:
                conn = wl
                break
            if i >= 1 and wl in _POSTPOSITIVE:
                conn = wl
                break

    if conn is not None:
        if conn in GROUND:
            return "Grnd", False        # star on the supported (previous) side
        if conn in INFERENCE:
            return "Inf", False         # star on the new (inferred) side
        if conn in DE:
            prev_has_men = any(_has_lemma(s, words, MEN) for s in prev_segs)
            return ("Alt", False) if prev_has_men else ("Ser", True)
        if conn in ADVERSATIVE:
            return "NegPos", True
        if conn in ALTERNATIVE:
            return "Alt", False
        return "Ser", False             # bare καί chain: unflagged default

    # Speech content: previous sentence ends with a verbum dicendi + '·'.
    last_word = words[prev_segs[-1].end]
    if last_word.text.rstrip().endswith("·") and _L(last_word.lemma) in VERBA_DICENDI:
        return "FtIn", True
    return "Ser", False


def _fold_sentences(sentence_packets: list[tuple[dict, list]], words) -> dict:
    """Fold sentence packets left to right; consecutive Ser joins accumulate
    into one n-ary bracket, closed when a non-Ser join appears."""

    def close(nodes: list[dict], review: bool) -> dict:
        return nodes[0] if len(nodes) == 1 else _coord("Ser", nodes, review=review)

    group: list[dict] = [sentence_packets[0][0]]
    group_review = False
    prev_segs = sentence_packets[0][1]
    for packet, segs in sentence_packets[1:]:
        rel, review = _sentence_join(prev_segs, segs, words)
        if rel == "Ser":
            group.append(packet)
            group_review = group_review or review
        elif rel == "Alt":
            group = [_coord("Alt", [close(group, group_review), packet])]
            group_review = False
        else:
            group = [_sub(rel, close(group, group_review), packet,
                          dep_child=1, review=review)]
            group_review = False
        prev_segs = segs
    return close(group, group_review)


# ---------------------------------------------------------------------------
# Propositions & document

def _verse_letter(i: int) -> str:
    """0 → 'a', 25 → 'z', 26 → 'aa', … (bijective base 26)."""
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(97 + r) + s
    return s


def _propositions(segments: Sequence, words) -> list[dict]:
    verse_keys = []
    for seg in segments:
        w = words[seg.start]
        verse_keys.append((w.book, w.chapter, w.verse))
    counts = Counter(verse_keys)
    props: list[dict] = []
    seen: Counter = Counter()
    for i, seg in enumerate(segments):
        key = verse_keys[i]
        verse = str(key[2])
        label = verse if counts[key] == 1 else verse + _verse_letter(seen[key])
        seen[key] += 1
        props.append({
            "id": f"p{i + 1}",
            "label": label,
            "source": {"kind": "corpus", "start": seg.start, "end": seg.end},
        })
    return props


def _strip_private(node: dict) -> None:
    """Remove builder bookkeeping documents never carry: the ``_open`` edge
    marker and the classifier's internal ``review`` flags (confidence labeling
    is not part of the product)."""
    node.pop("_open", None)
    node.pop("flag", None)
    for child in node.get("children", ()):
        _strip_private(child)


def build_document(segments: list["Segment"]) -> dict:
    """Assemble the segments of one aligned passage into a validated analysis
    document."""
    if not segments:
        raise ValueError("build_document needs at least one segment")
    words = load_words()

    indexed = list(enumerate(segments))
    sentences: list[list[tuple[int, "Segment"]]] = []
    for gi, seg in indexed:
        if sentences and sentences[-1][-1][1].sentence == seg.sentence:
            sentences[-1].append((gi, seg))
        else:
            sentences.append([(gi, seg)])

    sentence_packets = [
        (_assemble_sentence(group, words), [s for _, s in group])
        for group in sentences
    ]
    tree = _fold_sentences(sentence_packets, words)
    _strip_private(tree)

    doc = {
        "schemaVersion": SCHEMA_VERSION,
        "propositions": _propositions(segments, words),
        # The first pass connects everything, so the forest has a single root;
        # disconnected roots only appear once the user edits (DESIGN.md §3).
        "forest": [tree],
    }
    validate_document(doc)  # a failure here is a builder bug — never ship it
    return doc
