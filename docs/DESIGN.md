# datool — Design Document

datool is a webapp for **discourse analysis (DA) of Greek New Testament passages** in the
bracketing method taught in Greek III (Fuller/Piper/Hafemann tradition; see the method
documents in [`documents/`](../documents) and worked student examples in
[`examples/`](../examples)).

Today this analysis is done by drawing brackets with Excel cell borders, or on paper.
Both are slow, and any large restructure means redrawing. datool replaces them with:

1. **An automated first pass** — paste a chunk of Greek NT text and the system segments
   it into propositions and classifies the logical relationships into a complete,
   annotated bracket tree. Target: get ~80% of the easy (grammatically signaled) calls
   right.
2. **An editor actually shaped for this structure** — the user then modifies the
   structure and annotations *within the rules of the method*. Much of DA is interpretive
   opinion; the tool's job is to make expressing and revising that opinion cheap.

**V1 scope:** exactly the two items above, Greek-only. No Text Flow stage, no English
translation lines, no accounts/login (single-user local mode). See
[Out of scope](#out-of-scope-for-v1) for the full list of deferred phases.

---

## 1. The method being modeled

An analysis relates **propositions** (clause-level units of assertion) using nested,
never-crossing **brackets**, each labeled with one of 18 logical relationship types:

| Family | Type | Symbol | Star default |
|---|---|---|---|
| Coordinate | Series | `S` | — (no star) |
| Coordinate | Progression | `P` | — |
| Coordinate | Alternative | `Alt` | — |
| Subordinate — restatement | Way–End | `W / Ed` | `W → Ed*` |
| Subordinate — restatement | Comparison | `//` | `// → *` |
| Subordinate — restatement | Negative–Positive | `− / +` | `− → +*` |
| Subordinate — restatement | General–Specific | `Gn / Sp` | `Gn → Sp*` |
| Subordinate — restatement | Fact–Interpretation | `Ft / In` | `Ft → In*` |
| Subordinate — distinct statement | Ground | `G` | `* → G` |
| Subordinate — distinct statement | Inference | `∴` | `→ ∴*` |
| Subordinate — distinct statement | Cause–Effect | `C / E` | `C → E*` |
| Subordinate — distinct statement | Conditional | `C? / E` | `C? → E*` |
| Subordinate — distinct statement | Means–End | `M / Ed` | `M → Ed*` |
| Subordinate — distinct statement | Temporal | `T` | `T → *` |
| Subordinate — distinct statement | Locative | `L` | `L → *` |
| Support by contrary | Adversative | `Adv` | `Adv → *` |
| Support by contrary | Question–Answer | `Q / A` | `Q → A*` |
| Support by contrary | Situation–Response | `S / R` | `S → R*` |

Coordinate brackets have no star and connect from their center. Subordinate brackets
**star the semantically prominent side** (the table shows each type's conventional
default; the user can move it — that's interpretation). Two-part labels may be reversed
(`W–Ed` ↔ `Ed–W`) when the supporting member precedes.

**Rules of the method — these become app invariants:**

- Every proposition is connected into the analysis — the goal state of a finished
  analysis, not a save-time invariant: while the user is still connecting propositions
  pairwise, unconnected ones are legal (see §2, the forest).
- Brackets never cross.
- Brackets attach to other brackets at their starred end (center if coordinate).
- Following the stars outward from any point leads to the **main point**: the
  proposition supported by all others which itself supports none.

## 2. Core structural insight

Nested, never-crossing brackets over an ordered list of propositions are exactly **an
ordered tree over contiguous spans**:

- **Leaf** = proposition (a range of corpus words, or raw Greek text; optional section
  color).
- **Internal node** = bracket:
  `{ relationship, children (ordered, ≥ 2), prominentChildIndex | null, labelReversed? }`
  — `null` prominence ⇔ coordinate type.
- **A document holds an ordered FOREST, not one tree** (`schemaVersion: 2`). The user
  connects propositions pairwise by hand, so an in-progress analysis has propositions
  that are not yet joined to anything: each is simply a root of its own. A *finished*,
  fully connected analysis is a forest of one. (v1 documents carried a single `tree`
  key; they still validate and read as a forest of one.)
- **Contiguity is derived, not stored.** A forest is valid iff the in-order leaves of
  its roots, in root order, equal the proposition list. "Brackets never cross" needs no
  checking; it is unrepresentable.
- **The main point is computed**, not stored: walk from the single root following
  `prominentChildIndex` (at coordinate nodes, the whole packet is the point). A forest
  with several roots has no main point yet — nothing supports everything else.
- **Layout is deterministic**: nesting depth → margin column. There is no drag-and-drop
  canvas and no persisted geometry — rendering is a pure function of the forest.

This single decision shapes everything else: the editor is structural (wrap/unwrap/
re-label), the storage is one JSON document, and validity is enforced by a schema rather
than by user care.

## 3. Worked example — 1 John 1:6

Structure as analyzed in `examples/Discourse Analysis 1 - NT 003 - James Jourlait.xlsx`:

```text
        ┌ Ft ──── 6a  ἐὰν εἴπωμεν
        │    ┌ *  6b  ὅτι κοινωνίαν ἔχομεν μετ᾽ αὐτοῦ
┌ C? ── └ In*└ Adv 6c  καὶ ἐν τῷ σκότει περιπατῶμεν
│           ┌ S   6d  ψευδόμεθα
└ E* ────── └     6e  καὶ οὐ ποιοῦμεν τὴν ἀλήθειαν
```

As a datool document (the `document` JSON of one `Analysis` row):

```jsonc
{
  "schemaVersion": 2,
  "propositions": [
    { "id": "p1", "label": "6a", "source": { "kind": "corpus", "start": 124771, "end": 124772 } },
    { "id": "p2", "label": "6b", "source": { "kind": "corpus", "start": 124773, "end": 124777 } },
    { "id": "p3", "label": "6c", "source": { "kind": "corpus", "start": 124778, "end": 124782 } },
    { "id": "p4", "label": "6d", "source": { "kind": "corpus", "start": 124783, "end": 124783 } },
    { "id": "p5", "label": "6e", "source": { "kind": "corpus", "start": 124784, "end": 124788 } }
  ],
  "forest": [
    {
      "kind": "bracket", "rel": "CndE", "prominent": 1,          // C? → E*
      "children": [
        {
          "kind": "bracket", "rel": "FtIn", "prominent": 1,      // Ft → In*
          "children": [
            { "kind": "prop", "ref": "p1" },
            {
              "kind": "bracket", "rel": "Adv", "prominent": 0,   // 6b stands despite 6c
              "children": [
                { "kind": "prop", "ref": "p2" },
                { "kind": "prop", "ref": "p3" }
              ]
            }
          ]
        },
        {
          "kind": "bracket", "rel": "Ser", "prominent": null,    // coordinate Series
          "children": [
            { "kind": "prop", "ref": "p4" },
            { "kind": "prop", "ref": "p5" }
          ]
        }
      ]
    }
  ]
}
```

A document may also carry `"sections": ["p3", …]` — the analyst's COLOR BLOCKS,
stored as the pids that begin one (the first proposition never appears: the
document already opens inside its first block). Blocks are never proposed
automatically; the editor's right-edge strip adds and removes them by hand.

A document may also carry `"textFlow"` — the student's **Text Flow**, the passage
written out one clause per line, dependent clauses indented under what they modify,
embedded clauses marked in place. It is a pedagogical reading kept alongside the
analysis, not a second copy of it:

```jsonc
{
  "textFlow": {
    "lines": [
      { "start": 124771, "end": 124772, "indent": 0 },
      { "start": 124773, "end": 124777, "indent": 1,
        "embedded": [ { "start": 124774, "end": 124775, "style": "paren" } ] },
      { "start": 124778, "end": 124788, "indent": 2 }
    ]
  }
}
```

Invariants: `lines` holds at least one line; every `start`/`end` is an inclusive
corpus range inside the corpus; the lines are **contiguous and ordered** — each
line begins one word after the previous line ends, so the flow is one gapless run
of words; `indent` is an integer 0–8; each `embedded` range lies inside its own
line, the ranges are strictly ordered and non-overlapping, and `style` is `"paren"`
or `"bracket"`. Legacy v1 documents simply carry no `textFlow`.

**Where the lines are DIVIDED is not the flow's own: one line per corpus
proposition, always.** The two views are two readings of one division, so dividing
in either divides both — right-click a word to split after it, right-click a line's
(proposition's) last word to join it to the next, the same gesture in the bracket
editor and in the flow. A division made in the flow runs the EDITOR's command
(`AnalysisEditor`'s `actionsRef`), so both views and one undo history stay in step.
What the flow owns is how each line is SET: its `indent` and its `embedded` marks,
edited only in the panel. After any division the flow is re-cut to the propositions
(`reconcileFlow` in `frontend/src/textflow/textflow.ts`, `isAligned` deciding
whether it must run): a divided line leaves both halves at its indent, a joined one
keeps the upper line's, and an embedded stretch survives wherever it still falls
inside one line. The panel never starts a flow of its own — a document opened
without one, or with one that no longer matches its propositions, takes the derived
flow below, re-cut the same way, and that arrival is not an edit: the page stays
clean until the analyst changes something, and the flow travels with the next save.

**The first pass now derives the flow** (`da/treebuild.py`'s `build_text_flow`), so a
new analysis arrives with one already written — same at both levels, since the flow
is grammatical rather than semantic. Its lines are the stage-1 segments, and its
indents are read off the SAME within-sentence assembly the classifier runs
(`_assemble_sentence`, with an `_IndentRecorder` riding along — one pass, not a
second walk), following the course's rules: an independent clause stands flush, a
dependent unit one step under the clause it modifies, a coordinated clause level
with the clause it coordinates with, and a quotation one step under the clause that
introduces it. Inter-sentence logic never indents — the blank line is what separates
sentences. Interrupting relatives the segmenter kept inline come through as
`embedded` parenthesis marks. `GET /api/text-flow?start=&end=` runs the same
derivation for an analysis saved before this existed, and `AnalysisPage` fetches it
on load whenever the document has no flow, or one whose lines are no longer its
propositions — with a flush line per proposition as the fallback when the request
fails. There is no empty state and nothing to choose. Verified
against both worked examples in *Text Flow Instructions.pdf*: 1 John 1:5–10 comes
out line for line, and Matthew 8:23–29 matches every indent relationship (see
`da/tests/test_text_flow.py` for its three documented divergences).

Star walk: root `prominent: 1` → the Series packet → coordinate FAN, so the walk
continues into each member. Main point: **6d + 6e jointly** ("we are lying and do
not practice the truth") — matching the student's analysis. Every coordinate fans,
Progression included (the Mark 4:10–12 diagram highlights BOTH members of its
final P).

First-pass vs. student on this verse: the pipeline gets the ἐάν conditional, the
ὅτι content clause, and the 6d/6e Series right on its own. The καί before περιπατῶμεν
is genuinely ambiguous — first pass proposes Series, its default; the student's
interpretive override to **Adversative** ("though we walk in darkness") is exactly the
kind of one-click re-label the editor exists for.

## 4. Corpus foundation: MorphGNT SBLGNT

Source: [github.com/morphgnt/sblgnt](https://github.com/morphgnt/sblgnt) — the SBL Greek
New Testament with full morphological analysis. 27 files (`61-Mt-…87-Re-morphgnt.txt`),
one word per line, 7 columns:

```text
010102 V- 3AAI-S-- ἐγέννησεν ἐγέννησεν ἐγέννησε(ν) γεννάω
│      │  │        │          │         │           └ lemma
│      │  │        │          │         └ normalized form
│      │  │        │          └ word (punctuation stripped)
│      │  │        └ text as printed (with punctuation)
│      │  └ parsing: person tense voice mood case number gender degree
│      └ part of speech (N-, V-, RA article, C- conj, RR relative, P- prep, D- adv, X- particle …)
└ book/chapter/verse (BBCCVV)
```

~138k words total.

**Stored in code, not the database.** The 27 files ship with the app as static data. A
corpus module parses them at startup into an in-memory structure — a tuple of frozen
`Word` dataclasses (a word's global index is its stable ID, used by proposition
`source` ranges) — plus an n-gram index over normalized forms for paste alignment. No
corpus tables, no ingestion step, no migrations for reference data; corpus lookup and
the whole first pass are pure Python over static data. (Consequence: the app wants a
persistent-process host, not serverless — see §9.)

**Paste alignment:** normalize the pasted text (Unicode NFC, oxia/tonos unification,
strip verse numbers and critical-apparatus sigla), then locate it via the n-gram index.
A verbatim SBLGNT paste resolves to an exact reference range and every token picks up
its parsing and lemma (which also powers hover morphology in the editor for free).
Near-matches align partially with mismatches flagged; unmatched text falls back to
punctuation-only segmentation with no classification.

**Licensing:** SBLGNT text under the SBLGNT EULA (attribution required; re-verify
commercial terms before any paid offering); morphological analysis CC-BY-SA
(attribution + share-alike on the *data* — no effect on app code licensing).
Redistributing the files is how MorphGNT itself is distributed.

## 5. The first pass (rule-based, deterministic)

> **Status: stage 1 ON; stage 2 level is the USER'S choice at creation.**
> The Minimal/Full toggle on the home page (API: `maximal` on
> `/api/first-pass`) picks between minimal mode — the `_sure` calls in
> `da/treebuild.py` — and the full classifier, every judgment call included.
> Minimal is the default. Both modes are golden-tested; every diagram added
> to `examples/` audits the tiering
> (`test_minimal_tier_against_the_diagram`). Raw (unaligned) pastes arrive
> as disconnected punctuation-split roots: no morphology, no proposed
> structure. Review flags never reach documents (confidence labeling was
> removed from the product).

**What "minimal" means (the DA expert's re-tier).** `_sure` means exactly one
thing: *this join belongs in the minimal analysis*. It covers two kinds of
call, not one:

- calls the **grammar forces** — an explicit subordinator (ἐάν, ὅταν, ὥστε +
  infinitive, ὡς), οὐ … ἀλλά, μέν … δέ, a preposition + articular infinitive;
- **sensible defaults** — readings a competent analyst starts from and that
  the rule gets right roughly 80%+ of the time: δέ → Series, καί → Series,
  asyndeton → Series, οὖν → Inference, ἵνα → purpose (or content after an
  asking verb), causal ὅτι → Ground, a relative clause → Fact–Interpretation,
  an aorist participle before its clause → Temporal.

A default that is usually right is worth drawing: re-labelling one bracket is
cheaper for the analyst than drawing the whole structure by hand. Only
**genuinely undecidable** joins stay out of minimal — an implicit-proposition
prepositional phrase, an unknown subordinator, and the speculative groupings
(which clauses of an asyndetic run belong together). The 2026-08-29 rulings
moved two of the old hold-outs in: a **bare ἀλλά** is an Alternative (Q1) and
an **apposition** a Fact–Interpretation (Q2), both sure.
`build_document(confident_only=True)` keeps the maximal all-sure subtrees and
dissolves everything else into disconnected roots; the API contract is
unchanged, and Full still connects everything into one tree.

No ML/LLM in v1. The honest 80/20: relations signaled by explicit connectives are the
easy 80%; the rest is the user's interpretive work, and the pipeline's job there is to
propose a structurally valid default and get out of the way.

**Stage 1 — proposition segmentation** (from morphology + punctuation):

- Sentence breaks at `.` `·` `;` (from the with-punctuation column).
- Each finite verb (mood indicative/imperative/subjunctive/optative) anchors a clause.
- Dependent-unit openers start a new segment: subordinating conjunctions
  (ὅτι, ἵνα, ἐάν, εἰ, ὅταν, ὡς, ὥστε, ἐπεί, καθώς, …) and relative pronouns (`RR`).
- **Adverbial participles** (participle *not* governed by an agreeing article) are
  segmented out; attributive/substantival participles (article + case/number/gender
  agreement) stay inline.
- **Adverbial infinitives** (preposition + article + infinitive: εἰς τό, διὰ τό, μετὰ
  τό, τοῦ + inf.) are segmented out; complementary infinitives after δύναμαι, μέλλω,
  θέλω, ἄρχομαι-class governing verbs (small lemma list) stay inline.
- ἰδού/ἴδε interjections stay inline (lemma check).
- A dependent unit interrupting its host clause is kept in place and marked embedded
  (parenthesized in display).
- Coordinating conjunctions (καί, δέ, ἀλλά) open a new segment when they join
  clauses — the current clause must already have its own verb, and a verb must
  follow before the next boundary.
- **Implicit propositions — err toward splitting**: a trailing prepositional
  phrase directly after a comma (Eph 1:14 εἰς ἀπολύτρωσιν…, εἰς ἔπαινον…), a
  comma-preceded article apposition (Eph 1:13 τὸ εὐαγγέλιον…), and the
  attributive article + preposition construction (Phil 1:11 τὸν διὰ Ἰησοῦ
  Χριστοῦ) split into their own propositions, classified by preposition
  (εἰς/πρός→M-Ed, ἐν→Loc, διά/ἐκ/ἀπό→G, ἕως/ἄχρι/μέχρι→T; appositions→Ft-In).
  These stay OUT of the minimal analysis — the expert has not ruled on them,
  and which proposition a bare phrase implies is the interpretive call.
  Over-splits are repaired with the editor's merge.

Each segment records *why* it opened (connective lemma, relative, participle,
infinitive, prepositional phrase, apposition, asyndeton) — that metadata
drives Stage 2.

**Stage 2 — tree construction + classification** (a shift-reduce pass over clause
units; dependents attach to their host, innermost first, so nesting and contiguity hold
by construction):

- Within a sentence: each dependent attaches to its host clause (nearest preceding
  independent; a protasis attaches forward to its apodosis) with the relationship its
  connective signals and the star on that type's default side.
- Connective → relationship table (our own compilation from standard grammar — **not**
  Beale's copyrighted lexicon):

  | Signal | Relationship | In minimal? |
  |---|---|---|
  | γάρ | Ground `G` | yes — grammar |
  | οὖν, διό, ἄρα, ὅθεν, τοίνυν | Inference `∴` | yes — grammar (mid- *and* inter-sentence) |
  | ἵνα, ὅπως — English cue "that" **with a communication/volition verb in the preceding clause** (Q9) | Fact–Interpretation `Ft/In` (content) | yes — cue |
  | ἵνα, ὅπως — English cue "so that"/"in order that" | Means–End `M/Ed` (purpose) | yes — cue |
  | ἵνα, ὅπως preceded by a coordinator, with an earlier ἵνα in the sentence (Q7) | inherits that sibling's call | yes |
  | ἵνα, ὅπως after an asking verb (ἐρωτάω, αἰτέω, παρακαλέω, δέομαι, προσεύχομαι, εὔχομαι, ἀξιόω) | Fact–Interpretation `Ft/In` (content of the request) | yes — default |
  | ἵνα, ὅπως otherwise | Means–End `M/Ed` (purpose) | yes — default |
  | ὥστε **+ infinitive** | Cause–Effect `C/E` | yes — grammar |
  | ὥστε + finite verb, English cue "so that"/"as a result" | Cause–Effect `C/E` | yes — cue |
  | ὥστε + finite verb, English cue "therefore"/"so then" | Inference `∴` | yes — cue |
  | ὥστε + finite verb, no cue (incl. sentence-initial ∴-use) | Cause–Effect `C/E` | no — best guess |
  | ἐάν, εἰ | Conditional `C?/E` | yes — grammar |
  | ὅταν, ὅτε, ἕως, πρίν … | Temporal `T` | yes — grammar |
  | ὅπου, οὗ | Locative `L` | yes — grammar |
  | καθώς, ὥσπερ, καθάπερ, ὡσεί | Comparison `//` | yes — grammar |
  | ὡς | Comparison `//`, or Temporal `T` / `Ft/In` when the English cue says so | yes |
  | οὐ … ἀλλά | Negative–Positive `−/+` | yes — grammar |
  | bare ἀλλά (Q1) | Alternative `Alt` | yes — default |
  | μέν … δέ | Alternative `Alt` | yes — grammar |
  | δέ rendered "but"/"yet" by the BSB (Q1) | Alternative `Alt` | yes — cue |
  | δέ without μέν, not contrastive | Series `S` | yes — default |
  | καί, οὐδέ, τε joining clauses | Series `S` | yes — default |
  | asyndeton (within or between sentences) | Series `S` | yes — default |
  | speech introduction — a verbum dicendi (the βοάω/κράζω class included, Q11a) in the closing clause + `·`, or an ELIDED verb: no finite verb at all + `·` + a quotation opening in the next sentence (Q11b) | Fact–Interpretation `Ft/In` | yes — default (re-mark S/R by hand) |
  | ὅτι — English cue "that" / "because" | `Ft/In` / Ground `G` (the primary test) | yes — cue |
  | ὅτι with no English cue, after λέγω/οἶδα/γινώσκω-class | Fact–Interpretation `Ft/In` | yes — grammar |
  | ὅτι otherwise (causal) | Ground `G` | yes — default |
  | relative clause | Fact–Interpretation `Ft/In` | yes — default (nearest-clause scope) |
  | preposition + articular infinitive (εἰς τό, ἐν τῷ, διὰ τό …) | per the table | yes — grammar |
  | other adverbial infinitive | Means–End `M/Ed` | yes — default |
  | adverbial participle | English cue, else `docs/participle-rules.md` | yes — every tier |
  | apposition (Q2) | Fact–Interpretation `Ft/In` | yes — default |
  | implicit-proposition PP | English cue (Q3), else by preposition | **no — the implied proposition is the open question, not its relation** |
  | unknown subordinator or coordinator | Series `S` | **no** |

- Between sentences: everything is connected into **one complete tree**. Sentence-initial
  connectives classify via the table; asyndeton and bare καί default to a Series chain,
  nesting to the left, one binary bracket per join.
- The minimal/Full split is driven entirely by the internal `_sure` mark, which
  is private bookkeeping: it is stripped before the document is returned. The
  builder sets no `flag` at all — a `review` flag is the analyst's own, set in
  the editor.

**Sectioning — big–small–big** (`docs/sectioning.md`, built). The sentence
fold does not run over the whole passage. By the expert's ruling the passage
is first chunked into its major logical **sections**, each section is folded
internally, and only then are the section packets folded together — everything
inside a section connects before the section connects outward. A section is a
run of WHOLE sentences, so stage 1 and within-sentence assembly are untouched.
Seams are scored from a weighted indicator table (`SEAM_WEIGHTS`, threshold 1,
one entry per indicator so adding one is a line), read off the BSB structure
marks (`da/corpus/structure.py`) and the morphology. **HARD** (2): a section
**heading** and both bounds of a **quotation**. **STRONG** (1), each a seam on
its own: a **paragraph** break, sentence-initial **οὖν**, **διό/διὰ τοῦτο**, a
**narrative scene-setter** (μετὰ ταῦτα, ἐν ἐκείναις ταῖς ἡμέραις, καὶ
ἐγένετο, τότε, or an opening genitive absolute — narrative books only), a
**rhetorical-question opener** (an interrogative first, the Greek `;` last),
and a **vocative** in a letter. **SOFT** (0.5), never a seam alone but
combining with each other at 0.5 + 0.5: a **mood/person shift**, **epistolary
asyndeton**, a **lexical-cohesion drop** (no content lemma shared with the
previous sentence), the **English period**, and a vocative outside the
epistles. A module-level `GENRE` table maps book number → narrative (1–5 and
27, Revelation counting narrative) or epistle (6–26) for the three
genre-sensitive indicators.

The critical ruling is that *the speech verb rides with its speech*: a seam
before a quotation falls BEFORE the dicendi sentence introducing it (the
`VERBA_DICENDI` + `·` machinery — λέγων, the βοάω class, and an ELIDED speech
verb in front of a quotation all included), never between the two, and a
quotation opening mid-sentence never splits that sentence. One further seam is
structure-dependent and comes after the within-section fold: a "because" block
whose support **develops across a sentence boundary** — a sentence-level γάρ
Ground, or a causal ὅτι inside the sentence, plus the sentences the fold would
Ser-chain onto it — is section-sized and is promoted to a section of its own.
The section fold then reuses `_sentence_join` unchanged, the new section's
first sentence deciding the relationship (γάρ → Ground, οὖν → Inference,
δέ/καί/asyndeton → Series, a dicendi close before a speech section → Ft/In),
with its normal tiers: sectioning changes the SHAPE of the minimal analysis
rather than the tier of any join, since a within-fold join cannot cross a seam
by construction. The sections are also emitted as the document's `sections`
colour blocks, so the division the analyzer read is visible in the editor
immediately. Corpus-wide the NT's 10,523 sentences fall into 6,268 sections
(1.7 sentences each — 6,146 from the surface indicators, 122 more from the
promotion pass) and every chapter still builds and validates in both modes.
Whether the soft-pair rule sections too finely is the open calibration
question; `docs/sectioning.md` states it with the numbers.

**The English-cue layer** (`docs/english-cue-rules.md`, built) sits over the
ambiguous triggers. Greek connectives and participles are systematically
ambiguous, but the aligned BSB translation says which sense the context
carries — the translators already did the interpretive work. For each such
segment `da/treebuild.py` assembles its aligned English in BSB word order
(`segment_english`, grouping by verse since the order keys only compare within
one) and matches the LEADING phrase against the cue table (`leading_cue`,
longest-first and word-boundary anchored); the connective's own cell is a
fallback probe (`opener_english`) for single-word connectives whose segment
opens with something else. It applies to **ὅτι** (cue primary — "that" → Ft/In,
"because"/"for" → Ground — with the verbum-dicendi heuristic as the fallback
for the direct speech the BSB leaves unmarked), **adverbial participles** (the
cue outranks the tense/position defaults, chart rules 5–11, but not the
grammar-forced rules 1–4), **ὥστε + finite verb** (out of minimal by the
ruling, RESURRECTED to a sure C/E by "so that"/"as a result" or to a sure
Inference by "therefore"), **ἵνα/ὅπως** (the cue overrides the asking-verb
list, except that its "that" needs a communication/volition verb in the
preceding clause to outrank the purpose default — Q9) and **ὡς** alone among
the comparatives ("when" → Temporal, "that" → Ft/In). Cue-derived calls are
`_sure`: a translator's reading is exactly the sensible-default tier. Two
triggers were added by the rulings: **δέ** reads the contrastive "but"/"yet"
rows as an Alternative (Q1 — and no other trigger accepts `Alt`, which is what
fences those rows to it), and **implicit-proposition PPs** take a cue for
which relationship they carry (Q3) while staying out of minimal, since what
keeps them out is whether the implied proposition is drawable at all.
A segment with no usable English falls back to the grammar-only rules
unchanged. Corpus-wide the layer relabels 4.1% of the brackets Full draws;
against the worked diagrams it gains Acts 2:37's Temporal on Ἀκούσαντες and
1 John 1:7's Alternative.

**Adverbial participles** get their own classifier — the Wallace/Keating chart as an
ordered rule list (`docs/participle-rules.md`, source `documents/Adverbial
Participles.pdf`): καίπερ → Adversative, genitive absolute → Temporal, future →
Means–End, λέγων introducing speech → rides with its dicendi clause as `W/Ed`,
then **the English cue**, then perfect or οὐ-negated → Ground, aorist before an
aorist **imperative** → attendant-circumstance Series (Q5 narrowed this from
"imperative or indicative": the narrative indicative pairs read Temporal),
aorist before its clause → Temporal, present after → `W/Ed`, present before →
Temporal, residual → Temporal (Q4 confirms the residual).
Every tier joins the minimal analysis. "Before/after its clause" is the segment's
position in the shift-reduce pass: held and attaching forward = before, attaching
backward to the stack = after.

**Golden tests:** the course materials contain worked analyses — Heb 4:9–12 (Five Step
walkthrough) and 1 John 1:5–10 (`examples/da1.xlsx`). The first-pass test suite runs
those passages and compares output structure against the documented answers. Both are
fully connective-driven, so their minimal analysis is now identical to their full one.
The four student spreadsheets and the transcribed hand-drawn diagrams carry pinned
scorecards in `da/tests/test_relationing_golden.py` and `test_tree_golden.py`: how many
brackets each mode draws, which of the student's it reproduces exactly, and which
defaults it labels differently — so every classifier change has to be argued for
bracket by bracket. `da/tests/test_english_cues.py` pins the cue layer the same way:
every expectation is a real NT verse whose BSB English actually carries the cue, and
`da/tests/test_sectioning.py` pins sectioning at three levels — the seam scorer on its
own (marks in, seams out), the detection against real passages with the BSB marks
asserted beside the seam they cause, and the consequences (the promotion pass, the
section fold, the no-join-spans-a-seam invariant, the colour blocks).

## 6. Editor foundation: ProseMirror via Tiptap

Requirement: build on an established editor package rather than hand-rolling mechanics.
No open-source bracketing/arcing editor exists to fork (Biblearc is commercial and
closed), so the foundation is **ProseMirror** — *the* toolkit for schema-constrained
nested-document editing (MIT; powers the NYT, Guardian, Atlassian, GitLab editors) —
via **Tiptap**, its maintained React-friendly wrapper (core MIT). No payment, no
watermark, for either.

What the framework provides vs. what we build:

- **Schema content expressions encode the invariants**: `bracket := (proposition |
  bracket){2,}`, one root unit per document. Invalid trees are *unrepresentable* — the
  "enforce structure" decision implemented at the data-structure level. Relationship
  type, prominent index, reversed, and flags are node attributes.
- **Built-in transforms are the bracket operations**: `wrapIn` = relate selection,
  `lift` = dissolve bracket, attribute updates = re-label / move star / reverse /
  confirm flag. Legality checks come with them. Proposition **split** (double-click
  the word it should divide before — implicit propositions are the interpreter's
  call) and **merge** (two adjacent sibling propositions; contiguous corpus ranges
  re-join, anything else degrades to a raw source) are custom transactions on the
  same model, with labels recomputed automatically.
- **Undo/redo** via prosemirror-history (invertible transaction steps) — restructuring
  without eraser marks is half the product's pitch. The same step model enables
  real-time collaboration later (prosemirror-collab / Yjs) if classroom features want it.
- **Selection, keyboard, IME, copy/paste** handled by the view layer. Proposition rows
  are atom node views rendered as React components (read-only Greek in v1, with
  hover-morphology from the corpus); if translation lines return later, editable text is
  ProseMirror's home turf.
- **We build**: the SVG margin overlay that draws brackets/labels/stars from measured
  row positions (labels and stars are clickable controls), and the unit-selection UX
  (click to select a proposition/packet, shift-click to extend across adjacent units).

Fallback if Tiptap chafes in practice: Lexical (Meta, MIT). React Flow was evaluated
and ruled out — it solves free-form node dragging, which this editor deliberately
doesn't have.

## 7. Data model (Django)

**Document-model, not relational.** The analysis is edited and saved as a unit; nothing
in v1 queries inside analyses across rows. The entire relational schema:

```python
class Analysis(models.Model):
    owner          = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                       on_delete=models.CASCADE, related_name="analyses")
    title          = models.CharField(max_length=200)
    passage_ref    = models.CharField(max_length=100, blank=True)   # set by alignment
    schema_version = models.PositiveSmallIntegerField(default=1)
    document       = models.JSONField()                             # §3 shape
    created_at     = models.DateTimeField(auto_now_add=True)
    updated_at     = models.DateTimeField(auto_now=True)
```

- **Validation**: a ~50-line Python validator is the authority (the ProseMirror schema
  mirrors it client-side for UX): a non-empty `forest`, whose in-order leaves across all
  roots (roots in list order) == the proposition list, every leaf used exactly once,
  bracket arity ≥ 2, `prominent` set iff subordinate type, `rel` in the taxonomy. Runs
  on every save, and accepts legacy v1 (`tree`) documents as a forest of one.
- **Taxonomy defined once** in Python (code, name, family, symbols, has-star, default
  star side) and exported as JSON to the frontend, so classifier, validator, and editor
  UI cannot drift.
- **Auth: single-user mode in v1** — no login on localhost; `owner` stays null. Django
  auth + DRF permissions switch on at first real deployment (the FK already exists, so
  it's a permission change, not a remodel).
- Postgres `JSONField` is `jsonb`: if analytics across analyses ever matter, the
  document is indexable/queryable in place — relational normalization remains a
  possible future, not a prerequisite.

**API (DRF):**

- `GET/POST/PUT/DELETE /api/analyses[/id]` — CRUD; server-side validation on write.
- `POST /api/first-pass` — body: pasted text → response: aligned, segmented, classified
  `document` JSON + passage ref.
- `GET /api/corpus/words?range=` — parsing/lemma details for hover.
- `GET /api/taxonomy` — the relationship table.

## 8. Architecture & development environment

```text
React + Vite + Tiptap SPA  ──JSON──  Django + DRF
                                      ├─ corpus module (in-code MorphGNT + n-gram index)
                                      ├─ first-pass service (pure Python)
                                      ├─ validator + taxonomy (single source of truth)
                                      └─ Postgres (user data only)
```

- **Localhost-first**: `manage.py runserver` + Vite dev server; demos run locally before
  any hosting decision.
- **Local DB: Docker Compose Postgres 17** (`docker-compose.yml`, volume,
  `DATABASE_URL=postgres://…@localhost:5432/datool`) — same engine as production.
- **Hosting: host-agnostic by design** — "any persistent Python process + Postgres."
  The in-memory corpus favors persistent hosts (Railway/Fly-class) over serverless.
  Production DB: the existing **Supabase Postgres** via `DATABASE_URL`
  (direct/session-pooler; DB administration stays in Supabase's dashboard). The repo's
  Django-on-Vercel template scaffolding is removed when implementation starts.

## 9. Build order

1. **Corpus module** — static MorphGNT data, `Word` dataclasses, n-gram index, paste
   alignment. Pure backend, tested against known verses.
2. **First-pass service** — segmentation + classification, pure Python, golden tests
   against the course's worked examples (§5).
3. **Editor** — Tiptap schema + commands, SVG bracket overlay, taxonomy-driven controls,
   save/load round-trip through the validator.
4. Later phases (below), each planned separately.

## Out of scope for v1

Recorded as named future phases only: Text Flow stage (clause-indentation view/editor),
English translation lines, summary/exegetical-idea/homiletical-idea fields, connective
hints (must be original content — Beale's *Interpretive Lexicon* is copyrighted),
accounts/auth (switches on at first deployment), classroom features
(assignments/review), exports (PDF/PNG/xlsx), additional corpora, LLM-assisted
classification, and a **visual design pass** (explore options, make it visually
appealing — deliberately scheduled after basic functionality works; v1 styling stays
plain and functional).

## Licensing summary

| Component | License | Effect |
|---|---|---|
| Django, DRF, React, Vite | BSD/MIT | none |
| ProseMirror, Tiptap core, Lexical | MIT | free incl. commercial; no watermark |
| MorphGNT morphology | CC-BY-SA | attribution + share-alike on the data only |
| SBLGNT text | SBLGNT EULA | attribution; re-verify terms before selling |
| World English Bible (`da/corpus/data/web-nt.tsv`) | public domain | verse-level reference (served by /api/corpus/verses); "World English Bible" name is trademarked — credit politely |
| TBESG glosses (`da/corpus/data/glosses.tsv`) | CC BY 4.0 | attribution: STEPBible.org data by Tyndale House, Cambridge |
| TAGNT word English (`da/corpus/data/word-english.tsv`) | CC BY 4.0 | per-word contextual English (the row reference line); same attribution |
| Beale, *Interpretive Lexicon* | copyrighted | reference for humans; nothing ships |
| Arborator, reactive-dep-tree | AGPL | ideas only — never copy code |
