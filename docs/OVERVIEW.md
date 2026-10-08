# datool — overview

datool is a web app for **discourse analysis (DA)** of Greek New Testament
passages, in the bracketing method taught in Greek III (the course handouts
are in [`documents/`](../documents), worked student examples in
[`examples/`](../examples)).

You give it a passage, it breaks the Greek into propositions and proposes
the logical relationships between them, and you correct and finish the
tree in an editor built for the method.

## What a user can do

- **Start an analysis** by typing a reference (`Eph 1:13-14`) or pasting
  Greek. The passage is located as you type. Choose how much the
  auto-analyzer proposes: **Nothing**, **Minimal** (only the likely
  relationships) or **Max** (a full best-guess tree).
- **Edit the tree**: connect propositions, label relationships, move the
  star, delete relationships, split and merge propositions
  ([EDITOR.md](EDITOR.md)).
- **Color blocks**: mark the passage's sections with colored bands.
- **Text flow**: the passage written one clause per line with indentation,
  kept in step with the propositions.
- **Reading aids**: an English line above the Greek, word details on click,
  bold verbs, the whole passage in BSB or ESV, relationship color coding
  (with a custom palette).
- **Notes**, **print** (to paper or PDF), **save**, and a **Recently
  deleted** list that keeps deleted analyses for 30 days.
- **Accounts**: individuals, or organizations with professors and students,
  where a professor can limit the auto-analyzer and the reading aids
  ([ACCOUNTS.md](ACCOUNTS.md)).
- A **walkthrough tour** for new users ("Take tour" in the header).

## The method in one paragraph

An analysis relates **propositions** (clause-sized units) with nested,
never-crossing **brackets**. Each bracket joins exactly two sides and
carries one of 18 relationships: three **coordinate** ones (Series,
Progression, Alternative), where both sides are equal, and fifteen
**subordinate** ones (Ground, Inference, Fact–Interpretation, Conditional,
…), where a **star** marks the more prominent side. Following the stars
from the top leads to the passage's **main point**. The full list, with
symbols and descriptions, is defined once in
[`da/taxonomy.py`](../da/taxonomy.py) and served to the frontend.

## How it is built

```text
React + Vite + Tiptap (frontend/)  ──JSON──  Django + DRF (da/, config/)
                                              ├─ corpus: MorphGNT SBLGNT, in memory
                                              ├─ auto-analyzer (pure Python)
                                              ├─ document validator + taxonomy
                                              └─ SQLite (users and analyses)
```

- **Corpus.** The SBLGNT text with MorphGNT morphology ships in
  `da/corpus/data/` and is loaded into memory at startup (a word's index
  is its permanent ID). Alongside it: BSB verses and word alignment, the
  BSB's paragraph/heading marks, per-word English and lexicon glosses.
  Licenses are in `da/corpus/data/ATTRIBUTION.md`. ESV text is fetched
  live from Crossway's API.
- **Auto-analyzer.** Rule-based and deterministic, no AI
  ([ANALYZER.md](ANALYZER.md)).
- **Editor.** ProseMirror (via Tiptap) renders the proposition rows; the
  tree is a separate data model (`frontend/src/tree/core.ts`) drawn as an
  SVG overlay in the left margin.
- **Hosting.** One Fly.io app serves both the API and the built frontend
  ([DEPLOY.md](DEPLOY.md)).

## The analysis document

Each analysis is saved as one JSON document, checked by
[`da/documents.py`](../da/documents.py) on every save:

```jsonc
{
  "schemaVersion": 2,
  "propositions": [
    { "id": "p1", "label": "13a",
      "source": { "kind": "corpus", "start": 124771, "end": 124776 } }
    // a pasted passage that could not be located uses { "kind": "raw", "text": "…" }
  ],
  "forest": [                        // the tree(s), in reading order
    { "kind": "bracket", "rel": "Grnd", "prominent": 0,   // which side has the star
      "children": [ { "kind": "prop", "ref": "p1" }, { "kind": "prop", "ref": "p2" } ] }
  ],
  "sections": [ { "start": "p4", "color": 1 } ],          // color blocks (optional)
  "textFlow": { "lines": [ { "start": 124771, "end": 124776, "indent": 0 } ] }
}
```

- `forest` holds several roots while propositions are still unconnected; a
  finished analysis has one.
- Brackets always have exactly two children. `prominent` is `null` for
  coordinate relationships.
- `{ "kind": "hole", "children": [...] }` is a **hanging side**: units left
  waiting after an edit (see [EDITOR.md](EDITOR.md)). A document with holes
  saves fine but has no main point until they are resolved.

## Where things live

| Path | What |
| --- | --- |
| `da/corpus/` | corpus loading, reference parsing, paste alignment |
| `da/segmentation.py`, `da/treebuild.py`, `da/firstpass.py` | the auto-analyzer |
| `da/documents.py`, `da/taxonomy.py` | document rules, relationship table |
| `da/views.py`, `da/api/`, `da/urls.py` | the API |
| `da/models.py`, `da/policies.py` | analyses, accounts, teaching policies |
| `frontend/src/tree/` | the tree model and its operations |
| `frontend/src/editor/` | the analysis editor (rows, overlay, menus, strip) |
| `frontend/src/textflow/` | the text flow panel |
| `frontend/src/tour/` | the walkthrough tour |
| `frontend/src/pages/` | home, analysis, account, organization, teaching pages |
