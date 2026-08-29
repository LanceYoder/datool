# Adverbial participle rules — parsed from the Wallace/Keating chart

Source: `documents/Adverbial Participles.pdf` (Corey Keating, "Use of
Participles" v2.9, summarizing Wallace, *Greek Grammar Beyond the Basics*).
This file reduces the chart to conditions the first pass can actually test
against MorphGNT data (tense, mood, case from `parsing`; lemma; word order
within the segment and relative to the main clause), each mapped to a
taxonomy relationship. **Implemented** in `da/treebuild.py`
(`_participle_call`), which follows this table in order.

Everything below concerns a participle segment already split off by
segmentation (adverbial / attendant-circumstance participles get their own
line; substantival, attributive, periphrastic, complementary, redundant and
indirect-discourse participles never should — see "Do not split" below).

## Classification rules, in precedence order

Signals available per word: tense P/I/F/A/X/Y, mood **P** (participle; `N` is
the infinitive — verified against the corpus, not the chart's notation), case,
lemma, position. "Precedes/follows" = the participle segment's position
relative to the clause it attaches to **in the shift-reduce pass**: held and
attaching forward = precedes, attaching backward to the stack top = follows.

**Tier**: since the expert's re-tier, `sure` and `default` are the same tier —
both join the minimal analysis (see DESIGN.md §5). The column below records
which of the two the call IS, because that distinction still matters when
weighing a rule for revision.

| # | Condition | Relationship | Tier | In minimal | Chart's warrant |
|---|-----------|--------------|------|-----------|-----------------|
| 1 | Segment contains καίπερ / καίτοιγε / καίτοι | Adv (concession) | sure | yes | "particle to make concession obvious" |
| 2 | Genitive absolute: genitive participle with an agreeing genitive noun/pronoun subject beside it, segment before its clause | Tmp | default | yes | "always adverbial and usually translated as temporal" |
| 3 | Future-tense participle | MEd (purpose) | sure | yes | "Future adverbial participles always belong here" |
| 4 | λέγων / λέγοντες (redundant participle of saying) introducing speech | WEd — it rides with its dicendi clause; the Ft/In over the speech is the dicendi machinery's own join | sure | yes | chart: "redundant"; course flow puts λέγοντες on its own line, speech content under it |
| 5 | Perfect-tense participle (not periphrastic) | Grnd (cause) | default | yes | "Adverbial perfect participles almost always belong here" |
| 6 | Participle negated with οὐ (and no μή in the segment) | Grnd (cause) | default | yes | "the causal participle will often use οὐ when negated" |
| 7 | Attendant circumstance: aorist participle before an aorist imperative-or-indicative main verb | Ser (coordinate) | default | yes | the chart's five-feature test, "90% of the time" |
| 8 | Aorist participle preceding its clause (not #7) | Tmp ("after …") | default | yes | temporal is the antecedent-time reading |
| 9 | Present participle following its clause | WEd (means/manner) | default | yes | "usually follows the main verb"; result (CE) overlaps but is rarer |
| 10 | Present participle preceding its clause | Tmp ("while …") | default | yes | contemporaneous time |
| 11 | Anything else | Tmp | default (assumption) | yes | "almost all participles are temporal in a secondary sense" |

Category → taxonomy mapping used above: Temporal → Tmp, Means → WEd,
Manner → WEd, Condition → CndE, Purpose → MEd, Result → CE, Cause → Grnd,
Concession → Adv, Attendant circumstance → Ser.

Two chart categories get no rule because they have no reliable surface
signal: **Condition** (CndE — "overlaps in form and meaning with Means") and
**Result** (CE — present + follows, same surface as Means). Both stay
reachable only by hand.

## Known costs of the table, for the expert

1. **Rule 11 is an implementation assumption.** The chart gives the residual
   bucket no tier; we join it to minimal like every other default. Its largest
   member is the **aorist participle FOLLOWING its clause**, for which the
   chart has no rule at all — so it reads Temporal. The 1 Thess 1:6 golden
   (μιμηταὶ … ἐγενήθητε, δεξάμενοι τὸν λόγον) is the case that costs us: the
   student reads means (W/Ed). If the expert wants aorist-following to read
   W/Ed, that is a one-line rule between #8 and #9.
2. **Rule 7 over-fires on narrative indicatives.** The chart's own example
   Matt 4:2 (νηστεύσας … ἐπείνασεν) is aorist + aorist indicative + preceding,
   so the simplified test coordinates it where Wallace reads temporal. Acts
   2:37 (Ἀκούσαντες δὲ κατενύγησαν) is the same shape. Restricting #7 to an
   aorist **imperative** main verb would fix both at the cost of the
   indicative attendant-circumstance cases.
3. **Rule 2 depends on segmentation.** A genitive absolute whose subject
   stands *before* the participle (Matt 9:18 Ταῦτα αὐτοῦ | λαλοῦντος αὐτοῖς)
   is split by stage 1, so the subject is no longer in the participle's
   segment and the rule cannot see it; the segment falls through to #10 —
   Temporal by another road, so the answer survives, but the rule does not
   fire. Fixing this belongs to the segmentation "do not split" phase.

## Do not split (segmentation contract)

From the chart's non-adverbial uses — none of these may become their own
line/proposition:

- **Periphrastic**: anarthrous participle + εἰμί / γίνομαι / ὑπάρχω forming
  one verbal idea (present or perfect participle).
- **Complementary**: completes another verb ("do not cease *being thankful*").
- **Indirect discourse**: accusative anarthrous participle + accusative
  noun after a verb of perception/communication.
- **Substantival / attributive** (already excluded by the Text Flow
  instructions).
- **Nominative absolute** (substantival, resumed by a later pronoun).
- **Imperatival / indicative participles** (rare independent uses): the
  segment IS a main clause, not a dependent one.

## Open questions — answered

1. *Tier for the genitive absolute: sure, or default?* — **Default, and
   defaults join the minimal analysis.** Implemented as rule 2 above.
2. *Does Manner belong under W/Ed with Means, or elsewhere?* — **Minimal and
   Full are the only two tiers**, so the question of a third "manner" tier is
   moot; Manner and Means both map to W/Ed.
3. *Attendant circumstance as coordinate Ser at 90% confidence — keep in
   minimal or defaults-only?* — **Minimal is defaults-included**: minimal =
   grammar-forced calls + defaults right ~80%+ of the time, so rule 7 is in.
4. *Word-order tests / chained participles* — confirmed: a participle attaches
   to the nearest clause in the shift-reduce pass, and ὥστε + infinitive stays
   a sure C/E while ὥστε + a finite verb does not.

Still open: the three costs listed above, and the draft `ASKING_VERBS` lemma
table in `da/treebuild.py` that drives the ἵνα content-vs-purpose rule.
