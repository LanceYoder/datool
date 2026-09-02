# Rulings for the DA expert — running list

The single place where open questions for the expert live, plus the record
of what has already been ruled. Add new questions at the top of OPEN with a
date; when ruled, move the item to DECIDED with the ruling and where it is
implemented. Related docs: `participle-rules.md` (the Wallace/Keating chart,
encoded), `english-cue-rules.md` (the English-cue disambiguation layer),
DESIGN.md §5 (the first pass).

## Open

1. **(2026-08-29) Sectioning vs the worked examples' color sections.** The
    four example spreadsheets mark sections with color fills (usually three
    per passage). Comparison with the auto-sectioner:
    Eph 1:13–14 matches (one section); 1 Thess 1:6–10 half-matches (we seam
    at 9a but not 8a — see the #10 evidence below); 1 John 1:5–7 misses both
    student seams (6a, 7a — the parallel ἐάν sentences; candidate indicator
    for #8: sentence-initial conditional openers, especially in a parallel
    run); Phil 1:9–11 is UNREACHABLE by design — the student's three
    sections divide a single Greek sentence, and our sections are whole-
    sentence runs. Question: on short passages, are the course's "sections"
    a finer, sub-sentence grain (clause-groups) that the tool should draw by
    a different mechanism — e.g. from the tree's own top-level brackets —
    while seam-based sectioning serves longer passages?
    Evidence for #10: the 1 Thess 8a γάρ block develops via Neg/Pos (οὐκ
    μόνον … ἀλλά) and C/E (ὥστε) — if Neg/Pos counted as "development", the
    passage would match the student 2-for-2. Should the development test
    include Neg/Pos (and C/E)?

2. **(2026-08-29) Sentences that never get their apodosis lose their
    relationship.** A sentence-initial dependent (ὥστε, εἰ/ἐάν, causal ὅτι,
    ὡς…) is held forward; when its own sentence never produces an
    independent clause, the held relationship is discarded and the sentence
    joins its NEIGHBOR with the Series default — 858 sentences corpus-wide
    (8.2%), e.g. Rom 7:12's inferential Ὥστε computes Inference and then
    joins as Series. Proposed fix: let the sentence fold consult a packet's
    pending forward relationship before falling to the default. This would
    change 858 joins, so it needs a ruling: should a dangling sentence-
    initial subordinator's relationship carry FORWARD to the next sentence?

3. **(2026-08-29) Auto text flow: the mood-agreement rule for coordinate
    lines.** Where a coordinating conjunction could continue either an inner
    clause or an outer one, the auto-flow places it beside the nearest
    preceding clause whose finite verb AGREES IN MOOD (falling back to the
    structural right edge). This is our generalization, not a rule in the
    course handout — but it is what makes both handout examples come out
    exactly (Matt 8:24 αὐτὸς δὲ ἐκάθευδεν returns to the indicative main
    rather than the ὥστε infinitive; 1 John 1:6 καὶ … περιπατῶμεν lines up
    with the subjunctive protasis rather than the indicative ὅτι content).
    Naive alternatives get 8/10 of the handout's coordinate lines; mood
    agreement gets 10/10. Bless, refine, or replace?

4. **(2026-08-29) Soft-pair seams over-fire — cohesion needs calibration.**
   Implementing Q8(h)+Q12 as ruled (cohesion drop 0.5 + English period 0.5,
   two softs = seam) measured badly: the cohesion indicator fires at 63% of
   sentence boundaries (Greek sentences are short and often share no content
   lemma), so soft pairs alone create 2,320 seams and drive the corpus to
   1.68 sentences per section (from 2.30). Concrete cost: Hebrews 4:11→4:12
   seams on cohesion+period DESPITE v12 opening with γάρ, splitting the
   student's Inf/Grnd shape. Options: (a) softs alone never seam (threshold
   above 1 for soft pairs); (b) weight cohesion below 0.5; (c) suppress the
   soft indicators when the new sentence OPENS with a binding connective
   (γάρ, ὅτι, ἵνα, ὥστε, καθώς — a grounded/bound sentence is glued to its
   predecessor whatever its vocabulary). We recommend (c): it restores the
   Hebrews shape and is a principle, not a tuned number.

## Decided

Rulings of 2026-08-29 (the expert's answers to questions 1-12 as sent):

- **Contrastive "but" (Q1)** -> the default for BOTH is Alternative: bare
  ἀλλά -> Alt (in minimal; οὐ…ἀλλά stays NegPos sure), δέ rendered "but" ->
  Alt (else Series as before).
- **Appositions (Q2)** -> Ft/In, and it joins minimal.
- **Implicit-proposition PPs (Q3)** -> the per-preposition defaults are
  right, and the English cues apply to them too ("because of" -> Grnd,
  "in order to" -> M/Ed) — but PPs stay OUT of minimal.
- **Aorist participle following its clause (Q4)** -> Temporal stands as the
  default (the 1 Thess 1:6 W/Ed reading is the student's, not the rule).
- **Attendant circumstance (Q5)** -> restrict to aorist IMPERATIVE main
  verbs; aorist-indicative narrative cases read Temporal.
- **λέγων as W/Ed (Q6)** -> confirmed as built.
- **ἵνα look-back (Q7)** -> widen ONLY when a coordinating conjunction
  stands before the second ἵνα (ἀλλ' ἵνα / καὶ ἵνα chains inherit the
  governing verb's reach).
- **Section indicators (Q8)** -> b-h ALL accepted: vocatives, διό/διὰ
  τοῦτο, narrative scene-setters, mood/person shift, epistolary asyndeton,
  rhetorical-question openers, and lexical-cohesion shift / inclusio.
- **ἵνα "that" cue (Q9)** -> outranks purpose only WITH corroboration — a
  communication/volition verb in the preceding clause (John 3:16 reads
  purpose again).
- **Promotion pass (Q10)** -> the qualifying development must CROSS a
  sentence boundary, and developed causal-ὅτι blocks promote too.
- **Speech introductions (Q11)** -> (a) add the βοάω/κράζω class to the
  dicendi list; (b) an elided speech verb counts ONLY when direct speech
  follows.
- **English period (Q12)** -> never a seam alone; it needs a companion
  indicator (soft signals combine).

- **Minimal's meaning** — minimal = everything grammar-forced PLUS sensible
  defaults (right ~80%+); Full stays the connect-everything mode; these are
  the only two tiers. *(2026-08-29; treebuild.py `_sure` semantics.)*
- **οὖν** → always Inference, in minimal. The Acts μὲν οὖν student diagram
  is overruled. *(2026-08-29.)*
- **ὥστε** → out of minimal EXCEPT ὥστε + infinitive, which is a sure C/E.
  The English cue layer may resurrect the rest ("so that"/"with the result"
  → CE, "therefore" → Inf). *(2026-08-29.)*
- **ὅτι** → "that"/direct speech = Ft/In; "because" = Grnd; both in minimal.
  Detection: English cue first (once built), verbum-dicendi heuristic as
  fallback. *(2026-08-29.)*
- **ἵνα** → content (Ft/In) after verbs of asking/praying, else purpose
  (M/Ed); in minimal. Draft ASKING_VERBS list (ἐρωτάω, αἰτέω, παρακαλέω,
  δέομαι, προσεύχομαι, εὔχομαι, ἀξιόω) approved. *(2026-08-29.)*
- **Speech openings** (verbum dicendi + '·', λέγων/λέγοντες) → always Ft/In,
  in minimal; the analyst re-marks S/R by hand where wanted. *(2026-08-29.)*
- **δέ without μέν** → Series, in minimal. μέν…δέ → Alternative. *(2026-08-29.)*
- **καί / serial class** → Series by default, in minimal. *(2026-08-29.)*
- **Bare ἀλλά** → stays out of minimal (see Open #1). *(2026-08-29.)*
- **Adverbial participles** → the Wallace/Keating table as encoded in
  `participle-rules.md`, all rules in minimal; residual bucket → Temporal
  approved; genitive absolute → Temporal as a default. *(2026-08-29.)*
- **Relative clauses** → Ft/In with nearest-clause scope as the accepted
  default, in minimal (the old airtight-scope guard is dropped). *(2026-08-29.)*
- **Page-2 "do not split" segmentation rules** → not pursuing for now.
  *(2026-08-29.)*
- **English-cue layer** → design and cue table in `english-cue-rules.md`
  approved as drafted; build after the re-tier lands. *(2026-08-29.)*
- **Sectioning architecture (big–small–big)** → before relationship
  generation, chunk the passage into major logical sections; connect
  segment-to-segment WITHIN each section until it is internally complete;
  then connect the sections to each other. *(2026-08-29; not yet built.)*
- **Section-break indicators (expert's five)** → (1) paragraph break (data:
  BSB `Par` markers); (2) beginning and end of direct or indirect
  discourse, with the speech verb included in the upcoming speech's section
  (data: BSB `begQ`/`endQ` quotation markers + the dicendi machinery);
  (3) οὖν — basically always a transition between chunks of logic;
  (4) a "because" (γάρ or ὅτι) followed by at least one coordinate relation
  or a Fact–Interpretation creates a section break; (5) an English sentence
  period raises the likelihood of a break after it. *(2026-08-29; further
  candidates awaiting ruling — Open #8.)*
- **BSB section headings as a section indicator** → approved; build into the
  initial sectioning implementation alongside the five above. *(2026-08-29.)*
