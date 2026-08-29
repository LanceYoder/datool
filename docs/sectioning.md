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
   ("because") span whose support develops into at least one coordinate
   relation or a Fact–Interpretation is itself section-sized: where the
   within-fold reveals that shape, split it out as its own section.
   *Built as* `_promoted`.
4. **Big: section fold.** Fold the section packets left to right with the
   same join logic (the section-opening sentence's connective decides the
   relationship, exactly as sentence joins do today), producing one tree.
   *Built as* the same `_fold_sentences`, over section packets: a `_Packet`
   carries the sentence at each of its ends, so `_sentence_join` still sees a
   real "previous sentence" and a real "next sentence" and its table is used
   once, not twice.

## Approved indicators (initial implementation)

As shipped, `SEAM_WEIGHTS` in `da/treebuild.py` — one entry per indicator,
threshold 1, so adding a further indicator is a line there plus its detection:

| Indicator | Weight | Signal | Data |
|---|---|---|---|
| Section heading | 2 (hard) | seam before the heading's word (translators' pericope division) | BSB `Hdg` markers |
| Direct/indirect discourse — begin | 2 (hard) | seam at speech begin; the speech verb (dicendi clause, λέγων line included) belongs WITH the upcoming speech's section | BSB `Q+` + dicendi machinery |
| Direct/indirect discourse — end | 2 (hard) | seam at the sentence AFTER the one the quotation closes in | BSB `Q-` |
| Paragraph break | 1 (strong) | seam before the paragraph's first word | BSB `Par` markers |
| οὖν | 1 (strong) | seam before the οὖν sentence — "basically always a transition between chunks of logic" | lemma, first three words |
| English period | 0 (soft) | raises the likelihood of a seam after the sentence | BSB verse text |
| γάρ/ὅτι + development | — | a because-block containing ≥1 coordinate relation or Ft/In becomes its own section | promotion pass (step 3) |

Weighting: headings and quote boundaries are hard seams; paragraph breaks
and οὖν are strong; the English period is a soft vote that only tips a
boundary already suggested by something else. Exact weights are tuning —
start simple (hard/strong = seam; soft alone = no seam) and calibrate
against the goldens.

Further indicators (vocatives, διό/διὰ τοῦτο, scene-setters, mood/person
shift, epistolary asyndeton, rhetorical questions, cohesion shift) are
awaiting the expert — expert-questions.md Open #8. The seam scorer should
make adding an indicator a one-line affair.

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
   *Known miss:* an ELIDED speech verb — Acts 2:38 "Πέτρος δὲ πρὸς αὐτούς·"
   ("And Peter [said] to them") — is not a dicendi sentence to this test, so
   the seam does fall between it and "Μετανοήσατε". Also βοάω-class verbs of
   crying out (Matt 3:3 "Φωνὴ βοῶντος … ·") are not in `VERBA_DICENDI`.
4. **Quote REOPENS count as begins.** The `Q-` data is sparse (whole-NT:
   thousands of opens against hundreds of closes — reopens plus unmarked
   closes), so tracking an open/closed state across a passage would be
   unreliable; every `Q+` is read as a speech begin. In practice a reopen
   sits at a paragraph start, which is a seam anyway.
5. **The English period is detected but weighted 0.** The BSB interlinear
   cells carry no punctuation, so the signal is read at VERSE granularity
   from `bsb-nt.tsv`: true when the Greek sentence ends on the last word of
   its verse and that verse's English ends on a full stop. It is scored like
   any other indicator and, at weight 0, never tips a boundary — turning it
   on is a one-number change once the expert calibrates it.
6. **The promotion pass, precisely.** The because-block is the γάρ sentence
   plus the sentences the fold would Ser-chain onto it; BOTH its ends become
   seams, so the block really does become "its own section packet". It
   qualifies when that block's packet contains a Ser/Prog/Alt or a Ft/In. One
   level only — promoted sections are not re-examined. *Note for the expert:*
   only γάρ can reach this test today; a causal ὅτι is a subordinator and
   never produces a sentence-level Ground.
7. **Sections are emitted as the document's colour blocks** (`sections`:
   `[{start: pid, color: int}]`, first section not stored, colours counting
   up), identically in minimal and Full — so the analyzer's reading of the
   passage is visible in the editor from the first click.

**Corpus-wide effect** (all 260 NT chapters build and validate in both
modes): 10,523 sentences → 4,084 sections from the surface indicators (2.58
sentences per section), 4,575 after promotion (2.30). The promotion is the
one to watch: corpus-wide it adds 12%, but in argumentative prose it fires on
most γάρ sentences (Romans 8 goes from 8 sections to 20), because a Pauline
ground almost always contains a coordination. Whether "contains ≥1 coordinate
or Ft/In" is the right test, or whether the development should have to cross
a sentence boundary, is the first calibration question for the expert.
