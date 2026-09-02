# English-cue disambiguation — IMPLEMENTED (`da/treebuild.py`)

The DA expert's insight: the aligned English translation tells us WHICH SENSE
of an ambiguous Greek connective or participle the context carries — the
translators already did the interpretive work the Interpretive Lexicon
describes. If ὅτι is rendered "that" (or opens direct speech) it is Ft/In;
rendered "because" it is Ground. If a participle is rendered "if …" the
relation is Conditional; "in order to …" Means–End; "with the result …"
Cause–Effect; "because …" Ground; "although …" Adversative.

> **Status: built**, and amended by the rulings of 2026-08-29 (Q1, Q3, Q9).
> `segment_english` / `leading_cue` / `opener_english` live in
> `da/treebuild.py`; the per-trigger wiring is in `_dependent_call`,
> `_purpose_call` and `_participle_call`. (There is no separate
> `_protasis_rel`: forward-attaching clauses go through `_dependent_call` like
> everything else.) The suite is `da/tests/test_english_cues.py` (37 tests,
> every expectation read off real corpus verses). Deviations from the draft
> below are listed at the end.

## Data source

`da/corpus/interlinear.py` — the BSB interlinear alignment gives every corpus
word its contextual English (`english_for(index)`) in BSB word order
(`english_order`). Supplied words appear in square brackets and COUNT as cue
text ("[if]" is a cue). Coverage 99.6%; a segment with no aligned English
falls back to the grammar-only rules.

## Mechanism

For a dependent segment (or its opener word), take the BSB English of the
segment's words, sorted into BSB order, lowercased, brackets stripped, and
match the LEADING cue phrase (longest match first). The cue decides the
relationship; grammar-forced rules still outrank it (καίπερ, genitive
absolute, future participle, λέγων, articular-infinitive prepositions), and
the tense/position defaults apply only when no cue matches.

`segment_english` groups the segment's words by VERSE before sorting, because
`english_order` keys are the upstream table's global row numbers and are only
comparable within one verse; the groups are then concatenated in corpus order.

## Cue table (as built)

| Leading English of the segment | Relationship |
|---|---|
| "if", "unless" | CndE |
| "in order to", "in order that" | MEd |
| "with the result", "so as to", "as a result" | CE |
| "so that" | CE for ὥστε; **MEd for ἵνα/ὅπως** (per-trigger override) |
| "because", "since", "for " | Grnd |
| "therefore", "so then" | Inf |
| "although", "though", "even though", "despite" | Adv |
| "when", "as soon as", "while", "after", "before", "until", "whenever" | Tmp |
| "where", "wherever" | Loc |
| "by " + gerund (means) | WEd |
| "just as", "as " | Cmp — but **Tmp for a participle** (per-trigger override) |
| "that" | FtIn — for ἵνα/ὅπως only with corroboration (RULING Q9, below) |
| "and", "also", "now" | Ser |
| "but", "yet" | Alt — **δέ only** (RULING Q1) |
| "because of", "on account of", "for the sake of" | Grnd — the PP phrases (RULING Q3) |

Every trigger declares the senses it will ACCEPT, and a cue outside that set
is simply no cue. That is what fences the contrastive rows to δέ: `Alt` is in
no other trigger's set, so a leading "but" in front of a participle or a ὅτι
is matched and discarded exactly as it was before the rows existed.

Matching is leading-anchored, longest-phrase-first, and word-boundary anchored
— which is exactly what the draft's trailing spaces ("for ", "as ", "by ")
encoded: "for" fires, "forgive" does not.

## Where it applies (per trigger, as built)

- **ὅτι**: the cue is the PRIMARY test — "that" → Ft/In, "because"/"since"/
  "for" → Ground. The verbum-dicendi heuristic is the FALLBACK, which is what
  runs in the common direct-speech case where the BSB drops the ὅτι and simply
  opens the quotation. Both routes sure.
- **Adverbial participles**: the cue outranks chart rules 5–11 (the
  tense/position defaults) and is outranked by rules 1–4 (καίπερ, genitive
  absolute, future → purpose, λέγων). Senses accepted: CndE, MEd, CE, Grnd,
  Adv, Tmp, WEd, Cmp — Series is deliberately absent, since an "and" is no
  evidence for attendant circumstance and rule 7 owns that call (and RULING
  Q5 has narrowed rule 7 to the aorist-imperative shape). 517 of the corpus's
  3,889 participle segments draw a cue.
- **ὥστε + finite verb**: out of minimal by the ruling, and the cue
  RESURRECTS it — "so that"/"with the result"/"so as to"/"as a result" → sure
  C/E; "therefore"/"so then" → sure Inference; no cue → unchanged (C/E, out of
  minimal). ὥστε + infinitive is grammar-forced and untouched.
- **ἵνα/ὅπως** (`_purpose_call`): the cue overrides the asking-verb list —
  "so that"/"in order that"/"in order to" → M/Ed outright, and "that" →
  Ft/In **only with CORROBORATION** (RULING Q9): a communication or volition
  verb in the preceding clause, `COMMUNICATION_VOLITION` = `VERBA_DICENDI` ∪
  `ASKING_VERBS` ∪ {θέλω, βούλομαι, ζητέω, ἐντέλλομαι, ἐπιτάσσω,
  διαστέλλομαι, παραγγέλλω, συμβουλεύω, ἀφίημι} (DRAFT, awaiting review like
  `ASKING_VERBS`). English writes purpose clauses with an archaic "that" too,
  and the phrase alone cannot tell the two apart; the governing verb can.
  Corpus-wide the "that" cue reaches 90 ἵνα clauses, of which 23 are
  corroborated and fire; the other 67 keep the purpose default — John 3:16
  among them. No applicable cue → the verb-list rule as before. The RULING Q7
  sibling rule runs BEFORE all of this: a ἵνα with a coordinator directly in
  front of it inherits an earlier sibling ἵνα's call in the same sentence.
- **ὡς** (and only ὡς among the comparatives): "just as"/"as" → Cmp,
  "when"/"while" → Tmp, "that" → Ft/In; no cue → Cmp. POSITION narrows the
  set: a ὡς clause that PRECEDES its main clause (the held, forward-attaching
  case) drops Ft/In, since the content use follows the verb that governs it.
  `_dependent_call` makes that call from the `precedes` flag it is already
  passed — there is no separate protasis path.
- **δέ** (RULING Q1): the contrastive rows exist for this trigger alone. A δέ
  the BSB renders "but" or "yet" is setting one thing against another rather
  than carrying the account onward, and the relationship the expert names for
  that is **Alternative** — sure, like every other δέ call; anything else
  keeps the Series default. 742 of the corpus's 1,454 δέ joins draw the cue.
  **Bare ἀλλά takes NO cue**: it is also an Alternative now (RULING Q1, in
  minimal), but that reading is made from the GRAMMAR — is there a negation in
  the clause in front of it? — and the BSB's "but" only restates the contrast
  the ἀλλά already announced. 118 of 233 ἀλλά joins are bare.
- **Implicit-proposition PPs** (RULING Q3): the cue now applies. Accepted
  senses are the adverbial ones a bare phrase can carry — Grnd, MEd, Tmp, Loc,
  WEd, CndE — plus the PP phrases added to the table above; the
  per-preposition defaults (`_PP_REL`) stand where no cue fires. The TIER is
  unchanged: a PP is still never sure, because what keeps it out of minimal is
  whether the implied PROPOSITION is drawable at all, which the cue does not
  speak to. 52 of the corpus's 318 PP segments draw a cue, and 29 of those
  change the relationship (Eph 1:14's εἰς ἀπολύτρωσιν, "until the redemption",
  M/Ed → Tmp).

## Cautions

- The BSB is one translation; a cue reflects its translators' reading. That
  is exactly what we want for defaults, but it is a READING — the tier for
  cue-derived calls is the sensible-default tier (joins minimal), not
  grammar-forced certainty.
- Cue matching must be leading-anchored and phrase-longest-first ("in order
  to" before "to", "so as to" before "so").
- English word order differs from Greek; always assemble the segment's
  English in BSB order before matching.

## Deviations from the draft design, and what the data forced

1. **The quotation test is dropped.** The draft made "the next words open a
   quotation" a Ft/In cue for ὅτι. The BSB interlinear's word-level cells
   carry essentially NO quotation marks: 136,949 cells hold three `”` and two
   `“`, all of them scare-quotes around a glossed word (`“Sent”`,
   `“Teacher”`). The quotation marks live only in the BSB's running-text
   verses, not in the per-word alignment, so there is nothing to test. The
   direct-speech case is covered instead by the existing fallbacks — the
   verbum-dicendi heuristic inside a sentence and the dicendi + `·` rule
   across one — which is what already fires for Matt 9:18's ὅτι.
2. **"as " is temporal in front of a participle.** The draft qualified the
   bare "as " cue as "(comparative context)". A finite ὡς clause is that
   context; an English participial clause is not — "as Jesus was walking
   beside the sea", "as they were coming down the mountain" are temporal, and
   reading the corpus's 75 such participles as Comparisons would be plainly
   wrong. The participle trigger therefore remaps "as" → Tmp. "just as" is
   untouched: that one really is comparative.
3. **"as soon as" added to the table** (→ Tmp). Unambiguously temporal, and
   longer than the bare "as" it would otherwise be swallowed by.
4. **"by " requires a gerund.** The draft wrote "by " + -ing; enforced
   literally, because "by the word of the Lord" (1 Thess 4:15) is an
   instrument inside a clause, not a Means relationship.
5. **Curly braces are stripped like square brackets.** The BSB marks some
   supplied English with `{do}` / `{let}` rather than `[the]`; same device,
   same treatment.
6. **Continuation markers are dropped.** ~4,000 cells hold only ". . .",
   which is how the BSB says "this word's English is in a neighbouring cell".
   They carry no cue and would block every leading match, so a cell with no
   letters or digits contributes nothing.
7. **The sentence-initial ὥστε is only half reachable.** An inferential ὥστε
   usually OPENS its sentence (Rom 7:12, 1 Thess 4:18). A sentence-initial
   dependent is HELD by `_assemble_sentence` — the generic held branch, the
   same one every forward-attaching clause takes — and the held packet only
   becomes a bracket if that sentence continues to an independent clause;
   a hold left dangling at sentence end is returned as its bare packet.
   Between sentences the fold still uses the discourse table
   (`_sentence_join`), which has no ὥστε entry. Carrying a dangling hold
   forward is `expert-questions.md` Open #14, not part of this change.

## Known costs — for the expert

- **ἵνα rendered with the archaic purpose-"that" — FIXED by RULING Q9.** John
  3:16 (`ἵνα … μὴ ἀπόληται`, "that everyone who believes in Him shall not
  perish") is purpose, and the BSB's "that" used to make the cue call it
  content. The expert's answer to "should 'that' require corroboration?" is
  YES: a communication or volition verb in the preceding clause. Measured
  after the change — the "that" cue reaches 90 ἵνα clauses, 23 of them
  corroborated (Mark 5:43 διεστείλατο ἵνα …, Matt 20:21 εἰπὲ ἵνα …, Luke
  22:32 ἐδεήθην … ἵνα …, all still content) and 67 uncorroborated, which now
  keep the purpose default. John 3:16 reads M/Ed again.
- **A postpositive's English can lead the segment.** A participle segment that
  opens its sentence swallows the postpositive γάρ that follows it, so its
  assembled English can begin "For …" and draw a Ground cue that belongs to
  the γάρ, not the participle (Heb 4:12 Ζῶν γάρ …). Seven cases corpus-wide;
  left alone rather than adding machinery for it.
- **ἐπεί is not a cue trigger** and stays Temporal from the lemma table even
  where the BSB reads it causally (Matt 21:46 "because the people regarded him
  as a prophet"). Extending the layer to the temporal subordinators is a
  candidate for the next round.

## Effect, measured

Over all 260 NT chapters the layer relabels **1,078 of the 26,417 brackets**
the full analysis draws (4.1%), up from 614 before the 2026-08-29 rulings
widened it to δέ (RULING Q1) and to implicit-proposition PPs (RULING Q3). The
largest classes: the contrastive δέ (742 of 1,454 δέ joins Ser → Alt), ὅτι
content the one-clause dicendi look-back missed (Grnd → Ft/In), participles
the BSB reads temporally (W/Ed → Tmp), causal ὅτι the dicendi rule over-read
(Ft/In → Grnd), and the PPs (29 of the 52 that draw a cue take a different
relationship from their preposition's default). Minimal is 16,718 brackets
with the layer against 16,722 without it — the layer moves labels rather than
tiers, since a cue-derived call carries its trigger's own tier.

Against the worked diagrams the layer gains Acts 2:37's Temporal on
Ἀκούσαντες (the student's reading, which chart rule 7 had been coordinating)
and, with RULING Q1, 1 John 1:7's Alternative between the two ἐάν sentences —
the `alt` bracket the DA1 student drew.
