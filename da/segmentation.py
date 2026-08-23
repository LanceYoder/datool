"""Stage 1 of the first pass: proposition segmentation.

Splits a corpus word range into clause-level segments following the course's
Text Flow rules (docs/DESIGN.md §5): sentence breaks at final punctuation, and
new segments at dependent-unit openers (subordinating conjunctions, relative
pronouns, adverbial participles, adverbial infinitives) and at coordinating
conjunctions that join clauses. Each segment records *why* it opened — that
metadata drives Stage 2 classification.

Contract:
    segment(start, end) -> list[Segment]   segments exactly tile [start, end]
    Segment.start/end                       inclusive corpus word indexes
    Segment.sentence                        0-based, increments after a word
                                            whose ends_sentence is True
    Segment.opener                          Opener | None — why it opened
"""

from dataclasses import dataclass
from unicodedata import normalize as _unicode_normalize

from .corpus import load_words

__all__ = ["Opener", "Segment", "segment"]


@dataclass(frozen=True)
class Opener:
    kind: str    # 'sub_conj' | 'rel' | 'ptcp' | 'inf' | 'coord'
    lemma: str
    index: int   # corpus index of the marker word


@dataclass(frozen=True)
class Segment:
    start: int   # inclusive corpus index
    end: int     # inclusive corpus index
    sentence: int
    opener: Opener | None


def _nfc(items: tuple[str, ...]) -> frozenset[str]:
    return frozenset(_unicode_normalize("NFC", item) for item in items)


# Subordinating conjunctions / conjunctive adverbs that open a dependent
# clause. Compared against Word.lemma (MorphGNT lemmas are NFC already; the
# sets are normalized anyway). Gated on pos C-/D-: e.g. ἐάν tagged X- is the
# ἄν-substitute particle (ὃς ἐάν), not a conditional opener.
SUB_CONJ_LEMMAS = _nfc((
    "ὅτι", "ἵνα", "ἐάν", "εἰ", "ὅταν", "ὅτε", "ὡς", "ὥστε", "ἐπεί", "ἐπειδή",
    "ἐπειδήπερ", "ἐπάν", "καθώς", "καθώσπερ", "ὥσπερ", "καθάπερ", "καθό",
    "καθότι", "ὅπως", "ὅπου", "οὗ", "ἄχρι", "ἕως", "πρίν", "διότι", "ἡνίκα",
    "ὁπότε", "ὁσάκις", "εἴπερ", "ἐάνπερ", "μήποτε", "μήπως", "ὡσεί",
))
_SUB_POS = ("C-", "D-")

# Coordinating conjunctions that join clauses. Gated on pos == 'C-': adverbial
# καί ("also", tagged D-) and prepositional πλήν/ἄχρι never split.
COORD_LEMMAS = _nfc((
    "καί", "δέ", "ἀλλά", "ἤ", "οὐδέ", "μηδέ", "τε", "τέ", "πλήν", "μέντοι",
    "γάρ", "οὖν", "διό", "ἄρα", "ὅθεν", "τοιγαροῦν", "τοίνυν",
))

# Connectives that stand second (or third) in their clause: the segment break
# belongs at the start of their clause, not at the connective itself.
POSTPOSITIVES = _nfc(("γάρ", "δέ", "οὖν", "ἄρα", "μέν", "τε", "τέ", "μέντοι", "τοίνυν"))

# Interjections that never open a segment.
INTERJECTIONS = _nfc(("ἰδού", "ἴδε"))

# Interrogative lemmas that introduce (indirect) questions. MorphGNT tags the
# indefinite τις with pos RI as well — the lemma separates them (indefinite
# τις is unaccented, interrogative τίς accented).
INTERROGATIVES = _nfc(("τίς", "ὁποῖος", "ποῖος", "πόσος", "ὁπόσος", "πηλίκος", "ποταπός"))

# Prepositions that form adverbial infinitive constructions with an article
# (εἰς τό, διὰ τό, μετὰ τό, πρὸς τό, ἐν τῷ, πρὸ τοῦ, ἕως τοῦ, ἀντὶ τοῦ).
INF_PREPS = _nfc(("εἰς", "διά", "μετά", "πρός", "ἐν", "πρό", "ἕως", "ἀντί"))

# Verbs whose infinitive complement stays inline (complementary infinitives).
# δεῖ is lemmatized δέω and ἔξεστιν as "ἔξεστι(ν)" in MorphGNT.
COMPLEMENT_GOVERNORS = _nfc((
    "δύναμαι", "μέλλω", "θέλω", "ἄρχω", "ζητέω", "ὀφείλω", "δέω", "δεῖ",
    "ἔξεστι(ν)", "ἔξεστιν", "δοκέω", "βούλομαι", "ἐπιθυμέω", "ἀφίημι",
    "δίδωμι", "ἔχω", "πειράζω", "σπουδάζω",
))

# Word classes allowed between an article and the infinitive it governs
# (negations, particles, accusative-subject pronouns): a noun, adjective,
# verb, second article, or preposition in between breaks the construction.
_INF_BLOCKERS = ("N-", "A-", "V-", "RA", "P-", "RR")


def _absorbable(word) -> bool:
    """True for words that never make a segment 'contentful' on their own:
    conjunctions, subordinator adverbs, and the ἰδού/ἴδε interjections. A
    segment holding only these merges with the clause that follows."""
    return (
        word.pos == "C-"
        or word.lemma in INTERJECTIONS
        or (word.lemma in SUB_CONJ_LEMMAS and word.pos in _SUB_POS)
    )


def _articular(words, i: int) -> bool:
    """Attributive/substantival participle heuristic: an RA article agreeing
    in case+number+gender within the 4 words before the participle, with no
    finite verb between, and not claimed by an intervening agreeing noun
    (which would make e.g. a genitive absolute look articular). An anarthrous
    participle directly after a noun it agrees with is also attributive
    (θεῷ ζῶντι καὶ ἀληθινῷ) — except in the genitive, where that shape is
    usually a genitive absolute."""
    p = words[i]
    if (i > 0 and p.case != "G" and words[i - 1].pos == "N-"
            and words[i - 1].case == p.case
            and words[i - 1].number == p.number
            and words[i - 1].gender == p.gender):
        return True
    for j in range(i - 1, max(0, i - 4) - 1, -1):
        w = words[j]
        if w.ends_sentence:          # crossed into the previous sentence
            return False
        if w.is_finite_verb:
            return False
        if (w.pos == "RA" and w.case == p.case
                and w.number == p.number and w.gender == p.gender):
            for k in range(j + 1, i):
                between = words[k]
                if (between.pos == "N-" and between.case == w.case
                        and between.number == w.number and between.gender == w.gender):
                    return False     # article governs that noun instead
            return True
    return False


def _predicate_follows(words, b: int, skip: int, end: int) -> bool:
    """Would a segment opened at ``b`` contain a predicate? Scans forward to
    the range end / sentence end / next clause marker looking for a finite
    verb (an embedded relative clause's verb does not count as the host's).
    An adverbial participle is itself a clause marker — it opens its own
    segment, so it neither licenses a coordinator split (Phil 1:10 ἦτε
    εἰλικρινεῖς καὶ ἀπρόσκοποι … πεπληρωμένοι must not split at καί) nor
    counts as the predicate."""
    embedded = False
    embedded_finite = False
    for j in range(b, end + 1):
        w = words[j]
        if j != skip:
            if w.is_finite_verb:
                if embedded and not embedded_finite:
                    embedded_finite = True   # the relative clause's own verb
                else:
                    return True
            elif w.pos == "RR":
                embedded = True
            elif (w.lemma in SUB_CONJ_LEMMAS and w.pos in _SUB_POS) or (
                    w.pos == "C-" and w.lemma in COORD_LEMMAS):
                break                        # next clause boundary
            elif w.is_participle and not _articular(words, j):
                break                        # next clause boundary (own segment)
        if w.ends_sentence:
            break
    return False


def _governed_complement(words, i: int, lo: int) -> bool:
    """Infinitive at ``i`` governed by a complementary verb a few words back."""
    for j in range(i - 1, max(lo, i - 4) - 1, -1):
        w = words[j]
        if w.ends_sentence:
            return False
        if w.pos == "V-" and w.lemma in COMPLEMENT_GOVERNORS:
            return True
    return False


def _adverbial_inf_start(words, i: int, lo: int):
    """If the infinitive at ``i`` heads an adverbial construction
    (preposition + article + infinitive, or bare τοῦ + infinitive), the corpus
    index where that construction starts; otherwise None."""
    for j in range(i - 1, max(lo, i - 4) - 1, -1):
        w = words[j]
        if w.is_finite_verb or (w.ends_sentence and j < i):
            return None
        if w.pos == "RA":
            if any(words[k].pos in _INF_BLOCKERS for k in range(j + 1, i)):
                return None
            if j - 1 >= lo and words[j - 1].pos == "P-" and words[j - 1].lemma in INF_PREPS:
                return j - 1                 # εἰς τό / ἐν τῷ / πρὸ τοῦ …
            if w.case == "G":
                return j                     # bare τοῦ + infinitive
            return None
    return None


def segment(start: int, end: int) -> list[Segment]:
    """Segment the inclusive corpus range [start, end] into propositions.

    The returned segments exactly tile the range, in order; ``sentence``
    increments after each word whose ``ends_sentence`` is True.
    """
    words = load_words()
    if not (0 <= start <= end < len(words)):
        raise ValueError(f"invalid corpus range [{start}, {end}]")

    segs: list[Segment] = []
    sentence = 0

    # Current-segment state.
    seg_start = start
    opener: Opener | None = None
    host_finite = False      # the segment's own clause has its finite verb
    last_finite = -1
    embedded = False         # inside an embedded (interrupting) relative clause
    embedded_finite = False
    last_comma = -1          # index of the last comma-bearing word in segment
    has_content = False      # any non-absorbable word seen in segment
    ptcp_absorbed = False    # an adverbial ptcp was absorbed into this segment
    any_verb = False         # any verb form at all (finite, inf, ptcp) inline

    def emit(seg_end: int) -> None:
        segs.append(Segment(start=seg_start, end=seg_end, sentence=sentence, opener=opener))

    def clear(b: int, new_opener: Opener | None) -> None:
        nonlocal seg_start, opener, host_finite, last_finite
        nonlocal embedded, embedded_finite, last_comma, has_content
        nonlocal ptcp_absorbed, any_verb
        seg_start = b
        opener = new_opener
        host_finite = False
        last_finite = -1
        embedded = False
        embedded_finite = False
        last_comma = -1
        has_content = False
        ptcp_absorbed = new_opener is not None and new_opener.kind == "ptcp"
        any_verb = False

    def split(b: int, new_opener: Opener | None, moved_upto: int) -> None:
        """Close the current segment at b-1, open a new one at b. Words
        [b, moved_upto] (possibly none) already belong to the new segment;
        replay their state contributions."""
        nonlocal host_finite, last_finite, last_comma, has_content, any_verb
        emit(b - 1)
        clear(b, new_opener)
        for j in range(b, moved_upto + 1):
            wj = words[j]
            if wj.is_finite_verb:
                host_finite = True
                last_finite = j
            if wj.is_verb:
                any_verb = True
            if "," in wj.text:
                last_comma = j
            if not _absorbable(wj):
                has_content = True

    for i in range(start, end + 1):
        w = words[i]
        lemma = w.lemma
        at_seg_start = i == seg_start

        if w.pos in _SUB_POS and lemma in SUB_CONJ_LEMMAS:
            # Subordinating conjunction.
            if at_seg_start:
                if opener is None:
                    opener = Opener("sub_conj", lemma, i)
            elif not has_content:
                # Only connectives before it (e.g. καὶ ὅτι): absorb.
                if opener is None or opener.kind == "coord":
                    opener = Opener("sub_conj", lemma, i)
            else:
                split(i, Opener("sub_conj", lemma, i), i - 1)

        elif w.pos == "RR" or (w.pos == "RI" and lemma in INTERROGATIVES):
            # Relative pronoun — or an interrogative introducing an indirect
            # question (ὁποίαν εἴσοδον ἔσχομεν), which opens a clause the same
            # way (the indefinite τις, also tagged RI, does not). A preposition
            # immediately before it belongs to the relative clause (ἐν ᾧ,
            # δι᾽ οὗ …), so the clause starts there.
            b = i - 1 if i > seg_start and words[i - 1].pos == "P-" else i
            if at_seg_start or b <= seg_start:
                if opener is None:
                    opener = Opener("rel", lemma, i)
            elif all(_absorbable(words[j]) for j in range(seg_start, b)):
                # Only connectives before the clause start: absorb.
                if opener is None or opener.kind == "coord":
                    opener = Opener("rel", lemma, i)
            elif not host_finite and not any_verb and b == i:
                # Interrupting relative clause: host material precedes but no
                # verb of any kind has arrived, so the relative stays inline
                # (embedded), e.g. Mt 2:9 ὁ ἀστήρ, ὃν εἶδον…, προῆγεν. A
                # relative after a non-finite predicate (1 Thess 1:10
                # ἀναμένειν τὸν υἱὸν … ὃν ἤγειρεν) is a normal trailing
                # relative and splits.
                embedded = True
            else:
                split(b, Opener("rel", lemma, i), i - 1)

        elif w.pos == "C-" and lemma in COORD_LEMMAS:
            # Coordinating conjunction — splits only when it joins clauses.
            if lemma in POSTPOSITIVES:
                # The clause starts before the connective: at the nearest
                # boundary (segment start / after the last comma) if that is
                # within two words, else right before the connective.
                nearest = max(seg_start, last_comma + 1)
                b = nearest if i - nearest <= 2 else i - 1
            else:
                b = i
            if b <= seg_start:
                # Connective belongs to the clause already starting this
                # segment: no split; classify the opener if none is set.
                if (opener is None and i - seg_start <= 2
                        and _predicate_follows(words, seg_start, i, end)):
                    opener = Opener("coord", lemma, i)
            elif not has_content and b == i:
                pass  # e.g. καὶ γάρ: only connectives so far, keep together
            elif not host_finite and b == i:
                # The current clause hasn't reached its own verb yet: the
                # coordinator joins words within it, not clauses (Phil 1:9
                # ἵνα … ἔτι μᾶλλον καὶ μᾶλλον περισσεύῃ).
                pass
            elif _predicate_follows(words, b, i, end):
                split(b, Opener("coord", lemma, i), i - 1)

        elif w.is_participle:
            if not _articular(words, i):
                # Adverbial participle (incl. genitive absolutes).
                if at_seg_start:
                    if opener is None:
                        opener = Opener("ptcp", lemma, i)
                    ptcp_absorbed = True
                elif embedded:
                    pass  # participle inside an embedded relative clause
                elif not has_content:
                    # e.g. καὶ προσελθόντες: fold the connective in.
                    if opener is None or opener.kind == "coord":
                        opener = Opener("ptcp", lemma, i)
                    ptcp_absorbed = True
                elif (opener is not None and opener.kind in ("rel", "sub_conj")
                        and not host_finite):
                    # The participle is this dependent clause's own predicate
                    # so far (Eph 1:13 ἐν ᾧ καὶ πιστεύσαντες …): keep it — if
                    # a finite verb follows, the resumption rule below splits.
                    ptcp_absorbed = True
                else:
                    split(i, Opener("ptcp", lemma, i), i - 1)

        elif w.is_infinitive:
            if not _governed_complement(words, i, start):
                b = _adverbial_inf_start(words, i, seg_start)
                if b is not None:
                    if b <= seg_start:
                        if opener is None or opener.kind == "coord":
                            opener = Opener("inf", lemma, i)
                    elif all(_absorbable(words[j]) for j in range(seg_start, b)):
                        if opener is None or opener.kind == "coord":
                            opener = Opener("inf", lemma, i)
                    else:
                        split(b, Opener("inf", lemma, i), i - 1)

        elif w.is_finite_verb:
            if embedded:
                if not embedded_finite:
                    embedded_finite = True   # the embedded clause's own verb
                else:
                    # Host clause resumes after the embedded relative.
                    embedded = False
                    embedded_finite = False
                    host_finite = True
                    last_finite = i
            elif not host_finite and (
                    ptcp_absorbed
                    or (opener is not None and opener.kind in ("ptcp", "inf"))):
                # Host clause resumes after a dependent participle/infinitive
                # unit: break at the clause start (after a comma if one
                # followed the dependent unit, else at the verb).
                marker = opener.index if opener is not None else seg_start
                b = last_comma + 1 if last_comma >= marker else i
                if b > seg_start:
                    split(b, None, i - 1)
                host_finite = True
                last_finite = i
            elif not host_finite:
                host_finite = True
                last_finite = i
            else:
                # Second finite verb: asyndetic new clause (e.g. an apodosis
                # after its protasis's comma). Break after the most recent
                # comma when it follows the previous verb, else at the verb.
                b = last_comma + 1 if last_comma >= last_finite else i
                if b > seg_start:
                    split(b, None, i - 1)
                host_finite = True
                last_finite = i

        # State contributions of the word itself.
        if w.is_verb:
            any_verb = True
        if "," in w.text:
            last_comma = i
        if not _absorbable(w):
            has_content = True

        if w.ends_sentence:
            emit(i)
            sentence += 1
            clear(i + 1, None)

    if seg_start <= end:
        emit(end)

    return segs
