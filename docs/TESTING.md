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

An analysis arrives **pre-split into clause propositions**; how much of the
tree comes pre-drawn is the **Minimal / Full** toggle next to Create
(remembered per browser). **Minimal** (default) draws only the deterministic
connections — the joins an explicit marker settles and the worked examples
have never contradicted (γάρ grounds, ὅτι-content after a verb of saying,
conditionals, ὡς-comparisons, ὥστε results, οὐ…ἀλλά, sentence-closing
relatives, διό); every καί, every asyndeton, every judgment call is left
loose for the analyst. **Full** proposes a complete labeled tree — every
judgment call included — to be corrected rather than built:

1. **Create**: paste the passage (or just type a reference like `1 Jn 1:5-7`)
   — it locates itself while you type — pick Minimal or Full, then
   **Create**. In 1 John 1:5–7, Minimal pre-draws exactly one connection:
   the ὡς comparison in verse 7.
2. **Word info**: click any word for its card — lemma with transliteration,
   a short gloss, readable morphology, and the word's English here.
3. **Split**: RIGHT-click a word → the proposition divides after it. Nothing
   is pulled out of the tree: the side that held it now holds both halves and
   HANGS — a short dashed tick with a pickup dot on the end — waiting to be
   put back together. Only a bracket left hanging at BOTH ends gives way.
   Labels re-derive from the corpus verses (11a, 11b, …; spans like 10–12 for
   units crossing verses).
4. **Merge**: right-click the LAST word of a proposition — it joins with the
   one below. A fused proposition cannot be half inside a claim, so the
   brackets around the pair are settled innermost-outward and only the
   MINIMAL set gives way: one holding the word as a committed member breaks,
   one holding it as a lodger simply lets it go and survives, contracted. On
   the passage's final word nothing happens — there is nothing below to join
   it to.
5. **Connect**: dot to dot. **Hover** any dot first: the span it names lights
   up, because a dot means EXACTLY its own unit. The last proposition of a
   packet is that proposition; to take the packet, click the packet's own dot
   on its bracket. Click one dot, then an adjacent unit's dot — a line
   follows the pointer meanwhile, and clicking the armed dot again unarms it.
   The join SUCCEEDS whenever the two spans meet; the only refusals are
   geometric (not adjacent, or one already contains the other), and a refused
   pair shakes with the reason.
   While a dot is armed, **aim** at another one: the line snaps to it and
   draws the bracket that would be made, and every bracket the join would
   BREAK is washed in the warning ink — the bracket claiming either clicked
   unit, a bracket the join reaches across, and anything that comes down with
   them. An aim that cannot land says so in its own line instead. Nothing is
   hidden: what is highlighted is exactly what goes. Connecting a unit that
   already belongs to a bracket breaks that bracket — that is the rule, and
   you see it before you click. A lodger waiting in a room simply leaves it,
   and the bracket survives, contracted.
   The new bracket lands UNNAMED and its menu opens with **nothing
   preselected**: pick a relationship, or press Escape (or click away) to
   undo the whole join in one step. Nothing is saved while a join stands
   unnamed, and the toolbar says so until you settle it.
   A room's own pickup dot can be picked up — the tree flexes so you can see
   what is still loose — but a waiting group is not a unit, and clicking it
   says so. When a join fills a room's last slot, the bracket that was
   hanging flashes once: it is whole again.
6. **Disconnect**: right-click a dot — or select it and press Delete. WHICH
   relationship goes depends on the dot: a bracket's dot names its own
   bracket, a room's pickup dot names the bracket it hangs from, and a
   proposition's dot names the bracket that holds it. A proposition hanging
   from nothing has no relationship to delete and says so. What the deleted
   bracket held spills into the place it stood, a bracket thereby left
   hanging at both ends comes down after it, and nothing else on the page
   moves. **Clear tree** in the toolbar removes every connection at once.
7. **Relabel**: click a bracket's letter label (Ft, In, G, S, …) — including
   the empty box on a join you have not named yet — for the menu of all 18
   relationships; each row's ⓘ explains what the relationship means, and the
   listed shortcut keys pick one from the keyboard.
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
