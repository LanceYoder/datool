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

- Every proposition is connected into the analysis.
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
- **Contiguity is derived, not stored.** A tree is valid iff its in-order leaves equal
  the proposition list. "Brackets never cross" needs no checking; it is unrepresentable.
- **The main point is computed**, not stored: walk from the root following
  `prominentChildIndex` (at coordinate nodes, the whole packet is the point).
- **Layout is deterministic**: nesting depth → margin column. There is no drag-and-drop
  canvas and no persisted geometry — rendering is a pure function of the tree.

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
  "schemaVersion": 1,
  "propositions": [
    { "id": "p1", "label": "6a", "source": { "kind": "corpus", "start": 124771, "end": 124772 } },
    { "id": "p2", "label": "6b", "source": { "kind": "corpus", "start": 124773, "end": 124777 } },
    { "id": "p3", "label": "6c", "source": { "kind": "corpus", "start": 124778, "end": 124782 } },
    { "id": "p4", "label": "6d", "source": { "kind": "corpus", "start": 124783, "end": 124783 } },
    { "id": "p5", "label": "6e", "source": { "kind": "corpus", "start": 124784, "end": 124788 } }
  ],
  "tree": {
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
}
```

Star walk: root `prominent: 1` → the Series packet → coordinate, stop. Main point:
**6d + 6e jointly** ("we are lying and do not practice the truth") — matching the
student's analysis.

First-pass vs. student on this verse: the pipeline gets the ἐάν conditional, the
ὅτι content clause, and the 6d/6e Series right on its own. The καί before περιπατῶμεν
is genuinely ambiguous — first pass proposes Series with a `review` flag; the student's
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
- Coordinating conjunctions (καί, δέ, ἀλλά) open a new segment when a new finite verb
  follows.

Each segment records *why* it opened (connective lemma, relative, participle,
infinitive, asyndeton) — that metadata drives Stage 2.

**Stage 2 — tree construction + classification** (a shift-reduce pass over clause
units; dependents attach to their host, innermost first, so nesting and contiguity hold
by construction):

- Within a sentence: each dependent attaches to its host clause (nearest preceding
  independent; a protasis attaches forward to its apodosis) with the relationship its
  connective signals and the star on that type's default side.
- Connective → relationship table (our own compilation from standard grammar — **not**
  Beale's copyrighted lexicon):

  | Signal | Relationship | Confidence |
  |---|---|---|
  | γάρ | Ground `G` | confident |
  | οὖν, διό, ἄρα | Inference `∴` | confident |
  | ἵνα, ὅπως | Means–End `M/Ed` | confident |
  | ὥστε | Cause–Effect `C/E` | confident |
  | ἐάν, εἰ | Conditional `C?/E` | confident |
  | ὅταν, ὅτε | Temporal `T` | confident |
  | ὅπου, οὗ | Locative `L` | confident |
  | καθώς, ὥσπερ, ὡς | Comparison `//` | confident |
  | οὐ … ἀλλά | Negative–Positive `−/+` | confident |
  | μέν … δέ | Alternative `Alt` | confident |
  | καί joining clauses | Series `S` | **review** |
  | δέ | Series/Alt/Adv → best guess | **review** |
  | ὅτι after λέγω/οἶδα/γινώσκω-class | Fact–Interpretation `Ft/In` | **review** |
  | ὅτι otherwise | Ground `G` | **review** |
  | adverbial participle | Way `W` (or `T`) | **review** |
  | asyndeton | Series `S` | *(unflagged at discourse level, see below)* |

- Between sentences: everything is connected into **one complete tree**. Sentence-initial
  connectives classify via the table; asyndeton and bare καί default to a Series chain,
  **unflagged** — discourse-level defaults are ordinary brackets the user re-labels as
  their interpretation forms.
- Ambiguous connectives (the `review` rows) get a best-guess label plus a **`review`
  flag**, rendered visually distinct until the user confirms (one click) or re-labels.

**Golden tests:** the course materials contain worked analyses — Heb 4:9–12 (Five Step
walkthrough) and 1 John 1:5–10 (`examples/da1.xlsx`). The first-pass test suite runs
those passages and compares output structure against the documented answers, asserting
both what must match (explicit-connective calls) and what is allowed to differ
(review-flagged judgment calls).

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
  `lift` = dissolve bracket, `split`/`join` = adjust proposition boundaries, attribute
  updates = re-label / move star / reverse / confirm flag. Legality checks come with
  them.
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
  mirrors it client-side for UX): in-order leaves == proposition list, every leaf used
  exactly once, bracket arity ≥ 2, `prominent` set iff subordinate type, `rel` in the
  taxonomy. Runs on every save.
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
| Beale, *Interpretive Lexicon* | copyrighted | reference for humans; nothing ships |
| Arborator, reactive-dep-tree | AGPL | ideas only — never copy code |
