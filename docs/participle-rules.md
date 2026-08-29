# Adverbial participle rules — parsed from the Wallace/Keating chart

Source: `documents/Adverbial Participles.pdf` (Corey Keating, "Use of
Participles" v2.9, summarizing Wallace, *Greek Grammar Beyond the Basics*).
This file reduces the chart to conditions the first pass can actually test
against MorphGNT data (tense, mood, case from `parsing`; lemma; word order
within the segment and relative to the main clause), each mapped to a
taxonomy relationship. Tier assignments (sure / default / review) are the
DA-expert conversation's working proposal, not yet all confirmed.

Everything below concerns a participle segment already split off by
segmentation (adverbial / attendant-circumstance participles get their own
line; substantival, attributive, periphrastic, complementary, redundant and
indirect-discourse participles never should — see "Do not split" below).

## Classification rules, in precedence order

Signals available per word: tense P/I/F/A/X/Y, mood R (participle), case,
lemma, position. "Precedes/follows" = the participle segment's position
relative to the clause it modifies.

| # | Condition | Relationship | Tier | Chart's warrant |
|---|-----------|--------------|------|-----------------|
| 1 | Segment contains καίπερ / καίτοιγε | Adv (concession) | sure | "particle to make concession obvious" |
| 2 | Genitive absolute: genitive anarthrous participle with genitive subject, at clause/sentence front | Tmp | sure? | "always adverbial and usually translated as temporal" — the *usually* is the question |
| 3 | Future-tense participle | MEd (purpose) | sure | "Future adverbial participles always belong here" |
| 4 | λέγων / λέγοντες (redundant participle of saying) introducing speech | FtIn over the speech; the participle rides with its dicendi clause | sure | chart: "redundant"; course flow puts λέγοντες on its own line, speech content under it |
| 5 | Perfect-tense participle (not periphrastic) | Grnd (cause) | default | "Adverbial perfect participles almost always belong here" |
| 6 | Participle negated with οὐ (rather than μή) | Grnd (cause) | default | "the causal participle will often use οὐ when negated" |
| 7 | Attendant circumstance: aorist participle + aorist main verb (imperative or indicative), participle BEFORE the main verb, narrative | Ser (coordinate) | default | the chart's five-feature test, "90% of the time" |
| 8 | Aorist participle preceding its main verb (not #7) | Tmp ("after …") | default | temporal is the antecedent-time reading; cause also precedes — emphasis decides, so never sure |
| 9 | Present participle following its main verb | WEd (means/manner) | default | "usually follows the main verb"; result (CE) overlaps but is rarer |
| 10 | Present participle preceding its main verb | Tmp ("while …") | default | contemporaneous time |
| 11 | Anything else | Tmp | review | "almost all participles are temporal in a secondary sense" |

Category → taxonomy mapping used above: Temporal → Tmp, Means → WEd,
Manner → WEd, Condition → CndE, Purpose → MEd, Result → CE, Cause → Grnd,
Concession → Adv, Attendant circumstance → Ser.

Two chart categories get no rule because they have no reliable surface
signal: **Condition** (CndE — "overlaps in form and meaning with Means") and
**Result** (CE — present + follows, same surface as Means). Both stay
reachable only by hand.

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

## Open questions for the expert

1. Tier for the genitive absolute: sure, or default? ("usually temporal")
2. Does Manner belong under W/Ed with Means, or elsewhere?
3. Attendant circumstance as coordinate Ser at 90% confidence — keep in
   minimal or defaults-only?
4. Word-order tests use the participle segment's position relative to the
   clause it attaches to; chained participles (participle after participle)
   attach to the nearest finite clause — confirm.
