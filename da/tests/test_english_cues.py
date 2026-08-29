"""The English-cue layer (docs/english-cue-rules.md).

The BSB interlinear alignment tells us which SENSE of an ambiguous Greek
connective or participle the context carries — the translators already did the
interpretive work. These tests pin the layer at three levels:

  * the two helpers, :func:`segment_english` (assembling a segment's aligned
    English in BSB word order) and :func:`leading_cue` (matching the cue table
    leading-anchored, longest phrase first);
  * the per-trigger wiring, against REAL NT verses whose BSB English actually
    carries each cue — every expectation below was read off the corpus, not
    invented;
  * the boundaries: what the cue is NOT allowed to override (the grammar-forced
    participle rules, the non-ὡς comparatives, implicit-proposition PPs) and
    the joins where a cue is detected but deliberately not acted on (the
    contrastive "but" of expert-questions.md Open #1).

Cue-derived calls are ``sure``: a translator's reading is exactly the
"sensible-default" tier the re-tier put in the minimal analysis.
"""

from da.corpus import load_words
from da.treebuild import (
    _HOTI_CUE_RELS,
    _PTCP_CUE_OVERRIDES,
    _PTCP_CUE_RELS,
    _PURPOSE_CUE_OVERRIDES,
    _cue_call,
    _dependent_call,
    _has_lemma,
    _segment_participle,
    ASKING_VERBS,
    VERBA_DICENDI,
    build_document,
    contrastive_cue,
    leading_cue,
    opener_english,
    segment_english,
)

from .test_firstpass_golden import SER, SUB, Seg, call_for, opened_by, passage


def seg_at(segments, index: int):
    return segments[index]


def english(ref: str, index: int) -> str:
    segs, _ = passage(ref)
    return segment_english(segs[index], load_words())


# ---------------------------------------------------------------------------
# segment_english — assembling the BSB phrase for one segment

def test_segment_english_assembles_in_bsb_word_order():
    """1 Thess 1:6 δεξάμενοι τὸν λόγον ἐν θλίψει πολλῇ μετὰ χαρᾶς πνεύματος
    ἁγίου. The BSB moves the ἐν θλίψει phrase to the END of the clause, so
    reading the cells in CORPUS order would give a different sentence: the
    ``english_order`` sort is doing real work here."""
    segs, _ = passage("1 Thessalonians 1:6")
    seg = segs[opened_by(segs, "δέχομαι")]
    assert segment_english(seg) == (
        "when you welcomed the message with the joy of the holy spirit "
        "in spite of your great suffering"
    )


def test_segment_english_keeps_supplied_words_without_their_brackets():
    """"Blessed [are] the poor in spirit" — a supplied word COUNTS as cue text
    (the design's example is "[if]"), so the brackets go and their contents
    stay. The BSB's curly braces ("{do} not") are the same device."""
    text = english("Matthew 5:3", 0)
    assert text == "blessed are the poor in spirit"
    assert "[" not in text and "]" not in text


def test_segment_english_drops_the_bsb_continuation_markers():
    """The BSB writes ". . ." in a cell whose English lives in a neighbouring
    one. Those markers carry no cue and would block every leading match, so a
    cell with no letters or digits is dropped: 1 Thess 1:9's relative clause
    ends in six of them."""
    assert english("1 Thessalonians 1:9", 1) == "what kind of welcome you gave us"


def test_segment_english_groups_by_verse_then_concatenates():
    """``english_order`` keys are the upstream table's global row numbers and
    are only comparable WITHIN a verse, so a segment that crosses a verse
    boundary is assembled verse-group by verse-group in corpus order. Matt
    27:35–36 βάλλοντες κλῆρον, καί spans exactly that boundary."""
    segs, _ = passage("Matthew 27:35-36")
    spanning = [s for s in segs
                if len({load_words()[i].verse for i in range(s.start, s.end + 1)}) > 1]
    assert len(spanning) == 1
    assert segment_english(spanning[0]) == "by casting lots and"


def test_segment_english_is_empty_when_nothing_is_aligned():
    """≈0.4% of the corpus has no aligned English (and some aligned cells are
    blank). Such a segment simply yields no cue and the grammar-only rules
    decide, exactly as before this layer existed."""
    assert segment_english(Seg(10, 10, 0, None)) == ""
    assert leading_cue(segment_english(Seg(10, 10, 0, None))) is None


# ---------------------------------------------------------------------------
# leading_cue — the cue table

def test_leading_cue_matches_the_longest_phrase_first():
    """"as a result" must not be read as the comparative "as", "even though"
    not as "though", "in order to" not as any shorter prefix of itself."""
    assert leading_cue("as a result he was led astray") == "CE"
    assert leading_cue("as he is in the light") == "Cmp"
    assert leading_cue("even though he was rich") == "Adv"
    assert leading_cue("though he was rich") == "Adv"
    assert leading_cue("in order to save the lost") == "MEd"
    assert leading_cue("just as god did") == "Cmp"
    assert leading_cue("as soon as jesus was baptized") == "Tmp"


def test_leading_cue_is_word_boundary_anchored():
    """The design writes the cue as "for " with a trailing space precisely so
    it cannot fire on "forgive"; every phrase is matched that way."""
    assert leading_cue("for theirs is the kingdom of heaven") == "Grnd"
    assert leading_cue("for") == "Grnd"
    assert leading_cue("forgive us our debts") is None
    assert leading_cue("ashamed of the gospel") is None


def test_leading_cue_is_leading_anchored():
    """A cue word in the middle of the clause says nothing about the clause's
    own relationship to its host."""
    assert leading_cue("we lie because we walk in the darkness") is None
    assert leading_cue("") is None


def test_leading_cue_by_is_the_means_cue_only_before_a_gerund():
    """"by sealing the stone" is Means; "by the word of the Lord" is an
    instrument inside the clause, not a relationship."""
    assert leading_cue("by sealing the stone") == "WEd"
    assert leading_cue("by the word of the lord we declare to you") is None


def test_leading_cue_per_trigger_overrides():
    """"so that" is the one phrase the triggers read differently: result for
    ὥστε (the table's own reading), purpose for ἵνα/ὅπως. A participle's bare
    "as" is likewise temporal, not comparative."""
    assert leading_cue("so that no one will fall") == "CE"
    assert leading_cue("so that no one will fall", _PURPOSE_CUE_OVERRIDES) == "MEd"
    assert leading_cue("as jesus was walking beside the sea") == "Cmp"
    assert leading_cue("as jesus was walking beside the sea",
                       _PTCP_CUE_OVERRIDES) == "Tmp"


def test_opener_english_probes_the_connective_cell():
    """1 John 1:7 ἐὰν δέ … reads "But if we walk in the light": the segment's
    leading English is the δέ's "but", while the ἐάν's OWN cell holds the "if".
    For a single-word connective the cue can live there instead."""
    segs, _ = passage("1 John 1:7")
    protasis = segs[opened_by(segs, "ἐάν")]
    assert segment_english(protasis).startswith("but if we walk")
    assert opener_english(protasis) == "if"
    assert leading_cue(opener_english(protasis)) == "CndE"


# ---------------------------------------------------------------------------
# ὅτι — the cue is the PRIMARY test, the verbum-dicendi rule the fallback

def test_hoti_rendered_because_is_ground_over_the_dicendi_rule():
    """Mark 1:34 καὶ οὐκ ἤφιεν λαλεῖν τὰ δαιμόνια, | ὅτι ᾔδεισαν αὐτόν —
    "because they knew who He was". λαλέω stands in the preceding clause, so
    the dicendi heuristic alone would call this ὅτι the CONTENT of a saying;
    the BSB says it is the REASON, and the cue outranks the heuristic."""
    segs, _ = passage("Mark 1:34")
    i = opened_by(segs, "ὅτι")
    assert segment_english(segs[i]).startswith("because")
    assert _has_lemma(segs[i - 1], load_words(), VERBA_DICENDI), \
        "the fallback would have read this ὅτι as content"
    assert call_for(segs, i, precedes=False) == ("Grnd", False, True)


def test_hoti_rendered_that_is_content_over_the_causal_default():
    """Matt 16:12 τότε συνῆκαν | ὅτι οὐκ εἶπεν προσέχειν … — "then they
    understood that He was not telling them …". συνίημι is not on the
    verbum-dicendi list, so without the cue this ὅτι would fall to the causal
    Ground default. "that" says it is content."""
    segs, _ = passage("Matthew 16:12")
    i = opened_by(segs, "ὅτι")
    assert segment_english(segs[i]).startswith("that")
    assert not _has_lemma(segs[i - 1], load_words(), VERBA_DICENDI), \
        "the fallback would have read this ὅτι as causal"
    assert call_for(segs, i, precedes=False) == ("FtIn", False, True)
    # And it reaches the minimal document as the content of the understanding.
    doc = build_document(segs, confident_only=True)
    p = [{"kind": "prop", "ref": f"p{i}"} for i in (1, 2, 3)]
    assert doc["forest"] == [SUB("MEd", 1, SUB("FtIn", 1, p[0], p[1]), p[2])]


def test_both_hoti_of_matthew_13_16_are_causal():
    """μακάριοι οἱ ὀφθαλμοὶ | ὅτι βλέπουσιν | … ὅτι ἀκούουσιν — "because they
    see … because they hear". The SECOND one follows a clause containing
    βλέπω, another dicendi lemma, so it is the same trap as Mark 1:34 inside a
    single verse; both come out Ground."""
    segs, _ = passage("Matthew 13:16")
    assert [call_for(segs, i, precedes=False) for i in (1, 2)] == \
        [("Grnd", False, True), ("Grnd", False, True)]
    doc = build_document(segs, confident_only=True)
    p = [{"kind": "prop", "ref": f"p{i}"} for i in (1, 2, 3)]
    assert doc["forest"] == [SUB("Grnd", 0, SUB("Grnd", 0, p[0], p[1]), p[2])]


def test_hoti_with_no_english_falls_back_to_the_dicendi_rule():
    """Matt 9:18 … λέγων | ὅτι Ἡ θυγάτηρ μου ἄρτι ἐτελεύτησεν — the BSB drops
    the ὅτι and opens the quotation directly, which is the COMMON case in
    direct speech. No cue, so the verbum-dicendi heuristic decides, exactly as
    it did before this layer."""
    segs, _ = passage("Matthew 9:18")
    i = opened_by(segs, "ὅτι")
    assert _cue_call(segs[i], load_words(), _HOTI_CUE_RELS) is None
    assert call_for(segs, i, precedes=False) == ("FtIn", False, True)


# ---------------------------------------------------------------------------
# ὥστε + finite verb — the cue RESURRECTS a join that is otherwise undecidable

def test_hoste_finite_with_a_result_cue_joins_minimal():
    """Gal 2:13 … συνυπεκρίθησαν αὐτῷ … | ὥστε καὶ Βαρναβᾶς συναπήχθη — a
    FINITE ὥστε clause, which the ruling leaves out of minimal because grammar
    alone cannot tell the result use from the inferential one. "So that by
    their hypocrisy even Barnabas was led astray" settles it: sure C/E, and
    the minimal analysis now draws the bracket instead of two loose roots."""
    segs, _ = passage("Galatians 2:13")
    i = opened_by(segs, "ὥστε")
    assert segment_english(segs[i]).startswith("so that")
    assert call_for(segs, i, precedes=False) == ("CE", False, True)
    doc = build_document(segs, confident_only=True)
    assert doc["forest"] == [SUB("CE", 1, {"kind": "prop", "ref": "p1"},
                                 {"kind": "prop", "ref": "p2"})]


def test_hoste_finite_with_an_inference_cue_is_inference():
    """Rom 7:12 ὥστε ὁ μὲν νόμος ἅγιος — "So then, the law is holy". The
    grammars' inferential ὥστε, which the classifier could previously only
    guess at as C/E.

    NOTE the reach of this call: an inferential ὥστε usually OPENS its
    sentence (as here), and a sentence-initial dependent is held forward, so
    the relationship only materializes when the same sentence goes on to an
    independent clause. Between sentences the fold still uses the discourse
    table, which has no ὥστε entry."""
    segs, _ = passage("Romans 7:12")
    i = opened_by(segs, "ὥστε")
    assert segment_english(segs[i]).startswith("so then")
    assert call_for(segs, i, precedes=True) == ("Inf", False, True)


def test_hoste_finite_with_no_applicable_cue_is_unchanged():
    """John 3:16 … ὥστε τὸν υἱὸν τὸν μονογενῆ ἔδωκεν — the BSB renders it
    "that He gave His one and only Son". "that" is a cue, but not one ὥστε can
    carry (result or inference only), so nothing fires and the join keeps its
    best-guess C/E outside minimal."""
    segs, _ = passage("John 3:16")
    i = opened_by(segs, "ὥστε")
    assert segment_english(segs[i]).startswith("that")
    assert call_for(segs, i, precedes=False) == ("CE", False, False)


# ---------------------------------------------------------------------------
# ἵνα / ὅπως — the cue confirms or overrides the asking-verb list

def test_hina_cue_and_the_asking_verb_list_agree():
    """Phil 1:9 καὶ τοῦτο προσεύχομαι | ἵνα ἡ ἀγάπη ὑμῶν … περισσεύῃ. The verb
    list says content (προσεύχομαι is an asking verb) and the BSB's "that your
    love may abound" says the same — the two routes agree, which is the case
    the design expects to be normal."""
    segs, _ = passage("Philippians 1:9")
    i = opened_by(segs, "ἵνα")
    assert segment_english(segs[i]).startswith("that")
    assert _has_lemma(segs[i - 1], load_words(), ASKING_VERBS)
    assert call_for(segs, i, precedes=False) == ("FtIn", False, True)


def test_hina_cue_reaches_where_the_one_clause_lookback_cannot():
    """John 17:15 οὐκ ἐρωτῶ | ἵνα ἄρῃς … | ἀλλ' ἵνα τηρήσῃς … — BOTH ἵνα
    clauses are governed by ἐρωτῶ, but the verb list only sees the immediately
    preceding clause, so it read the second as purpose (expert-questions.md
    Open #8). The BSB writes "that" over both, and the cue gets it right
    without widening the look-back."""
    segs, _ = passage("John 17:15")
    assert call_for(segs, 1, precedes=False) == ("FtIn", False, True)
    assert segment_english(segs[2]).startswith("that")
    assert call_for(segs, 2, precedes=False) == ("FtIn", False, True)


def test_hina_rendered_so_that_is_purpose():
    """Heb 4:11 σπουδάσωμεν … | ἵνα μὴ … πέσῃ — "so that no one will fall".
    The per-trigger override: "so that" is result for ὥστε but purpose for
    ἵνα, and here it agrees with the no-asking-verb default."""
    segs, _ = passage("Hebrews 4:11")
    i = opened_by(segs, "ἵνα")
    assert segment_english(segs[i]).startswith("so that")
    assert call_for(segs, i, precedes=False) == ("MEd", False, True)


def test_hina_with_an_inapplicable_cue_falls_back_to_the_verb_list():
    """Phil 1:10–11 … | ἵνα ἦτε εἰλικρινεῖς — the BSB coordinates it, "and may
    be pure and blameless", so the leading cue is "and". Series is not a sense
    ἵνα can carry, so the cue is discarded and the verb-list rule decides:
    no asking verb in the preceding clause, therefore purpose."""
    segs, _ = passage("Philippians 1:9-11")
    i = [k for k, s in enumerate(segs)
         if s.opener is not None and s.opener.lemma == "ἵνα"][1]
    assert segment_english(segs[i]).startswith("and")
    assert call_for(segs, i, precedes=False) == ("MEd", False, True)


# ---------------------------------------------------------------------------
# ὡς — and only ὡς among the comparatives

def test_hos_rendered_when_is_temporal():
    """John 6:16 Ὡς δὲ ὀψία ἐγένετο | κατέβησαν οἱ μαθηταὶ αὐτοῦ — "When
    evening came, His disciples went down to the sea". A narrative ὡς, not a
    comparison. Sentence-initial, so it reaches the assembler as a HELD
    protasis rather than through the dependent-call path — the cue is consulted
    there too, and the minimal document draws Temporal."""
    segs, _ = passage("John 6:16")
    i = opened_by(segs, "ὡς")
    assert segment_english(segs[i]) == "when evening came"
    assert call_for(segs, i, precedes=True) == ("Tmp", False, True)
    doc = build_document(segs, confident_only=True)
    assert doc["forest"] == [SUB("Tmp", 1, {"kind": "prop", "ref": "p1"},
                                 {"kind": "prop", "ref": "p2"})]


def test_hos_rendered_as_stays_comparison():
    """1 John 1:7 … ἐν τῷ φωτὶ περιπατῶμεν | ὡς αὐτός ἐστιν ἐν τῷ φωτί — "as
    He is in the light". The comparative reading is both the cue's and the
    default, so the 1 John golden is untouched."""
    segs, _ = passage("1 John 1:7")
    i = opened_by(segs, "ὡς")
    assert segment_english(segs[i]) == "as he is in the light"
    assert call_for(segs, i, precedes=False) == ("Cmp", False, True)


def test_other_comparatives_keep_their_grammar_forced_comparison():
    """καθώς/ὥσπερ/καθάπερ/ὡσεί are unambiguous, so the cue layer never asks
    them — and it would not change anything if it did: no non-ὡς comparative
    in the corpus draws a cue other than Comparison. Heb 4:10's ὥσπερ is the
    worked example, rendered "just as"."""
    segs, _ = passage("Hebrews 4:10")
    i = opened_by(segs, "ὥσπερ")
    assert segment_english(segs[i]).startswith("just as")
    assert call_for(segs, i, precedes=False) == ("Cmp", False, True)


# ---------------------------------------------------------------------------
# Adverbial participles — the cue outranks the tense/position defaults (5–11)
# but not the grammar-forced rules (1–4)

def test_participle_rendered_although_is_adversative():
    """Matt 14:5 καὶ θέλων αὐτὸν ἀποκτεῖναι | ἐφοβήθη τὸν ὄχλον — "Although
    Herod wanted to kill John, he was afraid of the people". A concessive
    participle with NO καίπερ: chart rule 10 (present participle before its
    clause) would read it Temporal, and nothing in the morphology says
    otherwise. The translators' "although" does."""
    segs, _ = passage("Matthew 14:5")
    i = opened_by(segs, "θέλω")
    assert _segment_participle(segs[i], load_words()).tense == "P"   # → rule 10
    assert segment_english(segs[i]).startswith("although")
    assert call_for(segs, i, precedes=True) == ("Adv", False, True)
    doc = build_document(segs, confident_only=True)
    p = [{"kind": "prop", "ref": f"p{i}"} for i in (1, 2, 3)]
    assert doc["forest"] == [SUB("Adv", 1, p[0], SUB("Grnd", 0, p[1], p[2]))]


def test_participle_rendered_by_doing_is_means():
    """Matt 27:66 οἱ δὲ πορευθέντες ἠσφαλίσαντο τὸν τάφον | σφραγίσαντες τὸν
    λίθον — "by sealing the stone and posting the guard". An aorist participle
    FOLLOWING its clause is the shape the Wallace/Keating chart gives no rule
    for, so it falls to the residual Temporal (expert-questions.md Open #4).
    The cue answers the question for this instance: Means."""
    segs, _ = passage("Matthew 27:66")
    i = opened_by(segs, "σφραγίζω")
    assert _segment_participle(segs[i], load_words()).tense == "A"   # → rule 11
    assert call_for(segs, i, precedes=False) == ("WEd", False, True)


def test_participle_rendered_when_beats_attendant_circumstance():
    """Acts 2:37 Ἀκούσαντες δὲ | κατενύγησαν τὴν καρδίαν — "When the people
    heard this, they were cut to the heart". Aorist participle before an
    aorist indicative fires the chart's five-feature test (rule 7), which
    coordinates the two actions as Series; the student's diagram reads
    Temporal, and so does the BSB. This is expert-questions.md Open #5 (the
    attendant-circumstance scope) answered case by case."""
    segs, _ = passage("Acts 2:37")
    i = opened_by(segs, "ἀκούω")
    assert segment_english(segs[i]).startswith("when")
    assert call_for(segs, i, precedes=True) == ("Tmp", False, True)


def test_participle_cue_does_not_outrank_the_grammar_forced_rules():
    """Matt 18:25 μὴ ἔχοντος δὲ αὐτοῦ ἀποδοῦναι — a GENITIVE ABSOLUTE, which
    chart rule 2 calls Temporal. The BSB reads it causally ("since the man was
    unable to pay") and the cue layer sees that, but rules 1–4 are
    grammar-forced and come first."""
    segs, _ = passage("Matthew 18:25")
    i = opened_by(segs, "ἔχω")
    assert _cue_call(segs[i], load_words(), _PTCP_CUE_RELS,
                     _PTCP_CUE_OVERRIDES) == "Grnd"
    assert call_for(segs, i, precedes=True) == ("Tmp", False, True)


def test_participle_as_is_temporal_not_comparative():
    """A leading bare "as" in front of an English participial clause is the
    temporal "as" ("as Jesus was walking beside the sea"), not the comparative
    the cue table's "as " means for a finite ὡς clause. Reading those 75-odd
    corpus participles as Comparisons would be plainly wrong, so the trigger
    remaps the phrase."""
    segs, _ = passage("Matthew 4:18")
    i = opened_by(segs, "περιπατέω")
    assert segment_english(segs[i]).startswith("as jesus was walking")
    assert call_for(segs, i, precedes=True) == ("Tmp", False, True)


# ---------------------------------------------------------------------------
# Where the cue is deliberately NOT applied

def test_contrastive_cue_is_detected_but_never_acted_on():
    """Mark 4:11 … | ἐκείνοις δὲ τοῖς ἔξω … — "But to those on the outside".
    The δέ is contrastive and the layer can see it, but WHICH contrary
    relationship it marks (Neg/Pos, Alternative, Adversative) is
    expert-questions.md Open #1. Until the expert rules, δέ keeps its Series
    default and the document is unchanged."""
    segs, _ = passage("Mark 4:11")
    de = [s for s in segs if s.opener is not None and s.opener.lemma == "δέ"]
    assert len(de) == 1 and contrastive_cue(de[0], load_words())
    doc = build_document(segs, confident_only=True)
    p = [{"kind": "prop", "ref": f"p{i}"} for i in (1, 2, 3)]
    assert doc["forest"] == [SER(SER(p[0], p[1]), p[2])]


def test_bare_alla_with_a_but_cue_stays_out_of_minimal():
    """John 7:44 ἤθελον δέ τινες ἐξ αὐτῶν πιάσαι αὐτόν, | ἀλλ' οὐδεὶς ἐπέβαλεν
    … — "but no one laid a hand on Him". No negation in the preceding clause,
    so this is the BARE ἀλλά the ruling leaves undecidable, and the "but" cue
    only confirms the contrast we already knew about. Open #1 again: detected,
    not acted on — Full draws the Neg/Pos, minimal still does not."""
    segs, _ = passage("John 7:44")
    alla = [s for s in segs if s.opener is not None and s.opener.lemma == "ἀλλά"]
    assert len(alla) == 1 and contrastive_cue(alla[0], load_words())
    p1, p2 = ({"kind": "prop", "ref": "p1"}, {"kind": "prop", "ref": "p2"})
    assert build_document(segs)["forest"] == [SUB("NegPos", 1, p1, p2)]
    assert build_document(segs, confident_only=True)["forest"] == [p1, p2]


def test_implicit_proposition_pps_take_no_cue():
    """Eph 1:14 εἰς ἀπολύτρωσιν τῆς περιποιήσεως — the BSB writes "until the
    redemption of those who are God's possession", a clean Temporal cue. The
    layer ignores it: expert-questions.md Open #3 is whether the implied
    PROPOSITION is drawable at all, not which relation it would take, so the
    PP keeps its by-preposition guess outside minimal."""
    segs, _ = passage("Ephesians 1:14")
    i = [k for k, s in enumerate(segs)
         if s.opener is not None and s.opener.kind == "pp"][0]
    assert segment_english(segs[i]).startswith("until")
    assert _dependent_call(segs[i], i, segs, load_words(), precedes=False) == \
        ("MEd", True, False)
