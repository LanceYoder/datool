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

An analysis starts **pre-split into clause propositions** (automatic
segmentation from the morphology) but with **no connections** — the tree
itself is built by hand:

1. **Create**: paste the passage → **Locate** (should read
   `1 John 1:5–7 — 70/70 tokens matched (exact)`) → **Create**.
2. **Split**: click any word → **Split after**. Labels re-derive from the
   corpus verses (11a, 11b, …; spans like 10–12 for units crossing verses;
   only raw non-NT text takes a prime ′). Split the block into clauses.
3. **Connect**: click a unit's dot (the small circle left of it), then click
   an adjacent unit's dot. The pair joins and the relationship menu opens.
   Clicking a selected dot unselects it. Only adjacent units connect — an
   invalid pair shakes.
4. **Reconnect**: dots stay clickable after connecting — connecting an
   already-connected unit somewhere else dissolves its old connections first.
5. **Relabel**: click a bracket's letter label (Ft, In, G, S, …) for the menu
   of all 18 relationships; root brackets also offer **Disconnect**.
6. **Star**: click a `*` to move prominence to the other member (the letter
   labels follow the star).
7. **Merge**: hover a row — **Merge below** appears after its last word.
8. **Main point**: once every proposition is connected into ONE tree, the
   proposition the star walk lands on (from the top of the tree, following
   the stars) turns red — the passage's main point. It follows the stars as
   you flip them, and clears if you disconnect anything.
9. **Undo/Redo**: toolbar buttons or Ctrl/Cmd-Z, Ctrl/Cmd-Shift-Z. Each
   gesture is exactly one undo step.
10. **Save / reload**: Save in the top bar, reload the page, reopen from the
    home list — the analysis must come back exactly as left.

Above each Greek row, a muted line shows the English of EXACTLY that
proposition's words — built word-by-word from the TAGNT contextual
renderings (STEPBible.org data by Tyndale House, CC BY 4.0), with small
verse numbers where a verse begins. It re-divides as you split and merge.
Clicking a word opens its info card: Split after on top, then the lemma
with transliteration, a short English gloss (TBESG, same source and
license), readable morphology, and the word's rendering here.

## Resetting

Delete `db.sqlite3` in the repo root and rerun
`uv run python manage.py migrate` for a clean slate.
