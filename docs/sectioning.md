# Sectioning — big–small–big relationship generation

> **Status: IMPLEMENTED** (`da/treebuild.py`, tests in
> `da/tests/test_sectioning.py`). The pipeline below is what runs; the
> deviations from the approved design, and the calibration questions the
> build raised, are listed under *As built* at the end.

Ruled by the DA expert (see expert-questions.md, DECIDED): before
relationship generation, chunk the passage into its major logical sections;
connect segment-to-segment WITHIN each section until the section is
internally complete; then connect the sections to each other. Everything
inside a section connects before the section connects outward.

## Pipeline

1. **Seam detection (surface signals).** Score each SENTENCE boundary of the
   passage with the indicators below; boundaries at or above threshold become
   section seams. A section is the sentence run between seams. (Sections are
   made of whole sentences; within-sentence assembly is untouched.)
   *Built as* `_sentence_marks` (corpus → `_SentenceMarks`) feeding `_seams`
   (marks → seam list), kept apart so the scorer is pure and pinnable.
2. **Small: within-section fold.** Run the existing sentence fold
   (treebuild.`_fold_sentences`) per section instead of over the whole
   passage. *Built as* a slice: `_fold_sentences(sentence_packets[lo:hi+1])`.
3. **Promotion pass (the one structure-dependent indicator).** A γάρ/ὅτι
   ("because") span whose support develops ACROSS A SENTENCE BOUNDARY is
   itself section-sized: where the within-fold reveals that shape, split it
   out as its own section. *Built as* `_promoted` (RULING Q10 — see *As
   built* #6, which states the qualifying test and the causal-ὅτι half
   precisely).
4. **Big: section fold.** Fold the section packets left to right with the
   same join logic (the section-opening sentence's connective decides the
   relationship, exactly as sentence joins do today), producing one tree.
   *Built as* the same `_fold_sentences`, over section packets: a `_Packet`
   carries the sentence at each of its ends, so `_sentence_join` still sees a
   real "previous sentence" and a real "next sentence" and its table is used
   once, not twice.

## Approved indicators (initial implementation)

As shipped, `SEAM_WEIGHTS` in `da/treebuild.py` — one entry per indicator,
threshold 1, so adding a further indicator is a line there plus its
detection. The expert's five of the first round, plus RULING Q8's b–h and
RULING Q12's re-weighting of the English period:

| Indicator | Weight | Signal | Data |
|---|---|---|---|
| Section heading | 2 (hard) | seam before the heading's word (translators' pericope division) | BSB `Hdg` markers |
| Direct/indirect discourse — begin | 2 (hard) | seam at speech begin; the speech verb (dicendi clause, λέγων line included) belongs WITH the upcoming speech's section | BSB `Q+` + dicendi machinery |
| Direct/indirect discourse — end | 2 (hard) | seam at the sentence AFTER the one the quotation closes in | BSB `Q-` |
| Paragraph break | 1 (strong) | seam before the paragraph's first word | BSB `Par` markers |
| οὖν | 1 (strong) | seam before the οὖν sentence — "basically always a transition between chunks of logic" | lemma, first three words |
| **Vocative** (Q8 b) | 1 (strong) in the EPISTLES, 0.5 (soft) elsewhere | a vocative noun/adjective in the sentence's first three words — "Ἀδελφοί μου, …" is how a letter turns to its next topic; in a Gospel it is usually someone being addressed inside a scene | MorphGNT case `V`, pos `N-`/`A-` |
| **διό / διὰ τοῦτο** (Q8 c) | 1 (strong) | the inferential transition, detected like οὖν (first three words, so a postpositive may stand in front) | lemmas διό, διά + οὗτος |
| **Narrative scene-setter** (Q8 d) | 1 (strong), NARRATIVE books only | μετὰ ταῦτα / μετὰ δὲ ταῦτα · ἐν (ἐκείναις) ταῖς ἡμέραις (either order) · καὶ ἐγένετο / ἐγένετο δέ · τότε · or a sentence-initial GENITIVE ABSOLUTE | lemmas, first five words; `_genitive_absolute` on the first segment |
| **Rhetorical-question opener** (Q8 g) | 1 (strong) | the sentence ENDS on the Greek `;` AND OPENS with an interrogative (τίς/πῶς/ποῦ/πότε, which covers διὰ τί) in its first two words — both halves required, or every question inside a dialogue would seam | word text + lemmas |
| **Mood/person shift** (Q8 e) | 0.5 (soft) | the new sentence's first finite verb is an imperative and the previous sentence had none, or a sustained person shift (previous sentence all 3rd person, new one opens 2nd) | MorphGNT mood/person |
| **Epistolary asyndeton** (Q8 f) | 0.5 (soft), EPISTLES only | the connective scan (`_sentence_connective`, shared with `_sentence_join`) finds nothing at the sentence start | lemmas |
| **Lexical-cohesion drop** (Q8 h) | 0.5 (soft) | not one content lemma in common with the previous sentence (content = noun/verb/adjective lemma, minus the connective tables'); a set per sentence, intersected once | pos codes + lemmas |
| English period (Q12) | 0.5 (soft) | raises the likelihood of a seam after the sentence | BSB verse text |
| γάρ/ὅτι + development | — | a because-block that runs on into a following sentence becomes its own section | promotion pass (step 3) |

Weighting: HARD (2) and STRONG (1) indicators seam on their own; SOFT ones
never do — RULING Q12's "never a seam alone; it needs a companion indicator"
— and two softs together are exactly that companion, 0.5 + 0.5 = 1. That is
also the answer to how the softs combine.

**Genre.** Three of the indicators are genre-sensitive, so `da/treebuild.py`
carries a `GENRE` table mapping book number → `narrative` (1–5, the four
Gospels and Acts, plus 27: **Revelation counts narrative** — μετὰ ταῦτα
scene-setters run through it and epistolary asyndeton is not a division
marker there, the seven letters of chapters 2–3 being the exception that
costs) or `epistle` (6–26, Romans through Jude). Detection switches the
genre-only indicators off outright (a scene-setter is not an indicator in a
letter, asyndeton not one in a Gospel); the vocative is the one graded twice,
so the scorer reads it off the `epistle` flag and scores `vocative` or
`vocative_soft`.

Still future work: **inclusio** — the expert accepted it with the cohesion
shift (Q8 h), but recognizing that a passage RETURNS to its opening
vocabulary needs a span-level test rather than a boundary-level one, and the
scorer's contract is boundary-level. It is not built.

## Data: bsb-structure.tsv

Extracted from the BSB interlinear tables (bereanbible.com, public domain),
joined to corpus word indices through the existing BSB word alignment
(bsb-word-english.tsv's order keys):

    corpus_index<TAB>marks

where marks is a comma-separated subset of: `P` (a paragraph begins at this
word), `H:<text>` (a section heading stands before this word), `Q+` (a
quotation opens at this word), `Q-` (a quotation closes after this word).
Loader: da/corpus/structure.py.

## As built — deviations and decisions

1. **The minimal tier is not gated by seams.** The design said "a sure
   default join never crosses a seam in minimal". As shipped, section-fold
   joins carry their NORMAL tiers, so a sure section join (γάρ → Ground, οὖν
   → Inference, asyndeton → Series) does appear in minimal. What sectioning
   changes is the SHAPE of minimal, not the tier of any join: a within-fold
   join cannot span a seam *by construction*, so minimal's brackets now
   respect the sections. The invariant is asserted in
   `test_a_within_section_join_never_spans_a_seam` — every bracket either
   lies inside one section or pairs whole sections.
2. **A quotation never splits a sentence.** `Q+` is read over the WHOLE
   sentence, not just its first word: a quotation opening mid-sentence means
   the speech section starts at that sentence, dicendi opener and all.
3. **The speech verb rides with its speech.** When the sentence before a
   quotation is a dicendi sentence, the seam MOVES back over it and the
   boundary between introduction and speech stops being a seam — even when
   that boundary carries its own paragraph mark, which it usually does (the
   BSB starts long quotations on a new line). The dicendi test is the
   existing `VERBA_DICENDI` + `·` machinery widened from the last WORD to the
   last SEGMENT, so Matt 3:7's "εἶπεν αὐτοῖς·" counts, and λέγων/λέγοντες
   needs no branch of its own (λέγω is already a verbum dicendi).
   Both former misses are now covered by RULING Q11. (a) The βοάω class —
   βοάω, κράζω, ἀνακράζω, κραυγάζω, φωνέω, ἐπιφωνέω — is in `VERBA_DICENDI`,
   so Matt 3:3's "Φωνὴ βοῶντος ἐν τῇ ἐρήμῳ·" introduces its Isaiah quotation
   (28 sentences gained corpus-wide). (b) An ELIDED speech verb — Acts 2:38
   "Πέτρος δὲ πρὸς αὐτούς·", "And Peter [said] to them" — counts as a speech
   introduction when the sentence ends on '·', has NO FINITE VERB AT ALL, and
   the NEXT sentence carries a `Q+` mark: a verbless clause is no evidence of
   speech by itself, so the ruling requires the direct speech to actually
   follow (51 sentences gained). 2,033 speech introductions in all, against
   1,954 before.
   **One test now serves the seam AND the join.** `_sentence_join` used to ask
   a narrower question — is the sentence's LAST WORD a verbum dicendi? — so a
   sentence the seam treated as a speech introduction could still join its
   speech as a Series ("καὶ ἔλεγεν αὐτοῖς·" ends on αὐτοῖς). Q11(b) requires
   the elided case to produce the Ft/In join, and rather than keep two
   disagreeing tests the join now calls `_dicendi_sentence` too. That is the
   DECIDED ruling "speech openings → always Ft/In, in minimal" applied
   consistently; it turns 1,167 inter-sentence joins corpus-wide from Series
   into the Ft/In over the speech content.
4. **Quote REOPENS count as begins.** The `Q-` data is sparse (whole-NT:
   thousands of opens against hundreds of closes — reopens plus unmarked
   closes), so tracking an open/closed state across a passage would be
   unreliable; every `Q+` is read as a speech begin. In practice a reopen
   sits at a paragraph start, which is a seam anyway.
5. **The English period is a SOFT vote (RULING Q12: weight 0.5).** The BSB
   interlinear cells carry no punctuation, so the signal is read at VERSE
   granularity from `bsb-nt.tsv`: true when the Greek sentence ends on the
   last word of its verse and that verse's English ends on a full stop —
   coarser than the design's "English sentence period", which is part of why
   it is soft. It never tips a boundary alone; it reaches the threshold
   beside another soft indicator, which is what the ruling means by "it needs
   a companion".
6. **The promotion pass, precisely (RULING Q10).** The because-block is the
   because-sentence plus the sentences the fold would Ser-chain onto it; BOTH
   its ends become seams, so the block really does become "its own section
   packet". Two kinds of "because" open one:

   * a **sentence-level Ground** from `_sentence_join` — in practice γάρ, the
     only "because" that reaches the inter-sentence table;
   * a **causal ὅτι inside the sentence**, detected by `_causal_hoti_sentence`
     — it walks the sentence's own segments, and for each ὅτι segment asks
     `_dependent_call` (the very call the assembly made) whether it came out
     Ground. That the ground's content really does run to the sentence's end,
     and so is what the following Ser-chained sentences continue, is a
     property of the fold rather than an assumption: a ὅτι clause is
     subordinate, and `_edge_join` descends the packet's right edge, so every
     coordinate clause after the ὅτι lands INSIDE the ground.

   **The block must CROSS A SENTENCE BOUNDARY** (`end > i`). The first
   implementation also promoted a single sentence whose own packet held a
   coordinate or a Ft/In, which in argumentative prose is nearly every γάρ —
   a Pauline ground almost always coordinates something — and Romans 8 came
   out in 20 sections. Mere within-sentence coordination is no longer a
   section. One level only: promoted sections are not re-examined. Measured
   corpus-wide: 50 γάρ blocks and 115 causal-ὅτι blocks qualify, adding 122
   sections (6,146 → 6,268), where the old test added 491.
   Pinned examples: `test_a_causal_hoti_block_is_promoted_too` (1 John 3:2–3,
   "οἴδαμεν ὅτι … ὅτι ὀψόμεθα αὐτὸν καθώς ἐστιν." with 3:3 chained onto it —
   the surface seams give one section over 3:2–3, the promotion cuts the
   block out) and `test_gar_block_that_crosses_a_sentence_is_promoted_to_its_own_section`
   (Romans 5:9–11, which has no surface indicator at all).
7. **Sections are emitted as the document's colour blocks** (`sections`:
   `[{start: pid, color: int}]`, first section not stored, colours counting
   up), identically in minimal and Full — so the analyzer's reading of the
   passage is visible in the editor from the first click.
8. **The three-word window is literal, and it costs the odd vocative.** Every
   opener-position indicator (οὖν, διό, the vocative) reads the sentence's
   first three words, and a vocative standing fourth is missed: James 1:2's
   "Πᾶσαν χαρὰν ἡγήσασθε, ἀδελφοί μου, …" is the case (James 1:19's "Ἴστε,
   ἀδελφοί μου ἀγαπητοί." fires, being third). The boundary at James 1:2
   seams anyway on its softs, so the miss is invisible there; widening the
   window is a one-number change if the expert wants it.
9. **A genitive absolute is only a scene-setter where segmentation leaves it
   whole.** Q8(d) reuses `_genitive_absolute` on the sentence's FIRST
   segment, so Matt 8:5's "Εἰσελθόντος δὲ αὐτοῦ εἰς Καφαρναοὺμ …" fires; Matt
   9:18's "Ταῦτα αὐτοῦ | λαλοῦντος αὐτοῖς" does not, because stage 1 splits
   the subject off ahead of the participle (the same limitation
   participle-rules.md records as cost #4).

**Corpus-wide effect** (all 260 NT chapters build and validate in both
modes): 10,523 sentences → **6,146 sections from the surface indicators**
(1.71 sentences per section), **6,268 after promotion** (1.68). Before the
2026-08-29 rulings those numbers were 4,084 and 4,575 (2.58 / 2.30).

The two movements are opposite, and both are the rulings working as written:

* **The promotion pass shrank**, as RULING Q10 intended. It now adds 2%
  (122 sections) rather than 12% (491), and Romans 8's promotion goes from
  +12 sections to +2.
* **The surface indicators grew**, from RULING Q8's b–h plus RULING Q12. How
  often each fires, over the corpus's 10,263 sentence boundaries: cohesion
  6,478 · English period 5,356 · paragraph 2,366 · quote-begin 2,234 ·
  asyndeton 1,379 · mood shift 1,326 · οὖν 463 · quote-end 405 · question 384
  · heading 376 · vocative (soft) 325 · scene-setter 286 · διό 104 · vocative
  (strong) 81.

**The calibration question for the next round** is the soft-pair rule, and it
is the lexical-cohesion drop that drives it. Cohesion fires at 63% of
boundaries — Greek sentences are short, and two adjacent ones often share no
content lemma at all — and the English period at 52%, so their conjunction
alone seams 1,447 boundaries; 2,320 boundaries in total are seamed by soft
indicators with no hard or strong one present. That is what takes the corpus
from 4,575 sections to 6,268, and it has a visible cost in the goldens:
Hebrews 4:11 → 4:12 now seams (no shared content lemma, plus an English
period), so the γάρ of 4:12 grounds the whole argument again instead of the
exhortation it follows — the flat shape sectioning had fixed. Options if the
expert wants it tightened: raise the threshold above 1 for softs alone,
weight cohesion below 0.5, or suppress cohesion where the new sentence opens
with a connective that explicitly binds it to the previous one (γάρ, δέ).
Romans 8, for reference, now falls into 24 sections: 22 from the surface
indicators and 2 from promotion.
