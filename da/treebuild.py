"""Stage 2 of the first pass: tree construction + classification.

Input: the ordered ``Segment`` list produced by :mod:`da.segmentation` (stage 1),
which exactly tiles an inclusive corpus range. Output: a complete, valid
analysis document (see docs/DESIGN.md §3, §5) — every proposition connected
into one tree (a ``forest`` of one root), every bracket labeled with a
taxonomy relationship. Confidence labeling is not part of the product, so no
bracket this module builds ever carries a ``flag`` (the document schema still
accepts one — review flags an ANALYST sets in the editor are a different
thing, and never pass through the builder).

TIERING (the DA expert's ruling, 2026 re-tier). Every join carries an internal
``_sure`` flag, and ``_sure`` means exactly one thing: **this join belongs in
the minimal analysis**. That covers two kinds of call, not one —

  * calls the GRAMMAR FORCES (an explicit subordinator, οὐ … ἀλλά, μέν … δέ);
  * SENSIBLE DEFAULTS: readings a competent analyst would start from and that
    the rule is right about roughly 80%+ of the time (δέ → Series, ἵνα →
    purpose, causal ὅτι → Ground, an aorist participle before its clause →
    Temporal, asyndeton → Series).

A default that is usually right is worth drawing: the analyst re-labels one
bracket, which is cheaper than drawing the whole structure by hand. Only
GENUINELY UNDECIDABLE joins stay out of minimal — a bare ἀλλά, an apposition,
an implicit-proposition prepositional phrase, an unknown subordinator, and the
speculative groupings (which clauses of a run belong together).

The public contract is unchanged: ``build_document(confident_only=True)`` (the
"minimal" level, API ``maximal=false``) keeps only the maximal all-sure
subtrees via :func:`_confident_forest` and dissolves everything else into
disconnected roots; Full still connects everything into exactly one tree.
``_sure`` itself is private bookkeeping and is stripped before returning.

THE ENGLISH-CUE LAYER (docs/english-cue-rules.md). Greek connectives and
adverbial participles are systematically ambiguous, but the aligned BSB
English says which sense the context carries — the translators already did the
interpretive work. For the ambiguous triggers (ὅτι, adverbial participles,
ὥστε + finite verb, ἵνα/ὅπως, ὡς) the segment's own English is assembled in
BSB word order by :func:`segment_english` and its LEADING phrase matched by
:func:`leading_cue`; a hit outranks the grammar-only default. Cue-derived
calls are ``sure``: a translator's reading is exactly the "sensible default"
tier — right far more often than not, and one bracket to re-label when it is
not. Grammar-FORCED calls still outrank the cue (καίπερ, genitive absolute,
future participle, λέγων), and a segment with no usable English falls back to
the grammar-only rules unchanged.

Assembly is a deterministic shift-reduce pass:

Within a sentence
  * A stack holds clause packets. A backward-attaching dependent segment
    (ὅτι/ἵνα-class subordinator, relative, adverbial participle or infinitive)
    pops the top packet and wraps ``[top, dependent]`` — chained trailing
    dependents therefore nest naturally.
  * ANY dependent standing before the sentence's first independent clause is
    HELD and attaches forward — a conditional/temporal/comparative protasis, a
    sentence-initial ὡς or ὅπου, an opening participle, a causal ὅτι — through
    the same :func:`_dependent_call` as a trailing dependent, which is passed
    ``precedes=True`` and narrows its reading accordingly. The held packet
    becomes ``children[0]`` of the sentence's bracket once the apodosis / main
    clause completes at sentence end (a hold that never gets one is returned as
    its bare packet — expert-questions.md Open #14). Dependents and
    coordinations arriving while a packet is held build onto it.
  * Coordinate joins (καί/οὐδέ/τε, ἤ, δέ) coordinate at the right edge of the
    target packet. Every bracket is BINARY, so a run of coordinate clauses
    nests to the LEFT — the packet built so far joins the clause that arrives
    next, exactly as connecting them by hand in the editor would.
    Postpositive γάρ/οὖν within a sentence relate the new clause to the whole
    packet so far with their table relation.
  * Adverbial participles run through :func:`_participle_call`, the
    Wallace/Keating chart in docs/participle-rules.md as an ordered rule list.
  * At sentence end leftover stack packets are wrapped as Ser (not sure —
    which asyndetic clauses of a run belong together is a guess).

Between sentences
  * Sentence packets fold left to right. The join comes from the new
    sentence's discourse connective (γάρ → Grnd, οὖν-class → Inf, δέ → Ser,
    ἀλλά → NegPos (never sure), ἤ → Alt, μέν…δέ → Alt); with none, a previous
    sentence ending in a verbum dicendi + '·' yields FtIn (speech content),
    and otherwise the default: Ser. A run of Ser-joined sentences nests to the
    left, one binary Ser bracket per join.

Across sections (SECTIONING, docs/sectioning.md — big–small–big)
  * That sentence fold does not run over the whole passage. The expert's
    ruling is to chunk the passage into its major logical SECTIONS first,
    connect sentence-to-sentence WITHIN each section, and only then connect
    the sections to each other. A section is a run of WHOLE sentences, so
    within-sentence assembly is untouched.
  * Seams come from a weighted indicator table (:data:`SEAM_WEIGHTS`) read off
    the BSB structure marks (:mod:`da.corpus.structure`): headings and
    quotation bounds are hard, paragraph breaks and οὖν strong. The speech
    verb rides with its speech — a seam before a quotation falls BEFORE the
    dicendi sentence that introduces it, never between the two.
  * One structure-dependent seam is added after the within-section fold: a
    sentence-level γάρ Ground whose support develops (a coordinate or a
    Fact–Interpretation inside it) is section-sized and gets promoted to its
    own section (:func:`_promoted`).
  * The section packets then fold left to right through the SAME
    :func:`_sentence_join` table, the new section's first sentence deciding
    the relationship. Section joins carry their normal tiers; a within-section
    sure join is unaffected — but a within-fold join can never span a seam,
    which is what gives the minimal analysis its section-respecting shape.

Star placement is derived from the taxonomy: for each relationship we know
which label index the grammatically marked (dependent) side carries;
``reversed`` is set whenever that side is not ``children[0]``'s default, and
``prominent`` is the child that ends up carrying the starred label.

``segmentation.py`` is developed concurrently; this module codes against the
SEGMENT CONTRACT (``Segment``/``Opener`` attribute shapes) and only imports it
for type checking.
"""

from __future__ import annotations

from collections import Counter
from typing import (TYPE_CHECKING, Callable, Iterable, Mapping, NamedTuple,
                    Sequence)

from .corpus import english_for, english_order, load_words
from .corpus.loader import TRAILING_CLOSERS
from .corpus.normalize import nfc as _L, nfc_set as _lset
from .corpus.structure import marks_for
from .corpus.translation import load_translation
from .documents import SCHEMA_VERSION, validate_document
from .taxonomy import COORDINATE_CODES, RELATIONSHIPS

if TYPE_CHECKING:  # pragma: no cover — written concurrently, contract-typed
    from .segmentation import Segment


# ---------------------------------------------------------------------------
# Lemma tables (our own compilation from standard grammar — see DESIGN.md §5).
# ``_L``/``_lset`` are :mod:`da.corpus.normalize`'s ``nfc``/``nfc_set``, shared
# with da.segmentation's tables.

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
# The two negation families, kept apart: the causal participle is the one that
# takes οὐ (chart rule 6), so μή in the segment cancels the reading.
OU_NEGATIVES = _lset("οὐ", "οὐχί", "οὐκέτι", "οὔπω", "οὐδέ", "οὐδείς", "οὔτε")
MH_NEGATIVES = _lset("μή", "μηδέ", "μηδείς", "μήτε", "μηκέτι", "μήπω", "μήποτε")

# Concessive particles that make a participle's concession explicit
# (participle-rules.md rule 1).
CONCESSIVE_PARTICLES = _lset("καίπερ", "καίτοιγε", "καίτοι")

# Verbs of saying / perceiving / knowing that take ὅτι-content (Ft/In).
VERBA_DICENDI = _lset(
    "λέγω", "εἶπον", "φημί", "ἀκούω", "οἶδα", "γινώσκω", "πιστεύω",
    "ὁμολογέω", "μαρτυρέω", "γράφω", "ἀποκρίνομαι", "βλέπω", "ὁράω",
    "θεωρέω", "ἀναγγέλλω", "ἀπαγγέλλω", "λαλέω",
)

# Verbs of asking / praying / exhorting. After one of these, a following ἵνα
# clause states the CONTENT of the request (Ft/In) rather than its purpose
# (M/Ed) — the expert's ἵνα conditional rule.
# DRAFT: this lemma list is our first cut and is awaiting expert review;
# widening it (κελεύω, ἐπιτάσσω, διαμαρτύρομαι, θέλω …) is the open question.
ASKING_VERBS = _lset(
    "ἐρωτάω", "αἰτέω", "παρακαλέω", "δέομαι", "προσεύχομαι", "εὔχομαι",
    "ἀξιόω",
)

# The redundant participle of saying (λέγων / λέγοντες) — chart rule 4.
LEGO = _L("λέγω")

# Implicit-proposition prepositional phrases: best-guess relation by
# preposition — these are the interpretive calls, never sure. Distinct from
# :data:`_INF_PREP_REL`, which is not a guess: there the grammars fix the sense
# of the preposition + article + infinitive construction outright.
_PP_REL: dict[str, str] = (
    {_L(p): "MEd" for p in ("εἰς", "πρός")}          # purpose/goal
    | {_L(p): "Tmp" for p in ("ἕως", "ἄχρι", "μέχρι", "πρό", "μετά")}
    | {_L(p): "Loc" for p in ("ἐν", "ἐπί", "ὑπό", "παρά")}
    | {_L(p): "Grnd" for p in ("διά", "ἐκ", "ἀπό", "χάριν", "ἕνεκα")}
)
# (A "πρὸ" key with the GRAVE accent used to sit in the Loc row: dead, since no
# MorphGNT lemma carries a grave — πρό with the tonos is mapped Tmp above.)

# Which label index the grammatically marked (dependent) side carries, per
# relationship: e.g. a γάρ clause is the "G" end (labels index 1), a protasis
# the "C?" end (labels index 0), a ὡς clause the "//" end (labels index 0).
_DEP_LABEL: dict[str, int] = {
    "Grnd": 1, "Inf": 1, "MEd": 1, "CE": 1, "FtIn": 1, "NegPos": 1,
    "CndE": 0, "Tmp": 0, "Loc": 0, "Cmp": 0, "WEd": 0, "Adv": 0,
}

# Discourse connectives recognized at sentence starts (inter-sentence joins).
_DISCOURSE = GROUND | INFERENCE | DE | ADVERSATIVE | ALTERNATIVE | SERIAL
# Postpositives may sit second or third in the sentence; the serial/adversative
# connectives only count in first position (καί later in a clause is adverbial
# "also", ἤ later is comparative "than").
# CROSS-REFERENCE: this is DELIBERATELY NARROWER than
# :data:`da.segmentation.POSTPOSITIVES`, which also lists μέν/τε/μέντοι.
# Segmentation asks "where does this connective's clause start?" and every
# postpositive shifts that boundary; here the question is "does this word name
# the join into the sentence?", which μέν/τε/μέντοι do not. Do not merge them.
_POSTPOSITIVE = GROUND | DE | _lset("οὖν", "ἄρα", "τοίνυν")


# ---------------------------------------------------------------------------
# The English-cue layer (docs/english-cue-rules.md)
#
# The BSB interlinear gives every corpus word its contextual English
# (``english_for``) and that word's place in the BSB's own word order
# (``english_order``). Assembling a segment's cells in BSB order reconstructs
# the phrase the translators wrote for it, and its LEADING words name the sense
# they read into the Greek: "if …" is a condition, "because …" a ground,
# "although …" a concession. That is the disambiguation this layer performs.

def _means_by(english: str) -> bool:
    """"by" is only the Means cue in front of a gerund ("by following …"); "by
    the word of the Lord" is an agent/instrument phrase, not a relationship."""
    tokens = english.split()
    return len(tokens) >= 2 and tokens[1].endswith("ing")


# Leading cue phrase → relationship, plus an optional GUARD: a predicate on the
# whole leading English that the phrase must also satisfy to count as a cue.
# Most rows need none (``None``), and a row that does keeps its condition here
# in the table rather than as a special case inside the matcher.
#
# Matched LONGEST FIRST (the table is sorted by phrase length below) and
# anchored both at the start of the English and at a WORD BOUNDARY — which is
# what the design's trailing spaces encode: "for " must not fire on "forgive",
# "as " not on "ashamed", "by " not on "byword".
_Guard = Callable[[str], bool]
_CUE_ENTRIES: tuple[tuple[str, str, _Guard | None], ...] = (
    ("if", "CndE", None),
    ("unless", "CndE", None),
    ("in order to", "MEd", None),
    ("in order that", "MEd", None),
    ("with the result", "CE", None),
    ("so as to", "CE", None),
    ("as a result", "CE", None),
    # "so that" is the one PER-TRIGGER phrase: C/E for ὥστε (the table's own
    # reading), M/Ed for ἵνα/ὅπως — see _PURPOSE_CUE_OVERRIDES.
    ("so that", "CE", None),
    ("because", "Grnd", None),
    ("since", "Grnd", None),
    ("for", "Grnd", None),
    ("therefore", "Inf", None),
    ("so then", "Inf", None),
    ("although", "Adv", None),
    ("even though", "Adv", None),
    ("though", "Adv", None),
    ("despite", "Adv", None),
    ("when", "Tmp", None),
    ("as soon as", "Tmp", None),   # unambiguously temporal; beats the bare "as"
    ("whenever", "Tmp", None),
    ("while", "Tmp", None),
    ("after", "Tmp", None),
    ("before", "Tmp", None),
    ("until", "Tmp", None),
    ("where", "Loc", None),
    ("wherever", "Loc", None),
    # The one guarded row: "by" names Means only in front of a gerund.
    ("by", "WEd", _means_by),
    ("just as", "Cmp", None),
    ("as", "Cmp", None),
    ("that", "FtIn", None),
    ("and", "Ser", None),
    ("also", "Ser", None),
    ("now", "Ser", None),
    # NO CONTRASTIVE ROWS. The BSB's "but"/"yet" would be easy to spot, but
    # spotting it buys nothing: οὐ … ἀλλά is already a sure Neg/Pos from the
    # grammar, and a bare "but" (bare ἀλλά, or δέ rendered "but") says there is
    # a contrast without saying WHICH contrary relationship carries it
    # (Neg/Pos, Alternative, Adversative). That is expert-questions.md Open #1;
    # until it is ruled, δέ keeps its Series default and a bare ἀλλά stays out
    # of minimal, so a "but" row would only ever be matched and discarded.
)
_CUE_TABLE: tuple[tuple[str, str, _Guard | None], ...] = tuple(
    sorted(_CUE_ENTRIES, key=lambda entry: -len(entry[0])))

# ἵνα/ὅπως read "so that" as purpose, not result.
_PURPOSE_CUE_OVERRIDES: Mapping[str, str] = {"so that": "MEd"}

# The cue table qualifies its bare "as " as the COMPARATIVE "as", which is what
# it is in front of a finite clause the Greek marked with ὡς ("as He is in the
# light"). In front of a participle it is the temporal "as" — "as Jesus was
# walking beside the sea", "as they were coming down the mountain" — and
# reading those 75 corpus participles as comparisons would be plainly wrong.
# "just as" is unaffected: that one really is the comparative.
_PTCP_CUE_OVERRIDES: Mapping[str, str] = {"as": "Tmp"}

# Which relationships each trigger will accept from a cue. A cue outside its
# trigger's set is simply no cue — e.g. the "and" opening a ἵνα clause says
# nothing about purpose vs content, so the verb-list rule still decides.
_HOTI_CUE_RELS = frozenset({"FtIn", "Grnd"})
_PURPOSE_CUE_RELS = frozenset({"FtIn", "MEd"})
_RESULT_CUE_RELS = frozenset({"CE", "Inf"})
_HOS_CUE_RELS = frozenset({"Cmp", "Tmp", "FtIn"})
# … minus the content sense when the ὡς clause PRECEDES its main clause: the
# "that …" use follows the verb that governs it, so a leading ὡς is only ever
# the comparative or the temporal one.
_HOS_PRECEDING_CUE_RELS = _HOS_CUE_RELS - {"FtIn"}
# The adverbial-participle senses the chart itself distinguishes; Series
# (attendant circumstance) is deliberately absent — an "and" is not evidence
# for it, and rule 7 already owns that call.
_PTCP_CUE_RELS = frozenset({"CndE", "MEd", "CE", "Grnd", "Adv", "Tmp",
                            "WEd", "Cmp"})

HOS = _L("ὡς")   # the one comparative the cue layer disambiguates


_BRACKETS = {ord(c): " " for c in "[]{}"}


def _clean_english(text: str) -> str:
    """One BSB cell, normalized for matching: lowercased, whitespace collapsed,
    and the translators' supplied-word markers removed while KEEPING their
    text — "[if]" is a cue, "{do} not" is "do not". A cell with no letters or
    digits is dropped: the BSB writes ". . ." where a word's English lives in a
    neighbouring cell, and those markers carry no cue."""
    stripped = text.translate(_BRACKETS)
    if not any(ch.isalnum() for ch in stripped):
        return ""
    return " ".join(stripped.split()).lower()


def segment_english(seg, words=None) -> str:
    """The segment's BSB English, assembled in BSB WORD ORDER.

    English word order differs from Greek, so the cells are sorted by their
    ``english_order`` key before joining. Those keys are the upstream table's
    global row numbers and are only comparable WITHIN one verse, so the words
    are grouped by verse, each group sorted, and the groups concatenated in
    corpus order (a segment rarely crosses a verse boundary, but some do).
    Unaligned words (≈0.4%) simply contribute nothing."""
    if words is None:
        words = load_words()
    groups: dict[tuple[int, int, int], list[tuple[int, str]]] = {}
    verses: list[tuple[int, int, int]] = []
    for i in range(seg.start, seg.end + 1):
        w = words[i]
        verse = (w.book, w.chapter, w.verse)
        if verse not in groups:
            groups[verse] = []
            verses.append(verse)
        text, rank = english_for(i), english_order(i)
        if not text or rank is None:
            continue
        cell = _clean_english(text)
        if cell:
            groups[verse].append((rank, cell))
    return " ".join(cell for verse in verses
                    for _, cell in sorted(groups[verse]))


def opener_english(seg) -> str:
    """The English of the segment's OPENER WORD alone — the connective's own
    cell. For a single-word connective (δέ, καί, ὡς, ἐάν) the BSB's reading may
    sit there while the segment's assembled English starts elsewhere: 1 John
    1:7 ἐὰν δέ reads "but if we walk …", whose leading word is the δέ's "but"
    and whose ἐάν cell is the "if"."""
    if seg.opener is None:
        return ""
    return _clean_english(english_for(seg.opener.index) or "")


def leading_cue(english: str,
                overrides: Mapping[str, str] | None = None) -> str | None:
    """The relationship the LEADING English phrase names, or None.

    Leading-anchored and longest-phrase-first, so "in order to …" reads as
    Means–End rather than as its shorter prefixes, and "as a result …" as
    Cause–Effect rather than as the comparative "as". ``overrides`` remaps
    individual phrases for one trigger (ἵνα's "so that")."""
    if not english:
        return None
    haystack = english + " "
    for phrase, rel, guard in _CUE_TABLE:
        if not haystack.startswith(phrase + " "):
            continue
        if guard is not None and not guard(haystack):
            continue
        if overrides is not None and phrase in overrides:
            return overrides[phrase]
        return rel
    return None


def _cue_call(seg, words, allowed: frozenset[str],
              overrides: Mapping[str, str] | None = None) -> str | None:
    """The cue relationship for one segment, restricted to the senses its
    trigger can carry. The segment's assembled English is asked first; the
    opener word's own cell is the fallback probe (see :func:`opener_english`)."""
    for english in (segment_english(seg, words), opener_english(seg)):
        rel = leading_cue(english, overrides)
        if rel is not None and rel in allowed:
            return rel
    return None


# ---------------------------------------------------------------------------
# Node construction

def _prop_node(global_index: int) -> dict:
    return {"kind": "prop", "ref": f"p{global_index + 1}"}


def _sub(rel: str, first: dict, second: dict, dep_child: int,
         sure: bool = False) -> dict:
    """Subordinate bracket over [first, second]; ``dep_child`` says which child
    is the grammatically marked (dependent) side. ``reversed`` and
    ``prominent`` are derived so labels land on the right children. ``sure``
    marks a call that JOINS THE MINIMAL ANALYSIS (see _confident_forest) —
    never shipped in the document, stripped with the rest of the private
    keys."""
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
    if sure:
        node["_sure"] = True
    return node


def _coord(rel: str, first: dict, second: dict, sure: bool = False) -> dict:
    """Coordinate bracket over exactly [first, second]. Brackets are binary —
    a longer series is a left-nested chain of these (see _chain)."""
    node: dict = {"kind": "bracket", "rel": rel, "prominent": None,
                  "children": [first, second]}
    if sure:
        node["_sure"] = True
    return node


def _chain(rel: str, nodes: Sequence[dict],
           sures: Sequence[bool] | None = None) -> dict:
    """A run of coordinate members as a LEFT-nested chain of binary brackets:
    [a, b, c] → rel[ rel[a, b], c ]. One member is itself.

    Each bracket carries the sureness of the JOIN that added its right-hand
    member — ``sures[k]`` for ``nodes[k]``, the first entry unused — so a mixed
    run keeps its confident brackets. With no ``sures`` nothing is sure, which
    is what the within-sentence asyndetic chains want: which members of a run
    belong together is the speculative call."""
    packet = nodes[0]
    for k, node in enumerate(nodes[1:], start=1):
        packet = _coord(rel, packet, node,
                        sure=bool(sures[k]) if sures is not None else False)
    return packet


def _dep_bracket(rel: str, first: dict, second: dict, sure: bool,
                 dep_child: int = 1) -> dict:
    """Bracket a dependent against its host. Coordinate relationships (the
    attendant-circumstance participle's Series, a καί/δέ join) bracket from the
    centre; everything else subordinates the dependent side, which is
    ``dep_child`` — child 1 for a dependent that ARRIVES (attaching backward or
    at an edge), child 0 for a held one closing against its main clause. This
    one COORDINATE_CODES test is the single place the sub/coord choice is
    made."""
    if rel in COORDINATE_CODES:
        return _coord(rel, first, second, sure=sure)
    return _sub(rel, first, second, dep_child=dep_child, sure=sure)


def _edge_join(node: dict, new: dict, rel: str, sure: bool = False) -> dict:
    """Join ``new`` at the right edge of ``node``: descend through subordinate
    brackets to their last child, then bracket the two — coordinately when
    ``rel`` is a coordinate relationship, else subordinating ``new`` (which is
    what οὐ … ἀλλά wants: it contrasts with the negated clause). A further
    coordinate clause brackets THAT packet with the next one, so a run comes
    out left-nested and every bracket stays binary."""
    if node["kind"] == "bracket" and node["prominent"] is not None:
        node["children"][-1] = _edge_join(node["children"][-1], new, rel, sure)
        return node
    return _dep_bracket(rel, node, new, sure)


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
# Every entry is grammar-forced, hence sure — unlike :data:`_PP_REL`, whose
# entries are best guesses about an IMPLIED proposition and never sure.
_INF_PREP_REL: dict[str, str] = {
    _L("εἰς"): "MEd",
    _L("πρός"): "MEd",
    _L("ἐν"): "Tmp",
    _L("μετά"): "Tmp",
    _L("πρό"): "Tmp",
    _L("διά"): "Grnd",
}


def _segment_participle(seg, words):
    """The adverbial participle a ``ptcp`` segment opened with."""
    op = seg.opener
    if op is not None and 0 <= op.index < len(words) and words[op.index].is_participle:
        return words[op.index]
    for w in _seg_words(seg, words):
        if w.is_participle:
            return w
    return None


def _genitive_absolute(seg, words, ptcp) -> bool:
    """Genitive participle with its own genitive subject standing beside it —
    ``Ταῦτα αὐτοῦ λαλοῦντος αὐτοῖς`` (Matt 9:18). The subject agrees with the
    participle in number and gender, is not governed by a preposition, and
    stands within a few words of it."""
    if ptcp.case != "G":
        return False
    ws = _seg_words(seg, words)
    for k, w in enumerate(ws):
        if w.index == ptcp.index or w.case != "G":
            continue
        # Nouns, pronouns (RP αὐτοῦ, RD τούτου), articles, adjectives. NB
        # MorphGNT's "P-" is the PREPOSITION tag, not a pronoun one.
        if w.pos not in ("N-", "RP", "RD", "RA", "A-"):
            continue
        if abs(w.index - ptcp.index) > 4:
            continue
        if k > 0 and ws[k - 1].pos == "P-":
            continue                      # a preposition governs it
        if w.number == ptcp.number and w.gender == ptcp.gender:
            return True
    return False


def _main_verb(seg, segs: Sequence, precedes: bool, words):
    """The finite verb of the clause a dependent segment attaches to: the next
    one in the sentence when the segment precedes its clause, the nearest
    preceding one when it follows."""
    if precedes:
        span = range(seg.end + 1, segs[-1].end + 1)
    else:
        span = range(seg.start - 1, segs[0].start - 1, -1)
    for i in span:
        if words[i].is_finite_verb:
            return words[i]
    return None


def _closes_on_raised_dot(word) -> bool:
    """Does this word carry the raised dot (·) that opens a quotation? The
    apparatus sigla that can trail the punctuation are stripped first — the
    same closers :attr:`Word.ends_sentence` strips."""
    return word.text.rstrip().rstrip(TRAILING_CLOSERS).endswith("·")


def _introduces_speech(seg, j: int, segs: Sequence, words) -> bool:
    """The clause this participle rides with opens direct or indirect speech:
    it closes on the raised dot that starts a quotation, or the next segment
    is its ὅτι-content."""
    if _closes_on_raised_dot(words[seg.end]):
        return True
    nxt = segs[j + 1] if j + 1 < len(segs) else None
    return (nxt is not None and nxt.opener is not None
            and nxt.opener.kind == "sub_conj" and _L(nxt.opener.lemma) in HOTI)


def _participle_call(seg, j: int, segs: Sequence, words,
                     precedes: bool) -> tuple[str, bool]:
    """(relationship, sure) for an adverbial participle segment.

    This is docs/participle-rules.md — the Wallace/Keating chart reduced to
    testable conditions — in precedence order. Every tier joins the minimal
    analysis: the expert's ruling is that a reading right ~80% of the time is
    worth drawing, since re-labelling one bracket beats drawing the structure
    by hand. ``precedes`` is the segment's position relative to the clause it
    attaches to in the shift-reduce pass (held/forward-attaching = precedes;
    attaching backward to the stack top = follows)."""
    ptcp = _segment_participle(seg, words)
    # A ``ptcp`` segment always has one: the opener word itself, or the first
    # participle in the segment (:func:`_segment_participle`).
    assert ptcp is not None, "ptcp segment with no participle"
    tense = ptcp.tense
    lemmas = {_L(w.lemma) for w in _seg_words(seg, words)}

    # 1. καίπερ / καίτοιγε — the particle makes the concession explicit.
    if lemmas & CONCESSIVE_PARTICLES:
        return "Adv", True
    # 2. Genitive absolute: "always adverbial and usually translated as
    #    temporal" — the expert put the usual reading in the default tier.
    if precedes and _genitive_absolute(seg, words, ptcp):
        return "Tmp", True
    # 3. "Future adverbial participles always belong here" (purpose).
    if tense == "F":
        return "MEd", True
    # 4. The redundant participle of saying (λέγων / λέγοντες) introducing
    #    speech. It rides with its dicendi clause as the WAY the saying
    #    happened (W on the participle, star on the clause); the Ft/In over
    #    the speech CONTENT is the dicendi machinery's own join (the
    #    ὅτι-content rule within a sentence, ``_sentence_join``'s verbum
    #    dicendi + '·' rule across one) — so this branch deliberately does not
    #    bracket the speech a second time.
    if _L(ptcp.lemma) == LEGO and tense == "P" and _introduces_speech(seg, j, segs, words):
        return "WEd", True
    # 4b. THE ENGLISH CUE. Rules 1–4 above are grammar-forced and outrank it;
    #     rules 5–11 below are tense/position DEFAULTS, and a translator who
    #     wrote "although …" or "because …" has read this participle's sense in
    #     context — better evidence than its tense. Sure, like every other tier.
    cue = _cue_call(seg, words, _PTCP_CUE_RELS, _PTCP_CUE_OVERRIDES)
    if cue is not None:
        return cue, True
    # 5. "Adverbial perfect participles almost always belong here" (cause).
    if tense == "X":
        return "Grnd", True
    # 6. "The causal participle will often use οὐ when negated."
    if (lemmas & OU_NEGATIVES) and not (lemmas & MH_NEGATIVES):
        return "Grnd", True
    # 7. Attendant circumstance — the chart's five-feature test, "90% of the
    #    time": aorist participle before an aorist imperative/indicative main
    #    verb. Coordinate, so the two actions stand side by side. (The main
    #    verb is looked up only here, inside the guard: no other rule reads it.)
    if precedes and tense == "A":
        main = _main_verb(seg, segs, precedes, words)
        if main is not None and main.tense == "A" and main.mood in "ID":
            return "Ser", True
    # 8. Aorist participle before its clause: antecedent time, "after …".
    if tense == "A" and precedes:
        return "Tmp", True
    # 9. Present participle after its clause: means/manner.
    if tense == "P" and not precedes:
        return "WEd", True
    # 10. Present participle before its clause: contemporaneous, "while …".
    if tense == "P" and precedes:
        return "Tmp", True
    # 11. Residual — "almost all participles are temporal in a secondary
    #     sense". IMPLEMENTATION ASSUMPTION awaiting expert review: the chart
    #     gives no tier for the residual bucket (an aorist participle FOLLOWING
    #     its clause is its largest member), and we join it to minimal like
    #     every other default rather than leaving it loose.
    return "Tmp", True


def _dependent_call(seg, j: int, segs: Sequence, words,
                    precedes: bool) -> tuple[str, bool] | None:
    """(relationship, sure) for a backward/forward-attaching dependent
    segment, or None if the segment is not a dependent unit. ``sure`` marks
    the calls that JOIN THE MINIMAL ANALYSIS — grammar-forced calls and
    sensible defaults alike (see the module docstring); each entry's warrant
    is in the comment beside it."""
    op = seg.opener
    if op is None:
        return None
    lemma = _L(op.lemma)
    if op.kind == "rel":
        # The relative clause interprets its antecedent's clause: Ft → In*.
        # Sure: Eph 3:11, 3:13 and Eph 1:13 all draw exactly this; none of
        # the worked diagrams reads a split-off relative any other way.
        # RULING: the old scope guard (sure only when the relative closed its
        # sentence against a single bare clause) is gone — attaching a
        # relative to the NEAREST clause is an accepted sensible default, so
        # the relationship's sureness no longer depends on its scope.
        return "FtIn", True
    if op.kind == "appos":
        # Apposition / attributive-article phrase restates: Ft → In*.
        # NOT sure: the expert has not ruled on apposition, so it stays a
        # Full-only best guess until they do.
        return "FtIn", False
    if op.kind == "pp":
        # Implicit-proposition prepositional phrase: guess by preposition.
        # NOT sure: also unruled — which proposition a bare PP implies is the
        # interpretive call, and the preposition only hints at it. NO ENGLISH
        # CUE HERE: the cue would name a relationship confidently ("until the
        # redemption …" → Tmp for Eph 1:14's εἰς ἀπολύτρωσιν), but the open
        # question is whether the implied PROPOSITION is drawable at all, not
        # which relation it takes — expert-questions.md Open #3.
        return _PP_REL.get(lemma, "WEd"), False
    if op.kind == "ptcp":
        return _participle_call(seg, j, segs, words, precedes)
    if op.kind == "inf":
        # Adverbial infinitive: a preposition + article pattern carries its
        # grammar-book sense; any other adverbial infinitive is purpose —
        # now a sure default (the overwhelmingly common reading).
        ws = _seg_words(seg, words)
        if len(ws) >= 2 and ws[1].pos == "RA":
            return _INF_PREP_REL.get(_L(ws[0].lemma), "MEd"), True
        return "MEd", True
    if op.kind == "sub_conj":
        if lemma in PURPOSE:
            # ἵνα / ὅπως. RULING (the ἵνα conditional rule): after a verb of
            # asking/praying/exhorting the clause states the CONTENT of the
            # request (Ft/In, as the Philippians student reads Phil 1:9);
            # otherwise it states purpose (M/Ed). Both branches are sure.
            # The ENGLISH CUE outranks the verb list in both directions: the
            # BSB's "so that"/"in order that" is purpose, its "that" is
            # content — read from the clause itself rather than inferred from
            # the verb in front of it. (It also reaches where the verb list
            # cannot: the second ἵνα of John 17:15 is still governed by ἐρωτῶ,
            # which the one-clause look-back of expert-questions.md Open #8
            # cannot see, but which the BSB's "that" states outright.)
            cue = _cue_call(seg, words, _PURPOSE_CUE_RELS,
                            _PURPOSE_CUE_OVERRIDES)
            if cue is not None:
                return cue, True
            prev = segs[j - 1] if j > 0 else None
            if prev is not None and _has_lemma(prev, words, ASKING_VERBS):
                return "FtIn", True
            return "MEd", True
        if lemma in RESULT:
            # ὥστε + INFINITIVE is the textbook result clause: 2/2 exact
            # (1 Thess 1:7, 1:8) and grammatically unambiguous — sure.
            # ὥστε + a finite verb is the inferential/actual-result use the
            # grammars split from it (and sentence-initially it reads as ∴,
            # per 1 Thess 4:18): C/E as a best guess, out of minimal — unless
            # the ENGLISH CUE RESURRECTS it. "so that"/"with the result"/"so
            # as to"/"as a result" makes the result reading the translators'
            # own (sure C/E); "therefore"/"so then" says they heard the
            # inferential use instead (sure Inf). With no cue it is unchanged.
            if not _result_infinitive(seg, words):
                cue = _cue_call(seg, words, _RESULT_CUE_RELS)
                if cue is not None:
                    return cue, True
                return "CE", False
            return "CE", True
        if lemma in CONDITIONAL:
            return "CndE", True           # ἐάν/εἰ: 2/2 exact (1 John)
        if lemma in TEMPORAL:
            return "Tmp", True            # explicit temporal subordinator
        if lemma in LOCATIVE:
            return "Loc", True            # explicit locative subordinator
        if lemma in COMPARATIVE:
            # ὡς is the one comparative that is not really a comparative: it
            # also carries temporal ("when …") and content ("that …") senses,
            # so the ENGLISH CUE picks between them. καθώς/ὥσπερ/καθάπερ/ὡσεί
            # are unambiguous and keep their grammar-forced Comparison.
            # POSITION NARROWS IT: a ὡς clause that PRECEDES its main clause is
            # never the content ("that …") use, which follows the verb that
            # governs it — so the content sense is off the table there.
            if lemma == HOS:
                allowed = _HOS_PRECEDING_CUE_RELS if precedes else _HOS_CUE_RELS
                cue = _cue_call(seg, words, allowed)
                if cue is not None:
                    return cue, True
            return "Cmp", True            # ὡς/ὥσπερ: 2/2 exact (1 Jn, Heb)
        if lemma in HOTI:
            # ὅτι is the ambiguity the cue layer was designed for, so here the
            # cue is the PRIMARY test (RULING, expert-questions.md): the BSB's
            # "that" is the content reading (Ft/In), its "because"/"since"/
            # "for" the causal one (Ground). The verbum-dicendi heuristic below
            # is the FALLBACK for a ὅτι the BSB leaves untranslated — which is
            # the common case in direct speech, where "he said, ὅτι …" becomes
            # a bare quotation. Both routes are sure.
            cue = _cue_call(seg, words, _HOTI_CUE_RELS)
            if cue is not None:
                return cue, True
            prev = segs[j - 1] if j > 0 else None
            if prev is not None and _has_lemma(prev, words, VERBA_DICENDI):
                # Content of saying/knowing: 2/2 exact (1 John 5c-5d, 6a-6b).
                return "FtIn", True
            # Causal ὅτι — no verb of saying in front of it. RULING: the rule
            # and its detection are confirmed, so the Ground is sure.
            return "Grnd", True
        return None  # unknown subordinator → a serial join, out of minimal
    return None


def _result_infinitive(seg, words) -> bool:
    """Is this ὥστε clause the infinitive construction? Its predicate is an
    infinitive (mood 'N' in the MorphGNT parsing) and it has no finite verb of
    its own."""
    ws = _seg_words(seg, words)
    return any(w.is_infinitive for w in ws) and not any(
        w.is_finite_verb for w in ws)


def _men_before(segs: Sequence, words) -> bool:
    """Does a μέν stand anywhere in these preceding segments? μέν … δέ is the
    Alternative; a δέ with no μέν in front of it is the default Series."""
    return any(_has_lemma(s, words, MEN) for s in segs)


# ---------------------------------------------------------------------------
# Within-sentence assembly

class _Held:
    """A forward-attaching packet (protasis or sentence-initial dependent),
    waiting to become children[0] of its bracket at sentence end."""

    __slots__ = ("packet", "rel", "sure")

    def __init__(self, packet: dict, rel: str, sure: bool = False):
        self.packet = packet
        self.rel = rel
        self.sure = sure


def _assemble_sentence(indexed_segs: list[tuple[int, "Segment"]],
                       segs: Sequence, words) -> dict:
    """Reduce one sentence's segments to a single packet (tree node). ``segs``
    is ``indexed_segs`` without the global indexes, which the caller already
    has to hand."""
    stack: list[dict] = []
    held: _Held | None = None

    def join_target_edge(new: dict, rel: str, sure: bool = False) -> None:
        """Right-edge join against the current target (stack top, else held).
        Coordinate vs. subordinate is :func:`_dep_bracket`'s call, made from
        ``rel`` alone. Only reached when the sentence is not ``fresh``, so one
        of the two is always there."""
        if stack:
            stack.append(_edge_join(stack.pop(), new, rel, sure))
        else:
            assert held is not None
            held.packet = _edge_join(held.packet, new, rel, sure)

    for j, (gi, seg) in enumerate(indexed_segs):
        leaf = _prop_node(gi)
        op = seg.opener
        kind = op.kind if op is not None else None
        lemma = _opener_lemma(seg)
        fresh = not stack and held is None  # no clause yet in this sentence

        # ``fresh`` is also the participle rules' precedes/follows test: with
        # no clause yet in the sentence the dependent is HELD and attaches
        # forward (it PRECEDES its clause); otherwise it attaches backward.
        # EVERY forward-attaching dependent comes through here — a conditional
        # or temporal protasis, a sentence-initial ὡς or ὅπου/οὗ, an initial
        # participle — the held branch below being the one path that holds
        # them. (A ``coord`` opener never yields a call, so the old
        # ``and kind != "coord"`` guard was dead.)
        call = _dependent_call(seg, j, segs, words, precedes=fresh)
        if call is not None:
            rel, sure = call
            if stack:
                top = stack.pop()
                stack.append(_dep_bracket(rel, top, leaf, sure))
            elif held is not None:
                held.packet = _dep_bracket(rel, held.packet, leaf, sure)
            else:
                # Sentence opens with a dependent unit (protasis, initial
                # participle, causal ὅτι, …): hold it, it attaches forward to
                # the coming apodosis/main clause. A sentence-INITIAL ὥστε is
                # the inferential construction (the 1 Thess 4:18 diagram draws
                # Ὥστε παρακαλεῖτε as ∴), not the result clause the CE call is
                # sure about — never sure here.
                held = _Held(leaf, rel, sure and rel != "CE")
            continue

        if kind == "coord" and not fresh:
            assert lemma is not None
            if lemma in GROUND or lemma in INFERENCE:
                # Postpositive γάρ/οὖν mid-sentence: relate the new clause to
                # the packet so far with the table relation. γάρ is sure
                # (4/4 exact across 1 Thess and Hebrews) and so, by the
                # expert's ruling, is the whole INFERENCE class — the old
                # exception for the Acts μὲν οὖν diagram is overruled.
                rel = "Grnd" if lemma in GROUND else "Inf"
                if stack:
                    if len(stack) > 1:
                        stack[:] = [_chain("Ser", stack)]
                    stack.append(_sub(rel, stack.pop(), leaf, dep_child=1,
                                      sure=True))
                else:
                    assert held is not None
                    held.packet = _sub(rel, held.packet, leaf, dep_child=1,
                                       sure=True)
            elif lemma in ADVERSATIVE:
                # οὐ … ἀλλά is the textbook -/+ (1/1 exact, 1 Thess). A bare
                # ἀλλά stays NEVER SURE by the expert's ruling: which of the
                # many contrastive readings it carries is undecidable. NO
                # ENGLISH CUE: the BSB's "but" here only confirms the contrast
                # we already know about — expert-questions.md Open #1 is which
                # relationship carries it, so this join is unchanged.
                # NegPos is subordinate, so the edge join wraps the negated
                # clause it contrasts with.
                confident = _has_lemma(segs[j - 1], words, NEGATIVES)
                join_target_edge(leaf, "NegPos", sure=confident)
            elif lemma in ALTERNATIVE:
                join_target_edge(leaf, "Alt", sure=True)
            elif lemma in DE:
                # μέν … δέ is the Alternative; a δέ with no μέν in front of it
                # is the default Series (RULING: sure). NO ENGLISH CUE: a δέ
                # the BSB renders "but" is contrastive rather than serial, but
                # which contrary relationship it marks is expert-questions.md
                # Open #1 — so δέ keeps Series until the expert rules.
                rel = "Alt" if _men_before(segs[:j], words) else "Ser"
                join_target_edge(leaf, rel, sure=True)
            elif lemma in SERIAL:
                # καί / οὐδέ / τε: Series — RULING, sure. (The 1 John student
                # hears one of these καί as ∴; a Series default the analyst
                # re-labels is still worth drawing.)
                join_target_edge(leaf, "Ser", sure=True)
            else:
                # Anything unrecognized (πλήν, μέντοι …): keep the structure,
                # stay out of minimal.
                join_target_edge(leaf, "Ser")
            continue

        if call is None and kind == "sub_conj" and not fresh:
            # Unknown subordinator: keep the structure, stay out of minimal.
            join_target_edge(leaf, "Ser")
            continue

        # Independent clause: sentence-initial (any opener) or asyndeton.
        stack.append(leaf)

    main: dict | None = None
    if stack:
        # Leftover asyndetic clauses. NOT sure: which members of a run belong
        # together is the speculative part (the relationship is only Series).
        main = _chain("Ser", stack)
    if held is not None and main is not None:
        # The held packet is the DEPENDENT side and stands first, so the
        # dispatch runs with dep_child=0 — an attendant-circumstance
        # participle's Series still coordinates rather than subordinating.
        return _dep_bracket(held.rel, held.packet, main, held.sure,
                            dep_child=0)
    if held is not None:
        return held.packet
    assert main is not None, "sentence produced no packet"
    return main


# ---------------------------------------------------------------------------
# Inter-sentence assembly

def _sentence_join(prev_segs: list, cur_segs: list, words) -> tuple[str, bool]:
    """(relationship, sure) joining the accumulated packet to the new
    sentence. Ser is the default when nothing marks the join — and by the
    expert's ruling it is a SURE default: sentences laid side by side each
    make their own contribution until the analyst says otherwise."""
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
            return "Grnd", True  # star on the supported (previous) side
        if conn in INFERENCE:
            # RULING: the whole INFERENCE class is always sure, inter-sentence
            # as well as mid-sentence. (This overrules the old exception for
            # the Acts 2:41 μὲν οὖν, which that diagram draws as C/E.)
            return "Inf", True
        if conn in DE:
            # μέν … δέ → Alternative; a δέ with no μέν → Series. Both sure.
            # A "but" cue is not consulted here either — Open #1, as within a
            # sentence.
            return ("Alt", True) if _men_before(prev_segs, words) else ("Ser", True)
        if conn in ADVERSATIVE:
            # Bare ἀλλά: NEVER sure (expert — undecidable; Open #1).
            return "NegPos", False
        if conn in ALTERNATIVE:
            return "Alt", True
        return "Ser", True   # bare καί / τε chain: sure default

    # Speech content: previous sentence ends with a verbum dicendi + '·'.
    # RULING: sure. The Acts diagram frames some speeches as S/R instead, but
    # Ft/In is the right starting point and re-marking it is one click.
    last_word = words[prev_segs[-1].end]
    if _closes_on_raised_dot(last_word) and _L(last_word.lemma) in VERBA_DICENDI:
        return "FtIn", True
    # Asyndeton between sentences: Series, the sensible default (RULING: sure).
    return "Ser", True


class _Packet(NamedTuple):
    """A folded unit and the sentence standing at each of its ends.

    ``opening`` is the FIRST sentence's segments — its connective decides the
    join INTO this packet — and ``closing`` the LAST sentence's, which is what
    that join looks BACK at (the μέν … δέ scan, the verbum dicendi + '·'
    test). For a single sentence the two are the same list, which is why
    folding the sentences of one section is byte-identical to the old
    whole-passage fold; a SECTION packet is the only thing that spans several
    sentences, and it is exactly there that the two ends differ."""

    node: dict
    opening: list
    closing: list


def _fold_sentences(packets: Sequence[_Packet], words) -> dict:
    """Fold packets left to right; a run of Ser joins becomes a left-nested
    chain of binary Ser brackets, closed when a non-Ser join appears. Each Ser
    bracket carries the sureness of the JOIN that made it (asyndeton and bare
    καί/δέ are sure defaults; an unrecognized connective is not), so a mixed
    run does not lose its confident brackets.

    Both folds of the big–small–big pipeline run through here: the SMALL fold
    over the sentences of one section, and the BIG fold over the section
    packets — same joins, same table, only the packets differ."""

    def close(group: list[tuple[dict, bool]]) -> dict:
        """The Ser run, left-folded — the same left fold as :func:`_chain`."""
        return _chain("Ser", [node for node, _ in group],
                      sures=[sure for _, sure in group])

    # (packet, sure) — ``sure`` describes the join that ADDED the packet, so
    # the first entry's is unused.
    group: list[tuple[dict, bool]] = [(packets[0].node, False)]
    previous = packets[0]
    for current in packets[1:]:
        rel, sure = _sentence_join(previous.closing, current.opening, words)
        if rel == "Ser":
            group.append((current.node, sure))
        else:
            group = [(_dep_bracket(rel, close(group), current.node, sure),
                      False)]
        previous = current
    return close(group)


# ---------------------------------------------------------------------------
# Sectioning — the big–small–big pass (docs/sectioning.md)
#
# The DA expert's ruling: before relationship generation, chunk the passage
# into its major logical sections; connect segment-to-segment WITHIN each
# section until it is internally complete; then connect the sections to each
# other. A section is a run of WHOLE SENTENCES, so this is a partition of the
# sentence list and within-sentence assembly never sees it.

OUN = _L("οὖν")


class _SentenceMarks(NamedTuple):
    """The seam-relevant surface facts about ONE sentence.

    Reading these off the corpus (:func:`_sentence_marks`) is kept apart from
    scoring them (:func:`_seams`) so that the scorer is a pure function —
    marks in, seams out — and can be pinned on its own."""

    heading: bool         # a BSB pericope heading stands before its first word
    paragraph: bool       # a BSB paragraph begins at its first word
    quote_begin: bool     # a quotation opens somewhere inside it
    quote_end: bool       # a quotation closes inside it
    oun: bool             # οὖν stands within its first three words
    dicendi: bool         # it INTRODUCES a speech (verbum dicendi + '·')
    english_period: bool  # the BSB closes an English sentence with it


#: THE SEAM SCORER, one entry per indicator. A sentence boundary is a seam
#: when the indicators firing on it reach :data:`SEAM_THRESHOLD` — so adding
#: an indicator (Open #8's vocatives, διό/διὰ τοῦτο, scene-setters, mood
#: shifts, epistolary asyndeton, rhetorical questions) is a line here plus its
#: detection in :func:`_sentence_marks`, and re-weighting one is a one-line
#: change. The initial weights are the expert's own grading: headings and
#: quotation bounds are HARD, paragraph breaks and οὖν STRONG, both of which
#: seam on their own; the English period is the one SOFT vote, and per the
#: ruling it is not yet a seam by itself — weight 0 until it is calibrated as
#: a tie-breaker for the indicators still awaiting a ruling.
SEAM_WEIGHTS: dict[str, int] = {
    "heading": 2,         # hard — the translators' own pericope division
    "quote_begin": 2,     # hard — direct/indirect discourse opens
    "quote_end": 2,       # hard — the speech closes, its frame resumes
    "paragraph": 1,       # strong — the translators' paragraphing
    "oun": 1,             # strong — "basically always a transition"
    "english_period": 0,  # soft — a vote, never a seam on its own
}
SEAM_THRESHOLD = 1


def _english_period(words, index: int) -> bool:
    """Does the BSB close an English sentence where this Greek sentence
    closes? The interlinear cells carry no punctuation of their own, so the
    signal is read at VERSE granularity from the BSB verse text: true when the
    sentence ends on the last word of its verse and that verse's English ends
    on a full stop. Coarser than the design's "English sentence period", which
    is why it is the indicator carrying weight 0."""
    word = words[index]
    verse = (word.book, word.chapter, word.verse)
    if index + 1 < len(words):
        following = words[index + 1]
        if (following.book, following.chapter, following.verse) == verse:
            return False
    text = load_translation().get(verse, "")
    return text.rstrip().rstrip("”\"’')]").endswith(".")


def _dicendi_sentence(segs: Sequence, words) -> bool:
    """Does this sentence INTRODUCE a speech?

    The existing dicendi machinery, read over a whole sentence: it closes on
    the raised dot that opens a quotation (:func:`_introduces_speech`'s test)
    and its closing clause carries a verb of saying (``_sentence_join``'s
    test, widened from the last WORD to the last SEGMENT so that Matt 3:7's
    "εἶπεν αὐτοῖς·" and Matt 3:3's "λέγοντος·" both count). λέγων/λέγοντες
    need no branch of their own: λέγω is a verbum dicendi, so a λέγων segment
    closing on '·' is already a hit."""
    if not _closes_on_raised_dot(words[segs[-1].end]):
        return False
    return _has_lemma(segs[-1], words, VERBA_DICENDI)


def _sentence_marks(segs: Sequence, words) -> _SentenceMarks:
    """Read one sentence's seam indicators off the corpus.

    Heading and paragraph are asked of the sentence's FIRST WORD (a section a
    heading opens starts where the sentence starts); the quotation marks are
    asked of the whole sentence, because a quotation opening mid-sentence
    never splits it — it only says the speech section starts at that sentence,
    dicendi opener and all. Quote REOPENS inside a long speech are recorded as
    opens like any other (see da/corpus/structure.py), so they too begin a
    section; in practice they sit at paragraph starts, which are seams
    anyway."""
    start, end = segs[0].start, segs[-1].end
    first = marks_for(start)
    opens = closes = False
    for i in range(start, end + 1):
        mark = marks_for(i)
        opens = opens or mark.quote_opens
        closes = closes or mark.quote_closes
    return _SentenceMarks(
        heading=first.heading is not None,
        paragraph=first.paragraph,
        quote_begin=opens,
        quote_end=closes,
        # "Sentence-initial οὖν, or postpositive οὖν in the first three
        # words" — οὖν is a postpositive, so it is the position of its clause
        # that matters, not of the particle.
        oun=any(_L(w.lemma) == OUN for w in words[start:min(end, start + 2) + 1]),
        dicendi=_dicendi_sentence(segs, words),
        english_period=_english_period(words, end),
    )


def _indicators(marks: Sequence[_SentenceMarks], i: int) -> tuple[str, ...]:
    """The indicators firing at the boundary BEFORE sentence ``i``. Openers
    are read off the new sentence, closers off the one it follows."""
    here, before = marks[i], marks[i - 1]
    fired: list[str] = []
    if here.heading:
        fired.append("heading")
    if here.quote_begin:
        fired.append("quote_begin")
    if before.quote_end:
        fired.append("quote_end")
    if here.paragraph:
        fired.append("paragraph")
    if here.oun:
        fired.append("oun")
    if before.english_period:
        fired.append("english_period")
    return tuple(fired)


def _seam_score(fired: Iterable[str]) -> int:
    return sum(SEAM_WEIGHTS[name] for name in fired)


def _seams(marks: Sequence[_SentenceMarks]) -> list[int]:
    """The sentence indexes that BEGIN a section — the scorer, pure.

    THE SPEECH VERB RIDES WITH ITS SPEECH (the expert's critical ruling). A
    quotation is a hard seam, but the clause that introduces it belongs to the
    speech, not to what came before: when the sentence before the speech is a
    dicendi sentence the seam is MOVED back over it, so "εἶπεν αὐτοῖς·" opens
    the speech section instead of closing the narrative one. The moved seam
    replaces the original — leaving both would strand the introduction as a
    section of its own, which is the opposite of the ruling. A seam at
    sentence 0 is no seam at all: the passage already starts there."""
    seams: set[int] = set()
    for i in range(1, len(marks)):
        if _seam_score(_indicators(marks, i)) < SEAM_THRESHOLD:
            continue
        if marks[i].quote_begin and marks[i - 1].dicendi:
            seams.add(i - 1)
        else:
            seams.add(i)
    seams.discard(0)
    return sorted(seams)


def _section_bounds(count: int, seams: Sequence[int]) -> list[tuple[int, int]]:
    """Seam list → inclusive (first sentence, last sentence) runs. No
    indicator anywhere means one section over the whole passage."""
    starts = [0] + [s for s in seams if 0 < s < count]
    return [(lo, hi - 1) for lo, hi in zip(starts, starts[1:] + [count])]


#: What it takes for a because-span to count as DEVELOPED (step 3): the
#: expert's "at least one coordinate relation or a Fact–Interpretation".
_DEVELOPED_CODES = COORDINATE_CODES | {"FtIn"}


def _develops(node: dict) -> bool:
    """Does this packet develop — is there a coordinate (Ser/Prog/Alt) or a
    Fact–Interpretation bracket anywhere inside it?"""
    if node["kind"] != "bracket":
        return False
    return (node["rel"] in _DEVELOPED_CODES
            or any(_develops(child) for child in node["children"]))


def _promoted(bounds: Sequence[tuple[int, int]], packets: Sequence[_Packet],
              words) -> list[tuple[int, int]]:
    """The promotion pass — the one structure-dependent indicator.

    A "because" join made at the SENTENCE level (a Ground from
    :func:`_sentence_join`; in practice γάρ, since a causal ὅτι is a
    subordinator and never reaches the inter-sentence table) whose support
    DEVELOPS is not a supporting clause but a section: the ground's block is
    cut out as its own section and both sides are re-folded. The block is the
    because-sentence plus the Ser-joined sentences that continue it — exactly
    the run the fold would hang off it — and it qualifies when that run's own
    packet holds a coordinate or a Fact–Interpretation.

    "That run develops" needs no fold to answer: a run of MORE THAN ONE
    sentence always does, because the Ser joining them is itself coordinate, so
    only the single-sentence case has to look inside — ``end > i or
    _develops(packets[i].node)``. (Folding a throwaway probe per candidate made
    this quadratic in the run length for no extra information.)

    One level is enough: the promoted sections are not re-examined."""
    out: list[tuple[int, int]] = []
    for lo, hi in bounds:
        rels = {
            i: _sentence_join(packets[i - 1].closing, packets[i].opening, words)[0]
            for i in range(lo + 1, hi + 1)
        }
        cuts: set[int] = set()
        for i in range(lo + 1, hi + 1):
            if rels[i] != "Grnd":
                continue
            end = i
            while end + 1 <= hi and rels[end + 1] == "Ser":
                end += 1
            if not (end > i or _develops(packets[i].node)):
                continue
            cuts.add(i)                     # the because-block opens here
            if end + 1 <= hi:
                cuts.add(end + 1)           # … and closes here
        starts = [lo] + sorted(cuts)
        out.extend((a, b - 1) for a, b in zip(starts, starts[1:] + [hi + 1]))
    return out


def _sections(packets: Sequence[_Packet], words) -> list[tuple[int, int]]:
    """The passage's sections as inclusive sentence runs: seam detection over
    the surface marks, then the promotion pass."""
    marks = [_sentence_marks(p.opening, words) for p in packets]
    return _promoted(_section_bounds(len(packets), _seams(marks)), packets, words)


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
    """Remove the builder's one piece of bookkeeping: the ``_sure`` marks the
    confident mode prunes by. (No ``flag`` to strip — this module never sets
    one; a review flag is the analyst's own, set in the editor on a document
    that never passes back through here.)"""
    node.pop("_sure", None)
    for child in node.get("children", ()):
        _strip_private(child)


def _confident_forest(tree: dict) -> list[dict]:
    """The maximal all-sure subtrees of ``tree``, in document order — the
    MINIMAL analysis: every grammar-forced call plus every sensible default
    (see the module docstring), with the genuinely undecidable joins dissolved
    back into their pieces for the analyst.

    A bracket survives only if its own call is sure AND every bracket under
    it survives: a sure relationship over an uncertain sub-grouping is an
    uncertain bracket (the children it pairs are themselves a guess).

    ONE POST-ORDER PASS. Each node is visited exactly once: it reports whether
    its subtree is entirely sure AND the roots that subtree contributes. A node
    that is kept contributes itself; one that is not hands its children's roots
    upward. (Deciding keepability and then walking separately re-tested most
    nodes once per ancestor.)"""
    def visit(node: dict) -> tuple[bool, list[dict]]:
        """(is this whole subtree sure?, the maximal all-sure roots in it)"""
        if node["kind"] == "prop":
            return True, [node]
        keepable = bool(node.get("_sure"))
        kept: list[dict] = []
        for child in node["children"]:
            child_sure, child_roots = visit(child)
            keepable = keepable and child_sure
            kept.extend(child_roots)
        return (True, [node]) if keepable else (False, kept)

    return visit(tree)[1]


def _sentences(segments: Sequence) -> list[list[tuple[int, "Segment"]]]:
    """The segments grouped into sentences, each segment carrying its GLOBAL
    index (which is what names its proposition)."""
    sentences: list[list[tuple[int, "Segment"]]] = []
    for gi, seg in enumerate(segments):
        if sentences and sentences[-1][-1][1].sentence == seg.sentence:
            sentences[-1].append((gi, seg))
        else:
            sentences.append([(gi, seg)])
    return sentences


def build_document(segments: list["Segment"], *,
                   confident_only: bool = False) -> dict:
    """Assemble the segments of one aligned passage into a validated analysis
    document. With ``confident_only`` (the "minimal" level) the forest keeps
    only the maximal all-sure subtrees (see :func:`_confident_forest`) — the
    joins that belong in the minimal analysis — and leaves the undecidable
    ones disconnected for the analyst. Without it, everything is connected
    into exactly one tree.

    BIG–SMALL–BIG (docs/sectioning.md): the sentences are chunked into
    sections first (:func:`_sections`), folded within each section, and the
    section packets folded together — through the same joins either way. The
    sections are also emitted as the document's colour blocks, so the division
    the analyzer read is visible in the editor from the first click."""
    if not segments:
        raise ValueError("build_document needs at least one segment")
    words = load_words()

    sentences = _sentences(segments)
    sentence_packets: list[_Packet] = []
    for group in sentences:
        segs = [s for _, s in group]
        # One sentence, so both ends of the packet are that same segment list.
        sentence_packets.append(
            _Packet(_assemble_sentence(group, segs, words), segs, segs))

    bounds = _sections(sentence_packets, words)
    section_packets = [
        _Packet(_fold_sentences(sentence_packets[lo:hi + 1], words),
                sentence_packets[lo].opening, sentence_packets[hi].closing)
        for lo, hi in bounds
    ]
    tree = _fold_sentences(section_packets, words)
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
    # The colour blocks: one per section after the first, named by the
    # proposition it opens. The document already opens inside its first block,
    # so that one is never stored (documents.py) — and the colours simply
    # count up, the editor's palette cycling them.
    blocks = [{"start": f"p{sentences[lo][0][0] + 1}", "color": k}
              for k, (lo, _) in enumerate(bounds) if k]
    if blocks:
        doc["sections"] = blocks
    validate_document(doc)  # a failure here is a builder bug — never ship it
    return doc
