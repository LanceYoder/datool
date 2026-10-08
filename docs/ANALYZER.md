# The auto-analyzer

When an analysis is created, the server proposes a starting point: the
propositions, a tree, color blocks and a text flow. It is rule-based and
deterministic (no AI), and it lives in `da/firstpass.py`,
`da/segmentation.py` and `da/treebuild.py`. The API is
`POST /api/first-pass {text, tier}`.

The goal is to get the grammatically signaled calls right and leave the
interpretive ones easy to change, not to replace the analyst.

## 1. Locating the passage

- A **reference** (`Eph 1:13-14`, `1 Jn 1:5–7`, fuzzy spellings accepted)
  is resolved directly.
- **Pasted Greek** is normalized (accents, punctuation, verse numbers) and
  matched against the SBLGNT. A match gives every word its morphology.
- Text that can't be located is kept as **raw** propositions, split at
  punctuation, with no relationships proposed.

## 2. Propositions

The Greek is cut into propositions using morphology and punctuation:

- sentences end at `.` `·` `;`;
- each finite verb anchors a clause;
- a new proposition opens at a subordinating conjunction (ὅτι, ἵνα, ἐάν,
  ὡς, ὥστε, …), a relative pronoun, a coordinating conjunction joining two
  clauses, an **adverbial participle**, or an **adverbial infinitive**
  (preposition + article + infinitive, or a bare infinitive after its
  clause's finite verb);
- article-governed participles, complementary infinitives (after δύναμαι,
  θέλω, μέλλω, …) and ἰδού stay inside their clause;
- some verbless phrases are split out as **implied propositions**: a
  trailing prepositional phrase after a comma, or an apposition.

Over-splitting is preferred: merging in the editor is one right-click.

## 3. Relationships

Within each sentence, every dependent proposition attaches to the clause
it modifies, labeled by its connective. The main signals:

| Signal | Relationship |
| --- | --- |
| γάρ; causal ὅτι | Ground |
| οὖν, διό, ἄρα, ὅθεν | Inference |
| ἐάν, εἰ | Conditional |
| ὅταν, ὅτε, ἕως, πρίν | Temporal |
| ὅπου, οὗ | Locative |
| καθώς, ὥσπερ, ὡς | Comparison |
| ἵνα, ὅπως | Means–End (purpose); Fact–Interpretation after a verb of asking or saying |
| ὥστε | Cause–Effect (or Inference when the English reads "therefore") |
| ὅτι after a verb of saying or knowing | Fact–Interpretation |
| relative clause, apposition | Fact–Interpretation |
| οὐ … ἀλλά | Negative–Positive |
| μέν … δέ, bare ἀλλά, contrastive δέ | Alternative |
| καί, δέ, τε, οὐδέ, no connective | Series |
| a speech introduction followed by the speech | Fact–Interpretation |
| adverbial participle | by the participle rules below |

The full table is in `da/treebuild.py`.

**English cues.** Several connectives are ambiguous (ὅτι "that" or
"because"? ἵνα "that" or "so that"?). The analyzer reads the aligned BSB
English for that proposition and lets the translators' wording decide,
falling back to the grammar rules when there is no usable English.

**Adverbial participles** follow the Wallace/Keating chart
(`documents/Adverbial Participles.pdf`), first match wins: καίπερ →
Adversative; genitive absolute → Temporal; future → Means–End; λέγων
introducing speech → Way–End; then the English cue; perfect or negated
with οὐ → Ground; aorist before an aorist imperative → Series; aorist
before its clause → Temporal; present after its clause → Way–End;
otherwise Temporal.

## 4. Sections: big, then small, then big

The passage is first divided into **sections** (runs of whole sentences),
each section is built internally, and only then are the sections joined.
A boundary is scored from weighted signals (`SEAM_WEIGHTS` in
`da/treebuild.py`):

- **always a boundary**: a BSB section heading, or the start or end of a
  quotation (a speech verb stays with its speech);
- **a boundary on its own**: a BSB paragraph break, sentence-initial οὖν
  or διό, a narrative scene-setter (καὶ ἐγένετο, μετὰ ταῦτα, τότε, …), an
  opening rhetorical question, a vocative in a letter;
- **counts only in pairs**: a change of mood or person, asyndeton in a
  letter, no shared vocabulary with the previous sentence, an English
  sentence break.

A γάρ block that runs on across several sentences also becomes its own
section. The sections are saved as the analysis's initial color blocks.

## 5. Tiers

The user picks how much of the tree to keep:

- **Max** connects everything into one tree, every judgment call included.
- **Minimal** keeps only the joins marked *sure*: the ones the grammar
  forces (ἐάν, οὐ … ἀλλά, ὥστε + infinitive, …) and sensible defaults
  that are right most of the time (καί → Series, γάρ → Ground, relative →
  Fact–Interpretation, English-cue calls, participle rules). Joins with no
  real evidence stay unconnected: sentences with no connective,
  implied-proposition phrases, unknown connectives.
- **Nothing** proposes no relationships; every proposition stands alone.

The propositions, color blocks and text flow are the same at every tier.

## 6. Text flow

The text flow has one line per proposition. Indentation follows the
course's Text Flow rules: independent clauses flush left, a dependent
clause one step under the clause it modifies, a coordinated clause level
with its partner, a quotation one step under its introduction.
`GET /api/text-flow?start=&end=` derives it for older analyses that don't
have one.

## Testing against the course

The worked examples (Hebrews 4:9–12, 1 John 1:5–10, the student
spreadsheets and diagrams in `examples/`) are golden tests in `da/tests/`:
each one pins which brackets the analyzer reproduces and which it labels
differently, so any rule change has to be justified bracket by bracket.
Open questions for the DA expert are in
[OPEN-QUESTIONS.md](OPEN-QUESTIONS.md).
