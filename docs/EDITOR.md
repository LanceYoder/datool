# The analysis editor

The analysis page has three parts: the **tree** in the left margin, the
**passage** (one row per proposition) beside it, and the **text flow** and
**notes** below. The **?** button in the toolbar lists every gesture.

## Tree rules

- Every bracket joins **exactly two** sides. A longer run is a chain of
  brackets: Series(Series(a, b), c), never one three-way bracket.
- Brackets never cross, and propositions never change order.
- Subordinate relationships have a star on one side; coordinate ones don't.
- The **main point** is found by following the stars from the top. It is
  highlighted once the tree is a single connected tree.

## Tree gestures

Every proposition and every bracket has its own **dot**, and a dot always
means exactly that unit.

- **Connect**: click a dot, then the dot of an adjacent unit (or drag from
  one to the other). The new bracket starts as **Series**, and the
  relationship menu opens beside the tree. Pick a relationship or press its
  key (`s` Series, `g` Ground, `f` Fact–Interpretation, `/` Comparison,
  `c` Cause–Effect, `?` Conditional, …; the menu shows them all).
  Clicking away keeps Series.
- If a unit you connect already belongs to a relationship, that one
  relationship breaks (only that one, nothing above it). While you aim,
  any bracket that would break is highlighted. Units waiting in a hanging
  side (below) just move; nothing breaks.
- Units that aren't adjacent, or where one contains the other, can't be
  connected: the dot shakes, and nothing else happens.
- **Relabel**: click the bracket's label. **Move the star**: click it.
- **Delete**: right-click a dot (or select it and press Delete). Only that
  one relationship goes. Nothing else on the page moves.
- **Undo / Redo** and **Clear tree** (removes every relationship) are in
  the toolbar.

### Hanging sides

Deleting a relationship inside a larger tree leaves what it held
**hanging**: drawn as a dashed tick with a loose-end dot, still part of
the bracket above it. A hanging side is where you reassemble:

1. Connect the units inside it to each other as usual.
2. When it holds a single unit, connect the **loose-end dot** to that unit
   to finish it.

Nothing finishes itself: a hanging side stays hanging until you do step 2.
Picking up a loose-end dot and moving it stretches the bracket and flexes
the tree around the pointer, so the tree is already in its final position
when you connect. A tree with hanging sides saves normally, but has no main
point until they are finished.

## Propositions

- **Split**: right-click the word a proposition should end on.
- **Merge**: right-click the last word of a proposition to join it with
  the one below.

Split and merge keep the rest of the tree. If the split proposition
belonged to a relationship, its two halves hang there, waiting to be
reconnected; a merge removes only the relationships that would otherwise
cut the joined proposition in two.

## Color blocks

The strip on the far right shows the passage's sections as colored bands
behind the text. Hover the strip between two propositions and click **+**
to start a block there, or **−** to remove a boundary. The auto-analyzer
fills in its own section guesses when an analysis is created.

## Text flow

The passage written out one clause per line, under the tree. Its lines
always match the propositions.

- **Tab / Shift-Tab** changes a line's indentation.
- **Enter** splits a line, **Backspace** at a line's start or **Delete**
  at its end merges. These are the same split and merge as in the tree,
  so both views change together and share one undo history.
- Parentheses and brackets can be typed around embedded clauses.

New analyses arrive with a text flow derived by the analyzer.

## Toolbar and display options

These are per-reader preferences, saved in the browser rather than in the
analysis:

- **English**: word-by-word English above the Greek. Click any Greek or
  English word for its lemma, gloss and parsing.
- **Verses**: the whole passage in BSB or ESV above the editor.
- **Verbs**: bold every verb form.
- **Blocks**: show the color blocks and their strip.
- **Color coding**: color brackets by relationship; **Colors…** sets a
  custom palette.
- The **skin** picker in the header (Original, Book, Notebook, Slate)
  changes the whole look.

A tree wider than its margin scrolls sideways without moving the text.
**Print** scales the analysis to fit the page.

## Read-only mode

A professor opening a student's analysis sees it read-only: every editing
control is gone, and the reading aids stay.
