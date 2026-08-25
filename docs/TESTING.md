# datool — running it locally for testing

Two processes: a Django API (port 8000) and a Vite dev server for the UI
(port 5173). No accounts, no configuration — the database is a local SQLite
file created on first run, and the Greek NT corpus ships inside the repo.

## One-time prerequisites

- **git**
- **uv** (Python package manager): https://docs.astral.sh/uv/getting-started/installation/
  - macOS/Linux: `curl -LsSf https://astral.sh/uv/install.sh | sh`
  - Windows (PowerShell): `powershell -c "irm https://astral.sh/uv/install.ps1 | iex"`
- **Node.js 20+**: https://nodejs.org (any current LTS)

## Start it

Terminal 1 — backend:

```sh
git clone -b claude/datool-frontend-framework-vn3g1b https://github.com/LanceYoder/datool.git
cd datool
uv sync
uv run python manage.py migrate
uv run python manage.py runserver
```

Terminal 2 — frontend:

```sh
cd datool/frontend
npm install
npm run dev
```

Open **http://localhost:5173**.

## A passage to paste (1 John 1:5–7, SBLGNT)

```text
Καὶ ἔστιν αὕτη ἡ ἀγγελία ἣν ἀκηκόαμεν ἀπ’ αὐτοῦ καὶ ἀναγγέλλομεν ὑμῖν, ὅτι ὁ θεὸς φῶς ἐστιν καὶ σκοτία ἐν αὐτῷ οὐκ ἔστιν οὐδεμία. ἐὰν εἴπωμεν ὅτι κοινωνίαν ἔχομεν μετ’ αὐτοῦ καὶ ἐν τῷ σκότει περιπατῶμεν, ψευδόμεθα καὶ οὐ ποιοῦμεν τὴν ἀλήθειαν· ἐὰν δὲ ἐν τῷ φωτὶ περιπατῶμεν ὡς αὐτός ἐστιν ἐν τῷ φωτί, κοινωνίαν ἔχομεν μετ’ ἀλλήλων καὶ τὸ αἷμα Ἰησοῦ τοῦ υἱοῦ αὐτοῦ καθαρίζει ἡμᾶς ἀπὸ πάσης ἁμαρτίας.
```

Any Greek NT passage works — paste from an SBLGNT or NA28 source and the app
locates it in the corpus. Non-NT text is accepted too (raw mode: no
morphology, no passage reference).

## What to test (the editor)

An analysis arrives **fully analyzed**: automatic segmentation splits the
passage into clause propositions and the automatic analyzer connects them
into one labeled tree — a first-pass *proposal*. Everything about it is
editable; what to test is overriding it:

1. **Create**: paste the passage (or just type a reference like `1 Jn 1:5-7`)
   — it locates itself while you type — then **Create**. The tree appears
   already built, with the main point(s) in red.
2. **Word info**: click any word for its card — lemma with transliteration,
   a short gloss, readable morphology, and the word's English here.
3. **Split**: RIGHT-click a word → the proposition divides after it.
   Splitting a connected proposition pulls it out of the tree first (the
   brackets over it dissolve). Labels re-derive from the corpus verses
   (11a, 11b, …; spans like 10–12 for units crossing verses).
4. **Merge**: right-click the LAST word of a proposition — it joins with the
   one below.
5. **Connect**: click a unit's dot (the small circle left of it), then click
   an adjacent unit's dot; a line follows the pointer while a dot is
   selected. The pair joins and the relationship menu opens. Clicking a
   selected dot unselects it; only adjacent units connect — an invalid pair
   shakes. Connecting an already-connected unit somewhere else dissolves its
   old connections first.
6. **Disconnect**: right-click a dot — or select it and press Delete — to
   remove the connections it names. **Clear tree** in the toolbar removes
   every connection at once.
7. **Relabel**: click a bracket's letter label (Ft, In, G, S, …) for the menu
   of all 18 relationships — each row's ⓘ explains what the relationship
   means, and the listed shortcut keys pick one from the keyboard.
8. **Star**: click a `*` to move prominence to the other member (the letter
   labels follow the star).
9. **Main point**: while every proposition is connected into ONE tree, the
   star walk from the top (fanning out across coordinate brackets) shows
   red. It follows the stars as you flip
   them, clears if you disconnect anything, and returns when the tree is
   whole again.
10. **Color blocks**: the passage sits on one muted background with a
    saturated band down the right edge. Hover the strip and a **+** appears
    at the nearest boundary between propositions — click it to begin a new
    block there (the block below takes the next color). Hovering an existing
    division offers **−**, joining it back to the one above. The **Blocks**
    switch hides the whole thing.
11. **Reader switches** (top left; per-browser, never saved in the
    analysis): the English reference line, bold Greek verbs, Blocks, and
    per-relationship **Color coding** with its Colors… panel.
12. **Undo/Redo**: toolbar buttons or Ctrl/Cmd-Z, Ctrl/Cmd-Shift-Z. Each
    gesture is exactly one undo step — block edits included.
13. **Save / reload**: Save in the top bar, reload the page, reopen from the
    home list — the analysis (blocks included) must come back exactly as
    left. **Notes** under the analysis save with it; deleting an analysis
    moves it to **Recently deleted** on the home page, where it can be
    restored for 30 days.

Above each Greek row, a muted line shows the English of EXACTLY that
proposition's words — built word-by-word from the TAGNT contextual
renderings (STEPBible.org data by Tyndale House, CC BY 4.0), with small
verse numbers where a verse begins. It re-divides as you split and merge.
The word card's gloss is TBESG (same source and license).

## Resetting

Delete `db.sqlite3` in the repo root and rerun
`uv run python manage.py migrate` for a clean slate.
