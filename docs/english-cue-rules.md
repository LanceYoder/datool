# English-cue disambiguation — IMPLEMENTED (`da/treebuild.py`)

The DA expert's insight: the aligned English translation tells us WHICH SENSE
of an ambiguous Greek connective or participle the context carries — the
translators already did the interpretive work the Interpretive Lexicon
describes. If ὅτι is rendered "that" (or opens direct speech) it is Ft/In;
rendered "because" it is Ground. If a participle is rendered "if …" the
relation is Conditional; "in order to …" Means–End; "with the result …"
Cause–Effect; "because …" Ground; "although …" Adversative.

> **Status: built.** `segment_english` / `leading_cue` / `opener_english`
> live in `da/treebuild.py`; the per-trigger wiring is in `_dependent_call`
> and `_participle_call`. (There is no `contrastive_cue` and no "but"/"yet"
> row in the cue table — see the δέ / bare-ἀλλά entry below — and no separate
> `_protasis_rel`: forward-attaching clauses go through `_dependent_call` like
> everything else.) The suite is
> `da/tests/test_english_cues.py` (33 tests, every expectation read off real
> corpus verses). Deviations from the draft below are listed at the end.

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
| "that" | FtIn |
| "and", "also", "now" | Ser |
| _(no "but"/"yet" row)_ | contrastive: NOT A CUE — see Open #1 |

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
  evidence for attendant circumstance and rule 7 owns that call. 516 of the
  corpus's 3,889 participle segments draw a cue.
- **ὥστε + finite verb**: out of minimal by the ruling, and the cue
  RESURRECTS it — "so that"/"with the result"/"so as to"/"as a result" → sure
  C/E; "therefore"/"so then" → sure Inference; no cue → unchanged (C/E, out of
  minimal). ὥστε + infinitive is grammar-forced and untouched.
- **ἵνα/ὅπως**: the cue overrides the asking-verb list in both directions —
  "that" → Ft/In, "so that"/"in order that"/"in order to" → M/Ed; no
  applicable cue → the verb-list rule as before.
- **ὡς** (and only ὡς among the comparatives): "just as"/"as" → Cmp,
  "when"/"while" → Tmp, "that" → Ft/In; no cue → Cmp. POSITION narrows the
  set: a ὡς clause that PRECEDES its main clause (the held, forward-attaching
  case) drops Ft/In, since the content use follows the verb that governs it.
  `_dependent_call` makes that call from the `precedes` flag it is already
  passed — there is no separate protasis path.
- **δέ and bare ἀλλά**: the table carries NO contrastive row, so the BSB's
  "but"/"yet" is not matched at all. δέ keeps its Series default; a bare ἀλλά
  stays Neg/Pos out of minimal. See `expert-questions.md` Open #1 — which
  contrary relationship a "but" marks is the unruled question, so detecting
  one would buy nothing.
- **Implicit-proposition PPs**: no cue, by decision — Open #3 is whether the
  implied proposition is drawable at all, not which relation it would take.

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

- **ἵνα rendered with the archaic purpose-"that".** John 3:16 (`ἵνα … μὴ
  ἀπόληται`, "that everyone who believes in Him shall not perish") is
  purpose, but the BSB's "that" makes the cue call it content. Corpus-wide the
  "that" cue moves 78 ἵνα clauses from purpose to content, and sampling says
  the MAJORITY are genuine content clauses the narrow draft ASKING_VERBS list
  misses (Matt 20:21 εἰπὲ ἵνα …, Mark 5:43 διεστείλατο ἵνα …, Mark 6:12
  ἐκήρυξαν ἵνα …, Luke 22:32 ἐδεήθην … ἵνα …), with the archaic purpose-"that"
  the minority. Kept as the design specifies. **Question:** should "that"
  require corroboration — an asking/commanding verb anywhere in the sentence —
  before it outranks the purpose default?
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

Over all 260 NT chapters, the layer relabels 614 of the ~26,400 brackets the
full analysis draws (2.3%) and adds 3 brackets to minimal (the resurrected
ὥστε clauses). The largest classes: ὅτι content the one-clause dicendi
look-back missed (166 Grnd → Ft/In), participles the BSB reads temporally
(96 Ser → Tmp, from the attendant-circumstance rule, and 80 W/Ed → Tmp),
ἵνα content (78 M/Ed → Ft/In), and causal ὅτι the dicendi rule over-read
(41 Ft/In → Grnd). Against the worked diagrams it gains Acts 2:37's Temporal
on Ἀκούσαντες — the student's reading, which chart rule 7 had been
coordinating as attendant-circumstance Series.
