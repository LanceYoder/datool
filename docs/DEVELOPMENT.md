# Development

How to start the app is in the [README](../README.md): Django on port 8000
and Vite on port 5173, which forwards `/api` to Django. The database is a
local SQLite file, and the Greek corpus ships in the repo.

The app needs an account: register at http://localhost:5173/register. In
development, emails (invitations, password resets) are printed to the
Django console instead of being sent.

## Tests

```sh
uv run pytest da/tests -q                    # backend
cd frontend && npx tsc --noEmit && npx vitest run    # frontend
```

- **Backend**: the analyzer's golden tests (`test_*_golden.py`,
  `test_english_cues.py`, `test_sectioning.py`, `test_text_flow.py`) run
  real passages and compare against the course's worked examples, and
  the document validator and every API endpoint have tests of their own.
- **Frontend**: `src/tree/__tests__/` covers the tree operations
  (scenario tests, plus property tests that check the tree rules after
  random edits). `src/editor/__tests__/` covers the editor, layout and
  serialization.

## Conventions

- **The relationship table** lives only in `da/taxonomy.py`. The frontend
  fetches it from `/api/taxonomy`; don't copy it.
- **Tree changes** go through the pure functions in
  `frontend/src/tree/core.ts`. Never edit the tree's JSON directly.
- **Check gestures in the browser.** A gesture isn't done until it has been
  clicked through in the running app, ideally on the analysis where the
  problem was reported. Unit tests alone aren't enough.
- **Nothing on the page should jump.** Edits must not shift the text or the
  tree, and a refused gesture shakes its dot without showing a message.
- **Display preferences** (toggles, colors, skin) are saved in the
  browser, never in the analysis document.

## Corpus data

`da/corpus/data/` holds the MorphGNT SBLGNT files and the BSB-derived
tables (verses, word alignment, paragraph/heading marks, word English,
glosses). Sources and licenses are in `da/corpus/data/ATTRIBUTION.md`.
Copyrighted references in `documents/` (e.g. Beale's *Interpretive
Lexicon*) are for reading only: none of their content ships in the app.
