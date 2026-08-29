# Rulings for the DA expert — running list

The single place where open questions for the expert live, plus the record
of what has already been ruled. Add new questions at the top of OPEN with a
date; when ruled, move the item to DECIDED with the ruling and where it is
implemented. Related docs: `participle-rules.md` (the Wallace/Keating chart,
encoded), `english-cue-rules.md` (the English-cue disambiguation layer),
DESIGN.md §5 (the first pass).

## Open

1. **(2026-08-29) Contrastive "but"/"yet" English cue with no preceding
   negation.** οὐ … ἀλλά is a sure Neg/Pos; but a bare "but" cue (bare ἀλλά,
   or δέ rendered "but") tells us *contrast* without telling us *which*
   contrary relationship (NegPos / Alt / Adv). Today these stay out of
   minimal. Is there a default worth taking — e.g. bare ἀλλά → NegPos, δέ
   "but" → Alt — or do they stay hand-only?

2. **(2026-08-29) Appositions.** A split-off apposition / attributive-article
   phrase currently guesses Ft/In and stays OUT of minimal (unruled). Is
   apposition → Ft/In an 80%+ default that should join minimal?

3. **(2026-08-29) Implicit-proposition prepositional phrases.** A split-off
   PP guesses its relation by preposition (εἰς/πρός → M/Ed; ἕως/ἄχρι/μέχρι/
   πρό/μετά → Tmp; ἐν/ἐπί/ὑπό/παρά → Loc; διά/ἐκ/ἀπό/χάριν/ἕνεκα → Grnd;
   otherwise W/Ed) and stays OUT of minimal. Are these per-preposition
   defaults right, and do they join minimal? (The English cue layer will
   also apply here once built — "because of" → Grnd, "in order to" → M/Ed…)

4. **(2026-08-29) Aorist participle FOLLOWING its clause.** The Wallace chart
   has no rule for this shape, so it falls to the residual Temporal. The
   1 Thess 1:6 golden (δεξάμενοι τὸν λόγον after ἐγενήθητε) reads it as
   means (W/Ed). Should aorist-following read W/Ed instead of Tmp?

5. **(2026-08-29) Attendant circumstance scope.** The chart's five-feature
   test fires on aorist + aorist *indicative* narrative (Matt 4:2 νηστεύσας
   … ἐπείνασεν; Acts 2:37 Ἀκούσαντες … κατενύγησαν) where Wallace reads
   temporal. Restrict the coordinate-Series rule to aorist **imperative**
   main verbs (Matt 2:13 "rise and take"), letting indicative cases read
   temporal — or keep the broad rule?

6. **(2026-08-29) λέγων as W/Ed, not Ft/In.** The ruling said the redundant
   speech participle "joins as Ft/In over the speech" — but the speech is
   its own segment and the dicendi machinery already brackets it Ft/In, so
   bracketing the participle Ft/In too would double-mark it. As built, the
   participle rides with its dicendi clause as W/Ed (matching the Acts 2:40
   diagram exactly), and the Ft/In lands on the speech. Confirm this
   reading of the ruling.

7. **(2026-08-29) ἵνα look-back is one clause.** The asking-verb test sees
   only the immediately preceding clause, so the second ἵνα in John 17:15
   (ἀλλ' ἵνα τηρήσῃς, still governed by ἐρωτῶ) reads purpose instead of
   content. Widen the look-back (to the sentence's governing verb), or
   accept the miss?

8. **(2026-08-29) Additional section-break indicators — proposed, for
   ruling.** The five decided indicators are below under DECIDED, along with
   BSB section headings (approved 2026-08-29). Still-open candidates, each
   machine-detectable today:
   b. **Sentence-initial vocatives** (ἀδελφοί, ἀγαπητοί, τεκνία, and the
      like): the classic epistolary topic-shift opener (1 John, James).
   c. **Sentence-initial διό / διὰ τοῦτο**: the same transition class as
      οὖν.
   d. **Narrative scene-setters**: sentence-initial genitive absolute;
      μετὰ ταῦτα; ἐν (ἐκείναις) ταῖς ἡμέραις; καὶ ἐγένετο; τότε — new time,
      place, or participants.
   e. **Mood/person shift**: a run of imperatives opening after indicative
      exposition (the hortatory turn, e.g. Hebrews' "let us…" sections), or
      a sustained 3rd→2nd person shift.
   f. **Asyndeton at a sentence start in the epistles**: no connective at
      all often marks a fresh unit in letters (pervasive in James) — the
      opposite default from narrative, where asyndeton is just style.
   g. **Rhetorical-question openers** (Τί οὖν ἐροῦμεν;-type): interrogative
      sentences that launch a unit of argument (Romans).
   h. *(harder, later)* **Lexical-cohesion shift / inclusio**: vocabulary
      overlap between adjacent sentences drops at true seams; an inclusio
      (repeated opening phrase) closes a section. Statistical, not rule-
      based — flagged for a later phase.

9. **(2026-08-29) The ἵνα "that" cue and archaic purpose-"that".** The
   English-cue layer moves 78 ἵνα clauses from purpose to content on a
   "that" rendering. Sampling says the majority are genuine content clauses
   the ASKING_VERBS list misses (εἶπον ἵνα, διαστέλλομαι ἵνα, κηρύσσω ἵνα,
   δέομαι ἵνα) — but John 3:16's archaic purpose-"that" ("that whoever
   believes…") is miscalled content. Should the "that" cue outrank purpose
   only with corroboration (e.g. a communication/volition verb in the
   preceding clause), or is ~78-mostly-right exactly the 80% default we
   want? (Note: the cue already reaches past the one-clause look-back of
   Open #7, fixing John 17:15's second ἵνα.)

10. **(2026-08-29) Promotion-pass calibration.** The γάρ-development rule
    ("a because-block containing ≥1 coordinate or Ft/In becomes its own
    section") fires on most γάρ sentences in argumentative prose — a Pauline
    ground almost always contains a coordination — taking Romans 8 from 8
    sections to 20 (corpus-wide: +12%). Should the qualifying development
    have to cross a sentence boundary (a multi-SENTENCE because-block) rather
    than merely contain a coordination? Also: only γάρ can reach this test
    today — a causal ὅτι is a subordinator and never makes a sentence-level
    Ground. Should developed ὅτι-blocks be promoted too?

11. **(2026-08-29) Speech-introduction gaps.** The speech-verb-rides-with-
    its-speech rule keys on VERBA_DICENDI + '·'. Two misses: (a) verbs of
    crying out (βοάω, κράζω-class: Matt 3:3 Φωνὴ βοῶντος…) are not in the
    list — add them?; (b) an ELIDED speech verb (Acts 2:38 Πέτρος δὲ πρὸς
    αὐτούς· — "Peter [said] to them") leaves the introduction outside the
    speech section. Is "clause ending in '·' with a person-subject and no
    verb" safe to treat as a speech introduction?

12. **(2026-08-29) The English-period seam weight.** Detected (Greek
    sentence ends the verse + the BSB verse ends on a full stop) but
    weighted 0, so it never tips a boundary. What weight — if any — should
    it carry, and does it need a companion indicator to combine with?

## Decided

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
