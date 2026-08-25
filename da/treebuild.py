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
    target packet. Every bracket is BINARY, so a run of coordinate clauses
    nests to the LEFT — the packet built so far joins the clause that arrives
    next, exactly as connecting them by hand in the editor would.
    Postpositive γάρ/οὖν within a sentence relate the new clause to the whole
    packet so far with their table relation.
  * At sentence end leftover stack packets are wrapped as Ser (review).

Between sentences
  * Sentence packets fold left to right. The join comes from the new
    sentence's discourse connective (γάρ → Grnd, οὖν-class → Inf, δέ → Ser
    review, ἀλλά → NegPos review, ἤ → Alt, μέν…δέ → Alt); with none, a
    previous sentence ending in a verbum dicendi + '·' yields FtIn (speech
    content, review), and otherwise the deliberate dumb default: Ser,
    UNFLAGGED. A run of Ser-joined sentences nests to the left, one binary
    Ser bracket per join.

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
         review: bool = False, sure: bool = False) -> dict:
    """Subordinate bracket over [first, second]; ``dep_child`` says which child
    is the grammatically marked (dependent) side. ``reversed`` and
    ``prominent`` are derived so labels land on the right children. ``sure``
    marks a DETERMINISTIC call (see _confident_forest) — never shipped in the
    document, stripped with the rest of the private keys."""
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
    if sure:
        node["_sure"] = True
    return node


def _coord(rel: str, first: dict, second: dict, review: bool = False,
           sure: bool = False) -> dict:
    """Coordinate bracket over exactly [first, second]. Brackets are binary —
    a longer series is a left-nested chain of these (see _chain)."""
    node: dict = {"kind": "bracket", "rel": rel, "prominent": None,
                  "children": [first, second]}
    if review:
        node["flag"] = "review"
    if sure:
        node["_sure"] = True
    return node


def _chain(rel: str, nodes: Sequence[dict], review: bool = False) -> dict:
    """A run of coordinate members as a LEFT-nested chain of binary brackets:
    [a, b, c] → rel[ rel[a, b], c ]. One member is itself. Chains are always
    judgment calls (which members belong together is the guess), so they are
    never sure."""
    packet = nodes[0]
    for node in nodes[1:]:
        packet = _coord(rel, packet, node, review=review)
    return packet


def _edge_coord(node: dict, new: dict, rel: str, review: bool,
                sure: bool = False) -> dict:
    """Coordinate ``new`` at the right edge of ``node``: descend through
    subordinate brackets to their last child, else bracket the two. A further
    coordinate clause brackets THAT packet with the next one, so a run comes
    out left-nested and every bracket stays binary."""
    if node["kind"] == "bracket" and node["prominent"] is not None:
        node["children"][-1] = _edge_coord(node["children"][-1], new, rel,
                                           review, sure)
        return node
    return _coord(rel, node, new, review=review, sure=sure)


def _edge_sub(node: dict, new: dict, rel: str, review: bool,
              sure: bool = False) -> dict:
    """Subordinate-wrap ``new`` against the right-edge clause of ``node``
    (used for οὐ … ἀλλά, which contrasts with the negated clause)."""
    if node["kind"] == "bracket" and node["prominent"] is not None:
        node["children"][-1] = _edge_sub(node["children"][-1], new, rel,
                                         review, sure)
        return node
    return _sub(rel, node, new, dep_child=1, review=review, sure=sure)


# ---------------------------------------------------------------------------
# Segment inspection helpers (contract-typed: .start/.end/.sentence/.opener)

def _seg_words(seg, words) -> Sequence:
    return words[seg.start:seg.end + 1]


def _has_lemma(seg, words, lemmas: frozenset[str]) -> bool:
    return any(_L(w.lemma) in lemmas for w in _seg_words(seg, words))


def _opener_lemma(seg) -> str | None:
    return _L(seg.opener.lemma) if seg.opener is not None else None


# Prepositions whose article-infinitive sense the grammars fix outright:
# εἰς τό / πρὸς τό purpose, ἐν τῷ / μετὰ τό / πρὸ τοῦ time, διὰ τό cause.
_INF_PREP_REL: dict[str, tuple[str, bool]] = {
    _L("εἰς"): ("MEd", True),
    _L("πρός"): ("MEd", True),
    _L("ἐν"): ("Tmp", True),
    _L("μετά"): ("Tmp", True),
    _L("πρό"): ("Tmp", True),
    _L("διά"): ("Grnd", True),
}


def _dependent_call(seg, j: int, segs: Sequence, words) -> tuple[str, bool, bool] | None:
    """(relationship, review, sure) for a backward/forward-attaching dependent
    segment, or None if the segment is not a dependent unit. ``sure`` marks
    the calls the goldens have never contradicted AND the grammar forces —
    each entry's evidence is in the comment beside it."""
    op = seg.opener
    if op is None:
        return None
    lemma = _L(op.lemma)
    if op.kind == "rel":
        # The relative clause interprets its antecedent's clause: Ft → In*.
        # The RELATIONSHIP is what the diagrams agree on; what it attaches to
        # they do not. Eph 3:13 (TSA 3) splits διὸ αἰτοῦμαι from its infinitive
        # and hangs ἥτις on the infinitive alone, where stage 1 keeps the two
        # inline and hangs it on both — the same call, a coarser unit. Not
        # sure, therefore: confident mode may not draw a bracket whose
        # boundaries came from the tool's own segmentation guess.
        return "FtIn", False, False
    if op.kind == "appos":
        # Apposition / attributive-article phrase restates: Ft → In*.
        return "FtIn", True, False
    if op.kind == "pp":
        # Implicit-proposition prepositional phrase: guess by preposition.
        return _PP_REL.get(lemma, "WEd"), True, False
    if op.kind == "ptcp":
        # Adverbial participle: Way–End best guess, the participle side is W.
        # Not sure: the Acts diagram reads Ἀκούσαντες as Temporal where this
        # table says W/Ed — the participle's sense is contextual.
        return "WEd", True, False
    if op.kind == "inf":
        # Adverbial infinitive: a preposition + article pattern carries its
        # grammar-book sense (sure); anything else is best-guess purpose.
        ws = _seg_words(seg, words)
        if len(ws) >= 2 and ws[1].pos == "RA":
            mapped = _INF_PREP_REL.get(_L(ws[0].lemma))
            if mapped is not None:
                rel, sure = mapped
                return rel, not sure, sure
        return "MEd", False, False
    if op.kind == "sub_conj":
        if lemma in PURPOSE:
            # ἵνα: purpose vs. epexegetical is a reading — the Philippians
            # student takes the tool's M/Ed as Ft/In.
            return "MEd", False, False
        if lemma in RESULT:
            return "CE", False, True      # ὥστε: 2/2 exact (1 Thess)
        if lemma in CONDITIONAL:
            return "CndE", False, True    # ἐάν/εἰ: 2/2 exact (1 John)
        if lemma in TEMPORAL:
            return "Tmp", False, True     # explicit temporal subordinator
        if lemma in LOCATIVE:
            return "Loc", False, True     # explicit locative subordinator
        if lemma in COMPARATIVE:
            return "Cmp", False, True     # ὡς/ὥσπερ: 2/2 exact (1 Jn, Heb)
        if lemma in HOTI:
            prev = segs[j - 1] if j > 0 else None
            if prev is not None and _has_lemma(prev, words, VERBA_DICENDI):
                # Content of saying/knowing: 2/2 exact (1 John 5c-5d, 6a-6b).
                return "FtIn", False, True
            return "Grnd", True, False    # causal ὅτι: a reading
        return None  # unknown subordinator → treated as a serial join, review
    return None


# ---------------------------------------------------------------------------
# Within-sentence assembly

class _Held:
    """A forward-attaching packet (protasis or sentence-initial dependent),
    waiting to become children[0] of its bracket at sentence end."""

    __slots__ = ("packet", "rel", "review", "sure")

    def __init__(self, packet: dict, rel: str, review: bool, sure: bool = False):
        self.packet = packet
        self.rel = rel
        self.review = review
        self.sure = sure


def _assemble_sentence(indexed_segs: list[tuple[int, "Segment"]], words) -> dict:
    """Reduce one sentence's segments to a single packet (tree node)."""
    segs = [s for _, s in indexed_segs]
    stack: list[dict] = []
    held: _Held | None = None

    def join_target_edge(new: dict, rel: str, review: bool, sub: bool,
                         sure: bool = False) -> None:
        """Right-edge join against the current target (stack top, else held)."""
        edge = _edge_sub if sub else _edge_coord
        if stack:
            stack.append(edge(stack.pop(), new, rel, review, sure))
        elif held is not None:
            held.packet = edge(held.packet, new, rel, review, sure)
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
            # hold it, it attaches forward to the coming apodosis. The
            # relationship is the subordinator's own — sure.
            held = _Held(leaf, _PROTASIS_REL[lemma], False, sure=True)
            continue

        call = _dependent_call(seg, j, segs, words)
        if call is not None and not (kind == "coord"):
            rel, review, sure = call
            if kind == "rel" and sure:
                # A relative's RELATIONSHIP is sure; its SCOPE only sometimes.
                # The Eph 1:13-14 diagram tucks a trailing εἰς-phrase inside
                # the relative's packet where this builder wraps outside it,
                # and chained relatives (Eph 3:11-12) scope to the nearest
                # clause rather than the packet. Airtight only when the
                # relative CLOSES its sentence and pairs with a single bare
                # clause — nothing can extend or re-scope it after that.
                sure = (j == len(segs) - 1 and bool(stack)
                        and stack[-1]["kind"] == "prop")
            if stack:
                top = stack.pop()
                stack.append(_sub(rel, top, leaf, dep_child=1, review=review,
                                  sure=sure))
            elif held is not None:
                held.packet = _sub(rel, held.packet, leaf, dep_child=1,
                                   review=review, sure=sure)
            else:
                # Sentence opens with a dependent unit (initial participle,
                # causal ὅτι, …): hold it forward like a protasis. A
                # sentence-INITIAL ὥστε is the inferential construction (the
                # 1 Thess 4:18 diagram draws Ὥστε παρακαλεῖτε as ∴), not the
                # result clause the CE call is sure about — never sure here.
                held = _Held(leaf, rel, review, sure and rel != "CE")
            continue

        if kind == "coord" and not fresh:
            assert lemma is not None
            if lemma in GROUND or lemma in INFERENCE:
                # Postpositive γάρ/οὖν mid-sentence: relate the new clause to
                # the packet so far with the table relation. γάρ is sure
                # (4/4 exact across 1 Thess and Hebrews); οὖν is not — the
                # Acts diagram reads a μὲν οὖν as C/E where this says ∴.
                rel = "Grnd" if lemma in GROUND else "Inf"
                sure = lemma in GROUND
                if stack:
                    if len(stack) > 1:
                        stack[:] = [_chain("Ser", stack, review=True)]
                    stack.append(_sub(rel, stack.pop(), leaf, dep_child=1,
                                      sure=sure))
                else:
                    assert held is not None
                    held.packet = _sub(rel, held.packet, leaf, dep_child=1,
                                       sure=sure)
            elif lemma in ADVERSATIVE:
                # οὐ … ἀλλά is the textbook -/+ (1/1 exact, 1 Thess); a bare
                # ἀλλά is a judgment.
                prev = segs[j - 1]
                confident = _has_lemma(prev, words, NEGATIVES)
                join_target_edge(leaf, "NegPos", not confident, sub=True,
                                 sure=confident)
            elif lemma in ALTERNATIVE:
                join_target_edge(leaf, "Alt", False, sub=False, sure=True)
            elif lemma in DE:
                men_before = any(_has_lemma(s, words, MEN) for s in segs[:j])
                if men_before:
                    join_target_edge(leaf, "Alt", False, sub=False, sure=True)
                else:
                    join_target_edge(leaf, "Ser", True, sub=False)
            else:
                # καί / οὐδέ / τε (and anything unrecognized): Series, review —
                # never sure: the 1 John student hears one of these καί as ∴.
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
        main = _chain("Ser", stack, review=True)
    if held is not None and main is not None:
        return _sub(held.rel, held.packet, main, dep_child=0,
                    review=held.review, sure=held.sure)
    if held is not None:
        return held.packet
    assert main is not None, "sentence produced no packet"
    return main


# ---------------------------------------------------------------------------
# Inter-sentence assembly

def _sentence_join(prev_segs: list, cur_segs: list, words) -> tuple[str, bool, bool]:
    """(relationship, review, sure) joining the accumulated packet to the new
    sentence. Ser/False is the deliberate dumb default — and never sure."""
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
            # γάρ grounds what precedes: 4/4 exact (1 Thess ×2, Hebrews ×2).
            return "Grnd", False, True  # star on the supported (previous) side
        if conn in INFERENCE:
            # διό is sure — its sense is forced, and Eph 3:13 draws it
            # exactly. οὖν is not: the Acts diagram draws a μὲν οὖν as C/E.
            return "Inf", False, conn == _L("διό")
        if conn in DE:
            prev_has_men = any(_has_lemma(s, words, MEN) for s in prev_segs)
            return ("Alt", False, True) if prev_has_men else ("Ser", True, False)
        if conn in ADVERSATIVE:
            return "NegPos", True, False
        if conn in ALTERNATIVE:
            return "Alt", False, True
        return "Ser", False, False      # bare καί chain: unflagged default

    # Speech content: previous sentence ends with a verbum dicendi + '·'.
    # Not sure: the Acts diagram frames its speeches as S/R and Ft/In by turn.
    last_word = words[prev_segs[-1].end]
    if last_word.text.rstrip().endswith("·") and _L(last_word.lemma) in VERBA_DICENDI:
        return "FtIn", True, False
    return "Ser", False, False


def _fold_sentences(sentence_packets: list[tuple[dict, list]], words) -> dict:
    """Fold sentence packets left to right; a run of Ser joins becomes a
    left-nested chain of binary Ser brackets, closed when a non-Ser join
    appears."""

    def close(nodes: list[dict], review: bool) -> dict:
        return _chain("Ser", nodes, review=review)

    group: list[dict] = [sentence_packets[0][0]]
    group_review = False
    prev_segs = sentence_packets[0][1]
    for packet, segs in sentence_packets[1:]:
        rel, review, sure = _sentence_join(prev_segs, segs, words)
        if rel == "Ser":
            group.append(packet)
            group_review = group_review or review
        elif rel == "Alt":
            group = [_coord("Alt", close(group, group_review), packet,
                            sure=sure)]
            group_review = False
        else:
            group = [_sub(rel, close(group, group_review), packet,
                          dep_child=1, review=review, sure=sure)]
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
    """One proposition per segment, labeled exactly as the editor re-derives
    labels on split/merge (relabelCorpusInTransaction): a segment within one
    verse is labeled by the verse, lettered (11a, 11b, …) when the verse holds
    several; a segment spanning verses is labeled by its span ("10–12",
    "1:28–2:3" across chapters) and never consumes a letter."""
    keyed: list[tuple[object, str]] = []
    counts: Counter = Counter()
    for seg in segments:
        first, last = words[seg.start], words[seg.end]
        if (first.book, first.chapter, first.verse) == (last.book, last.chapter, last.verse):
            key = (first.book, first.chapter, first.verse)
            label = str(first.verse)
            counts[key] += 1
        elif (first.book, first.chapter) == (last.book, last.chapter):
            key, label = None, f"{first.verse}–{last.verse}"
        else:
            key, label = None, f"{first.chapter}:{first.verse}–{last.chapter}:{last.verse}"
        keyed.append((key, label))

    seen: Counter = Counter()
    props: list[dict] = []
    for i, (seg, (key, label)) in enumerate(zip(segments, keyed)):
        if key is not None and counts[key] > 1:
            label += _verse_letter(seen[key])
            seen[key] += 1
        props.append({
            "id": f"p{i + 1}",
            "label": label,
            "source": {"kind": "corpus", "start": seg.start, "end": seg.end},
        })
    return props


def _strip_private(node: dict) -> None:
    """Remove builder bookkeeping documents never carry: the classifier's
    internal ``review`` flags (confidence labeling is not part of the
    product) and the ``_sure`` marks the confident mode prunes by."""
    node.pop("flag", None)
    node.pop("_sure", None)
    for child in node.get("children", ()):
        _strip_private(child)


def _confident_forest(tree: dict) -> list[dict]:
    """The maximal all-sure subtrees of ``tree``, in document order — the
    connections the classifier is DETERMINISTICALLY right about, with
    everything else dissolved back into its pieces for the analyst.

    A bracket survives only if its own call is sure AND every bracket under
    it survives: a sure relationship over an uncertain sub-grouping is an
    uncertain bracket (the children it pairs are themselves a guess)."""
    def keepable(node: dict) -> bool:
        if node["kind"] == "prop":
            return True
        return bool(node.get("_sure")) and all(
            keepable(child) for child in node["children"])

    out: list[dict] = []

    def walk(node: dict) -> None:
        if keepable(node):
            out.append(node)
        else:
            for child in node["children"]:
                walk(child)

    walk(tree)
    return out


def build_document(segments: list["Segment"], *,
                   confident_only: bool = False) -> dict:
    """Assemble the segments of one aligned passage into a validated analysis
    document. With ``confident_only`` the forest keeps only the maximal
    all-sure subtrees (see :func:`_confident_forest`) — the joins the goldens
    have never contradicted — and leaves everything else disconnected for the
    analyst."""
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
    # Confident mode keeps only what is deterministically right; the full
    # mode connects everything into a single root.
    forest = _confident_forest(tree) if confident_only else [tree]
    for root in forest:
        _strip_private(root)

    doc = {
        "schemaVersion": SCHEMA_VERSION,
        "propositions": _propositions(segments, words),
        "forest": forest,
    }
    validate_document(doc)  # a failure here is a builder bug — never ship it
    return doc
