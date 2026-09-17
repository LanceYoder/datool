# The tree engine, rebuilt from the ground up

Status: v3 — RULED. The analyst answered all open questions on 2026-09-05
(recorded in §9); this document is now the binding contract for
implementation. The old engine is ripped out; the acceptance catalogue is
`tree-engine-acceptance.md`. Where this document and any old behavior
disagree, this document wins.

History: v2 survived an adversarial review (three holes in the v1 connect
algebra, closed and pinned as tests). v3 replaces v2's growth-and-refusal
semantics with the analyst's ruling: LAST CLICK WINS — a connect breaks
the brackets that directly claim its endpoints instead of growing around
them or refusing.

## 0. Why the old engine kept breaking — the autopsy

Five mistakes were baked in, and every fix inherited them:

1. **The tree lived inside the text document.** Brackets and holes were
   ProseMirror nodes wrapping the propositions, so every structural edit
   was positional surgery on a nested document. An off-by-one-level error
   was structural corruption, not a wrong pixel.
2. **Containers could hold any number of children.** The schema allowed
   n-ary brackets, so a splice could silently produce a THREE-WAY
   bracket — the monster in the analyst's screenshot. Nothing in the
   data model forbade it.
3. **Waiting rooms were real nodes.** A hole was a node type, so rooms
   could nest, sit empty, or multiply, and a "settle" pass had to sweep
   up illegal states after every command.
4. **Four mechanisms where one algebra belonged.** Endpoint lifting,
   extraction, minimal dissolution, and the settle pass, composed by
   fallback. Their seams were where the bugs lived.
5. **The tests pinned the code, not a spec.** Expected outcomes were
   transcribed from what the engine did, so rewrites had no fixed star.

The rebuild inverts all five: structure lives OUTSIDE the text document
in a plain data model where illegal states are unrepresentable, every
gesture is one pure function under one landing algorithm, and this spec —
not the code — is the source of truth.

## 1. The objects

**Leaf** — one proposition: a contiguous run of corpus words with a label
(41b, 42c…). Leaves have a fixed left-to-right reading order. No gesture
may reorder leaves; only split/merge (§5.4, §5.5) change their number.

**Bracket** — one relationship. A bracket relates EXACTLY TWO sides,
always. There is no three-way bracket, ever; the data model cannot
express one. A bracket carries:

- `rel` — the relationship label (Ser, Alt, FtIn, Grnd, …),
- `star` — `'left' | 'right' | null` (prominence; null iff coordinate),
- `id` — a stable identity minted by the core (§7), never reused.

(`reversed` — whether a subordinate bracket's role labels sit in the
opposite order from the taxonomy's default — is NOT stored: it is fully
determined by `rel` + `star`, so the core computes it at render and
serialize time. The wire format still carries it for the server's sake;
the serializer writes the derived value. Ruled 2026-09-05.)

**Side** — each side of a bracket is an ordered, non-empty list of UNITS
(a unit = a leaf or another bracket):

- A side with **one** unit is **anchored**; that unit is **committed** —
  it belongs to this bracket, and the bracket's claim about that side is
  about a finished thing.
- A side with **two or more** units is **hanging** — the waiting room,
  drawn with the short tick and pickup dot exactly as today. The claim:
  "whatever this group turns out to be, once assembled, stands in my
  relationship to the other side." Its units are **lodgers** — unattached
  to each other, not members of the bracket.

**Forest** — the top level: an ordered list of root units.

A side's **run** is the concatenation of its units' spans, in order. Gone
from the model: hole nodes (a room is a side with >1 unit — derived, not
stored), empty rooms, nested rooms, n-ary brackets. None can be written
down.

## 2. The invariants

Asserted by the core after every op in dev and test builds.

- **I1 Binary.** Every bracket has exactly two sides. (By construction.)
- **I2 Non-empty.** Every side holds ≥1 unit. (By construction.)
- **I3 One hanging side.** At most one side of a bracket hangs. A bracket
  hanging at both ends says nothing and must not exist; any op that would
  produce one makes that bracket give way instead (§5.3's cascade).
- **I4 Contiguity & order.** The spans of a side's units, concatenated in
  order, form ONE contiguous run (this is the side's run); a bracket's
  left run immediately precedes its right run; the forest's roots
  partition the leaves in order.
- **I5 Single parenthood.** Every unit is a root or appears exactly once,
  in exactly one side of exactly one bracket.
- **I6 Leaf order is sacred.**
- **I7 Attribute coherence.** `star` null iff coordinate.

Vocabulary: a unit's **span** is its leaf run; spans **meet** when one
ends exactly where the other begins; a unit is **free** when it is a root
or a lodger; **committed** when it is the sole unit of an anchored side.
Classification is read off the state at hand — commitment has no history.
Mid-gesture states are working states: sides are finally classified, and
I3 finally checked, at the END of the gesture (this ordering is
load-bearing — see acceptance row 19).

## 3. The dots: exact-unit semantics (RULED, Q5)

Every unit — every leaf and every bracket — has its own dot. **A dot
names exactly its unit.** There is no implicit "lifting": clicking the
last leaf of a packet means that leaf, never the packet. To connect the
packet, click the packet's dot. Hovering any dot highlights the span it
names, so what a dot means is visible before it is armed.

## 4. The law: last click wins, minimal breakage, no surprises

The analyst's rulings (Q1, Q3) fix the philosophy:

> **A connect SUCCEEDS whenever the two spans meet. It breaks exactly
> the brackets that stand directly in its way — the bracket that claims
> a clicked unit as a committed member, and at most one bracket whose
> boundary the join crosses with no room to house it — and nothing
> else. Everything that will break is highlighted while aiming, before
> the click. The only refusals are geometric: the two units are not
> adjacent, or one contains the other.**

The moves that implement it:

- **Break** — the bracket directly claiming a clicked committed unit
  gives way with the SPILL MECHANICS of §5.3 (both sides' units, in
  order, into the position where it stood — the side that held it, or
  the floor); the I3 cascade is DEFERRED to the end of the gesture.
  Only the IMMEDIATE claimer breaks; every enclosing bracket adjusts by
  the ordinary spill/contract rules. If both endpoints are committed
  (in different brackets), both claimers break (Q3).
- **Release** — a lodger endpoint is MARKED for extraction from its
  room. Nothing moves yet: the endpoint keeps standing in its slot
  until the landing lifts it into N. (This timing is load-bearing: it
  is what keeps the landing site classifiable — see below — and it is
  why no release can strand the join or misclassify a side.)
- **Landing** — where the new bracket N lives. All classification here
  is done on the configuration AFTER step-1 breaks but WITH BOTH
  ENDPOINTS STILL STANDING in their slots; the landing itself then
  moves the endpoints into N in one act. A side's **extent** is its
  run (§1). Descend through the sides whose extent covers N's span
  (covering sides nest, so the chain is unique), into the innermost;
  then:
    1. **floor** (nothing covers N) → N is a root between its
       contracted neighbours.
    2. **a hanging side** covering N, where N's span crosses no unit's
       internal boundary within it → N becomes a lodger of that side,
       inserted at its span position; where an endpoint lived in that
       room, N takes its slot.
    3. **a bracket W inside the covering side (or the covering unit
       itself) whose internal boundary N's span crosses** — this case
       takes PRECEDENCE over rule 2 (landing N beside a bracket it
       reaches into would break I4/I5). At most one such W exists (see
       the boundary-uniqueness lemma). Two different counts are used,
       deliberately (implementation ruling 2026-09-05, forced by
       acceptance rows 18 and 19): a side IS A ROOM by its STANDING
       units (endpoints still in their slots); the AFTER-DEPARTURE
       count (units left once that side's endpoint moves into N)
       decides only rule 3b's anchor test.
       - Exactly one side of W is a room (≥2 standing) → N lands in
         it; W's boundary slides past what the other side gave up.
       - Both sides are rooms → N lands in the side whose OPPOSITE side
         would be left with exactly ONE unit after its endpoint
         departs (that side anchors, and W survives with one room); if
         both qualify, the left; if neither, W is a two-room shell — it
         gives way, its units spill in place, and N lands among them.
       - Both sides anchored (neither endpoint was committed in W —
         they came from rooms deeper inside its members) → W gives way,
         its two units spill in place, and N lands between them.
- **Cascade** — after landing, final classification: any bracket left
  hanging on both sides gives way (§5.3), upward, until quiet. The §5.2
  preview shows cascade deaths too — the aim never hides a consequence.

Recorded lemmas (state them in the core's doc comments; the property
suite asserts them):

- *Boundary uniqueness.* At most one bracket's internal boundary is
  crossable by N: any internal boundary strictly inside an endpoint's
  span belongs to a bracket contained in that endpoint (nesting + I4),
  so the only boundary N can cross without containing its bracket sits
  at the two endpoints' MEET POINT — and at most one bracket's boundary
  sits there, since two nested brackets cannot both end a left run and
  start a right run at the same point. (Step-1 spills never move spans,
  so this survives the breaks. The property suite asserts: every
  non-claimer, non-cascade break has its boundary at the meet point.)
- *Edge-lodger totality.* A lodger that is a connect endpoint is always
  at its room's fringe facing the join (span-meet guarantees it), so
  Release is total.
- *Bounded breakage.* One connect breaks at most: two claiming brackets
  (one per committed endpoint) + one crossed bracket + whatever the I3
  cascade of those spills takes. Each set is exactly enumerable before
  dispatch — which is what makes the §5.2 preview honest.

## 5. The operations

Every gesture is a pure function `(state, args) → new state | Refusal`,
where `Refusal = { code, message }`; the UI shakes and shows `message`.
A refusal changes nothing (state byte-identical).

### 5.1 Connect(u, v)

Order the clicked units by reading order. **Refuse** only for geometry:
spans don't MEET, containment, or self-connect. Otherwise the gesture
SUCCEEDS. Procedure (all one pure step; the numbered order is normative):

1. **Break claimers.** For each endpoint that is committed, its bracket
   gives way (spill mechanics of §5.3, cascade deferred). Exception:
   both endpoints are the two COMMITTED members of the SAME bracket B —
   a re-connection of an existing pair — and nothing structural
   changes: the relationship menu opens ON B, preloaded with its
   current rel and star; picking a new rel is an attribute edit; B
   keeps its id. (Non-example, because lodgers are not members: in
   `B[x, ⟨y z⟩]`, connect x·y is NOT the exception — B breaks, per
   acceptance row 23.)
2. **Mark lodger endpoints** for release from their rooms (they stand
   in place until the landing — §4).
3. **Build N** over the two endpoints and **land** it per §4. New
   brackets open the relationship menu with NO preselection (Q6): the
   bracket draws unlabeled until a rel is chosen, and Escape (or
   clicking away) undoes the whole join — one clean history step.
4. **Cascade check** (§4), then final classification.

Worked instances of every path are pinned in §6 and the acceptance
catalogue. Note what is GONE relative to earlier drafts: there is no
growth, no both-committed refusal, no delete-first detour. Connecting a
committed unit somewhere new means its old relationship breaks — that is
the ruling, and the preview shows the break before the click.

### 5.2 Signals: previews and events

- **Hover a dot** → its unit's full span highlights. Bracket dots sit at
  the bracket's label/apex, visually distinct from leaf dots.
- **Armed dot + hover a target** → the aim line renders the OUTLINE of
  the bracket the join would produce, and EVERY bracket the gesture
  would break — claimers, a crossed bracket, cascade deaths — is
  highlighted in an endangered style. Powered by the core's pure
  `previewConnect` (§7); the UI never re-derives the rules. A target
  that would refuse (non-adjacent) renders the aim line in the refusal
  style.
- **A side anchoring as a byproduct** (a room resolving to one unit) is
  animated — brief emphasis on the now-whole bracket. Completion is an
  event, not an absence.
- **A room's pickup dot, left-clicked** → hint, never silence: "finish
  assembling this group, or connect its pieces — right-click deletes the
  relationship it hangs from."

### 5.3 Delete(bracket id) — right-click a dot / Delete key

The named bracket B gives way. Its units — both sides', in order — spill
into the position where B stood: roots if B was a root; units of the
side S that held B otherwise (an anchored S thereby hangs). Then the I3
cascade: a bracket now hanging on both sides gives way the same way,
upward, until quiet. Dot targeting: a bracket dot names its bracket; a
room's pickup dot names the bracket it hangs from; a leaf dot names the
bracket owning the side that holds the leaf; a ROOT leaf's dot-delete is
a Refusal. Deletes never move anything else on the page (the layout
keeps the emptied column, as today).

### 5.4 Split(leaf w) — right-click a word (RULED, Q4)

The leaf divides at the chosen word into w1, w2. Structure is preserved
up to I3: no bracket gives way except one left hanging on both sides by
the split, which cascades per §5.3.

- w free → w1, w2 stand side by side in its place.
- w committed → its side now holds ⟨w1 w2⟩: it hangs, awaiting
  reassembly. If the bracket's other side already hung, it gives way
  (pinned: `R[⟨a b⟩, w]` split w → R dies; spill a, b, w1, w2).

### 5.5 Merge(w1, w2) — right-click the last word of a leaf

Two adjacent leaves fuse; a fused leaf cannot be half inside a claim.
Process the brackets around the pair INNERMOST-OUTWARD, re-classifying
after each step:

- A bracket whose own internal boundary separates w1 from w2 → gives way
  (spill as §5.3).
- A bracket in which the offending leaf is directly committed while its
  partner lies outside → gives way.
- A bracket holding the offending leaf as a fringe LODGER while its
  partner lies outside → releases it and survives, contracted.
- All others unaffected; I3 cascade closes out.

Because spills re-classify, an outer bracket usually sees the leaf as a
fresh fringe lodger and releases it — merge removes the MINIMAL set.
Pinned: `[R[y, S[x, w1]], w2]` merge w1·w2 → S gives way, R releases w1
and survives: `[R[y,x], w1w2]`. Note the silent promotions: a side
reduced to one unit by fusion or release is thereby anchored (pin both
two-lodger-room variants).

### 5.6 The rest

- **Relabel / star** — attribute edits by bracket id; I7 maintained;
  label ends and the derived `reversed` follow the star exactly as
  today.
- **Section breaks** — untouched (proposition attrs, not structure).
- **Clear tree** — brackets := none; every leaf a root.
- **Undo/redo** — every op is one atomic history step (§7).

## 6. Worked examples — the acceptance spine

Notation: `Alt[X, Y]` anchored sides; `⟨a b c⟩` a hanging side. Full
catalogue: `tree-engine-acceptance.md`. Saved analysis 46's region:

    Alt[ FtIn[ Ser[41b,41c], FtIn[ FtIn[41d, Ser[41e,42a]], 42b ] ],
         FtIn[ MEd[42c,42d], 42e ] ]

After the analyst's three deletes (outer FtIn; Ser[41b,41c]; MEd):

    Alt[ ⟨41b  41c  FtIn[FtIn[41d, Ser[41e,42a]], 42b]⟩,
         FtIn[ ⟨42c 42d⟩, 42e ] ]

**E1 — connect 42c · 42d** (two lodgers, one room): the join forms in
the room, which anchors: `Alt[⟨…⟩, FtIn[Ser[42c,42d], 42e]]` — the
right Ft/In whole again. Nothing breaks: bottom-up work inside a room
never costs anything.

**E2 — connect 42b · 42c** (the screenshot gesture): 42b is committed in
the packet `FtIn[inner, 42b]` → the packet breaks, spilling `inner` and
42b into the Alt's room. 42c releases (the right room anchors:
`FtIn[42d,42e]`). N = Ser[42b,42c] crosses the Alt's boundary; the left
side is the room → lands there:

    Alt[ ⟨41b  41c  FtIn[41d,Ser[41e,42a]]  Ser[42b,42c]⟩, FtIn[42d,42e] ]

One break (the packet — the bracket that claimed 42b), everything else
standing, the Alt binary with one room. This is the outcome the analyst
verified live and accepted; v3's rules produce it directly.

**E3 — the analyst's own plan, end to end, zero refusals.** "Connect 42c
to 42d, connect that to 42b, and connect that to Ft":

1. E1: `Alt[⟨41b 41c pkt⟩, FtIn[Ser[42c,42d], 42e]]`.
2. Connect 42b · the Ser (its dot): 42b committed in pkt → pkt breaks
   (spill `inner`, 42b into the left room); Ser committed in the right
   FtIn → that FtIn breaks (spill Ser, 42e into the Alt's right side,
   now a room). N = X[42b, Ser[42c,42d]] crosses the Alt's boundary;
   both sides are rooms; landing left leaves the right side with exactly
   42e — it anchors, the Alt SURVIVES:
   `Alt[⟨41b 41c inner X[42b, Ser[42c,42d]]⟩, 42e]`.
3. Connect X · inner (adjacent lodgers, same room):
   `Alt[⟨41b 41c Y[FtIn[41d,Ser[41e,42a]], X[42b,Ser[42c,42d]]]⟩, 42e]`.

Two breaks total — exactly the two brackets whose members the analyst
re-claimed — and the Alt stands throughout.

**E4 — connect 42d · 42e in the hanging-Ft document**
`Inf[FtIn[41d, ⟨42a 42b 42c 42d⟩], 42e]`: 42d releases (FtIn contracts,
survives); 42e is committed in Inf → **Inf breaks** (spill FtIn', 42e to
the floor); N lands at the floor:
`[…, FtIn[41d,⟨42a 42b 42c⟩], Ser[42d,42e]]`. The blunt rule applies
inward too: pairing 42e with a piece of the very group it was related to
still breaks its old relationship — the analyst rebuilds upward, which
is the ruled workflow.

**E5 — rebuilding a room from inside** (three joins, all in-room):
`Inf[FtIn[41d, Grnd[42a, CE[42b, Ser[42c,42d]]]], 42e]`, zero rooms,
zero breaks, star untouched.

**E6 — the cascade route**: delete outer FtIn; delete Ser[41b,41c];
delete the right `FtIn[MEd[42c,42d], 42e]`. The Alt's second side then
hangs too; I3 brings the Alt down; its units spill: roots in the flat
fixtures; lodgers of the enclosing Ser's side in the max fixture (which
embeds the region as a committed member). No both-ends-hanging shell
ever survives.

**E7 — the crossed-bracket cases** (from the adversarial review, now
under v3):
- *L1:* `R[S[x,⟨y z⟩], T[⟨u v⟩,t]]`, connect z·u → releases contract S
  and T; N crosses R's boundary; both sides anchored → **R gives way**:
  `[S[x,y], Ser[z,u], T[v,t]]`. (v2 refused here; v3's ruling is
  permissive: the join wins, one bracket pays, the preview showed it.)
- *L2:* `R[⟨a l⟩, S[⟨r s⟩,t]]`, connect l·r → N lands in R's left room
  replacing l; r releases: `R[⟨a Ser[l,r]⟩, S[s,t]]`. No mid-operation
  anchoring strands the join (final-state classification, §2).

**E8 — the sweep** (property): every delete sequence ≤3 deep on the
region, then every adjacent connect, plus RANDOM forests with ≥2 rooms
under a common ancestor: I1–I7 after every gesture; every successful
connect removes EXACTLY the §4-enumerated set (claimers + ≤1 crossed +
cascade) and `previewConnect` predicted it precisely; refusals leave the
state byte-identical; leaf order fixed.

## 7. Architecture — decided, not gestured at

**The tree leaves the text document.** The PM doc becomes flat;
structure lives in a pure core. Binding decisions (each traces to a
landmine found in review):

1. **Core module** `frontend/src/tree/core.ts`: plain TS, zero PM
   imports. `Bracket { id, rel, star, left: Unit[], right: Unit[] }`
   over stable ids; ops of §5 as pure functions returning
   `state | Refusal`; I1–I7 asserted after every op in dev/test; query
   surface includes `parentOf(unitId)`, `spanOf(unitId)`,
   `reversedOf(bracketId)` (derived), and `previewConnect(state, u, v)`
   → `{state, newBracketId, broken: BracketId[]} | Refusal` (powers
   §5.2; the broken list is exact).
2. **Persistence of core state**: the serialized core state is a
   DECLARED attribute on ONE hidden leaf node, `treeState`, that always
   stands first in the PM doc (`'treeState proposition+'`; the attribute
   has a default — PM silently drops writes to undeclared attrs, so
   declaring it is load-bearing). Every op is ONE transaction:
   proposition steps (for split/merge) plus the AttrStep on the
   treeState node. AttrSteps are real, invertible steps, so
   prosemirror-history gives atomic undo of text+tree together,
   `docChanged` fires onUpdate/docTick/onChange unchanged, and
   `closeHistory` per op keeps one-gesture-one-undo-step. No parallel
   plugin-owned state; the "plugin" is a memoized lens (`readTree`) over
   the treeState node. (A9 explains why it is not the doc's own attr.)
3. **Ids**: minted by the core, monotonic per document session, never
   reused; kept in the editor-internal serialization (undo restores the
   same ids) and STRIPPED from the wire. Dot grammar: `prop:<pid>`,
   `bracket:<id>`, `hang:<id>` (I3 makes the hanging side unambiguous).
   Stability: a re-connection (§5.1 step 1's same-bracket exception)
   keeps the bracket's id; breaks retire ids; N gets a fresh id. All
   commands address brackets by id; the relationship menu reads
   rel/star from core state, never `nodeAt`.
4. **Wire adapter** `frontend/src/tree/serialize.ts`:
   `toWire(flatDoc, coreState, priorDocument) → DocumentV2` —
   proposition rebuild with today's attr-fallback rules; forest from
   core with hanging sides written as `hole` nodes; ids stripped;
   `reversed` written as its derived value; flag normalization kept;
   sections off blockColor. ONE wire snapshot per docTick, shared by
   onChange, mainPids, and the overlay. `getDocument`/`setDocument`
   redefined over it; AnalysisPage's onDocumentChange and the text-flow
   reconciliation stay byte-for-byte untouched.
5. **Load pipeline & legacy data (RULED, Q2 — no legacy support)**:
   `normalizeDocument` → `normalizeHoles` (kept: rooms are CURRENT
   model, not legacy) → `fromWire`, which now REQUIRES strictly binary
   brackets → assert I1–I7 → on any failure, open via
   `withoutConnections` (propositions only) with a console warning.
   There is NO n-ary binarization machinery: old documents that violate
   the model are deletable per the ruling, and a one-time cleanup may
   simply strip their forests. The initial editor state embeds
   `attrs.tree` in the doc JSON (no post-mount install transaction —
   that window was guaranteed data loss). `setDocument` reinstalls flat
   content + tree attr in one `addToHistory:false` dispatch; the stale
   `sections` doc-attr write in editor.ts:86-91 is deleted.
6. **Server-side alignment (deliberate, second)**: tighten
   da/documents.py `_walk_tree` from "≥2 children" to "EXACTLY 2"; audit
   da/treebuild.py and da/firstpass.py so the first pass emits strictly
   binary forests (nest same-rel chains as it goes); one-time cleanup of
   stored analyses that fail the tightened validator (delete, per Q2).
   validate_document remains the fixed point otherwise.
7. **Flat schema, end state**: doc content `proposition+`. EditorBracket,
   EditorHole, the `unit` group, the registration-order dance,
   findBrackets/findHoles, and the editor-side hole round-trip are
   DELETED, not stubbed (normalizeHoles survives only inside the wire
   loader). setRelationship/flipStar re-implemented as core ops under
   decision 2. Two representations of structure must never both be live.
8. **Rendering**: layout.ts REWRITTEN to consume the core forest
   directly — bracket ids ride into BracketGeom/DotGeom; hanging sides
   produce the tick + pickup dot straight from the side (no hole
   emulation; holeNumbers deleted); Carry becomes `{bracketId, x, y}`;
   n-ary drawing paths deleted (nested same-rel chains draw as their
   real nesting). DotRef, parseDotId, popover state, and BracketLayer
   keys re-type to core ids.
9. **Refusals & previews in the UI**: connect returns
   `Result<{bracketId}, Refusal>`; the flash shows `refusal.message`.
   §5.2's endangered highlights consume `previewConnect().broken`; the
   UI never re-derives classification.
10. **Split/merge bookkeeping**: split keeps the old pid and blockColor
    on w1, mints w2's pid by today's convention, divides the corpus
    source at the chosen word, recomputes labels as today; merge keeps
    the upper leaf's pid and blockColor, concatenates spans. One
    transaction carries the proposition steps and the tree attr update —
    tree-view and flow-view edits are "identical states, one undo step"
    by construction.
11. **Derived readers**: mainPids, the overlay's leaf-completeness
    guard, and the change stream read the per-docTick wire snapshot;
    mainPointRefs' "no main point while any hole exists" becomes "while
    any side hangs" (server main_point stays its mirror).
12. **Kept plumbing**: keepPageScroll wraps every dispatch; selection
    policy stays "drop selection and popover on every update" — stable
    ids would allow survival, but that is out of scope.

## 8. Test plan

1. **Unit (core)**: every §5.1 path (in-room join; cross-room landing;
   claimer break, single and double; crossed-bracket give-way, all three
   sub-rules; same-bracket re-connection; the three refusals), delete
   cascade, split (incl. the `R[⟨a b⟩,w]` cascade), merge
   (innermost-outward, both promotion variants), attr edits — table-
   driven, asserting exact states AND I1–I7.
2. **Acceptance**: E1–E8 verbatim on the kept fixtures, plus every row
   of `tree-engine-acceptance.md`.
3. **Property**: random gesture sequences on random forests (including
   ≥2 rooms under a common ancestor) hold I1–I7; serialization
   round-trips (binary-only); leaf order fixed; every connect's removed
   set equals `previewConnect().broken` exactly; refusals leave state
   byte-identical; delete/merge remove exactly the enumerated sets.
4. **UI**: real dot-click runs for each path incl. the endangered
   highlight matching the actual break set, the unlabeled-until-chosen
   menu with Escape undoing the join, and the anchoring animation.
5. **Cross-view & server**: same split from tree and flow → identical
   states; every acceptance state round-trips through the TIGHTENED
   `validate_document`.

## 9. Rulings (2026-09-05) — all questions closed

- **Q1 — break, don't grow.** Connecting a unit that is already a
  bracket's member breaks that bracket ("if b is connected directly to
  a and I try to connect b to c, now the b–a connection breaks"). The
  engine never grows a bracket around a new join.
- **Q2 — no legacy handling.** Old 3+-member-bracket data is deletable;
  the loader requires binary and falls back to propositions-only;
  the server validator tightens to exactly-2; the first pass must emit
  binary. No code paths for situations impossible going forward.
- **Q3 — both break.** When the two clicked units belong to two
  different brackets, both brackets break. No refusal, no delete-first.
- **Q4 — split hangs the bracket** (awaiting reassembly) instead of
  ejecting the leaf. Confirmed.
- **Q5 — exact dots, no lifting.** Confirmed.
- **Q6 — no default relationship.** The menu opens with nothing
  preselected; a choice is required; Escape undoes the join.
- **(Follow-on, same day) `reversed` is not stored** — computed from
  rel + star at render/serialize time.

## 10. v4 — RULED 2026-09-05 (evening), from the analyst's hands-on test

The analyst drove the v3 build live and overruled it. These amendments WIN
over everything above. The unifying insight, in their own recurring
words: ROOMS ARE WHERE ASSEMBLY HAPPENS, THE ANALYST FINISHES BRACKETS,
AND NOTHING EVER COMPLETES OR DESTROYS ITSELF.

- **A1 — nothing auto-anchors, ever.** A hanging side stays hanging —
  through in-room joins, releases, spills, merges — until the analyst
  settles it explicitly (A2). A one-lodger room is a normal, drawable
  state (tick + pickup dot, the lone unit waiting). THE test case: with
  `FtIn[⟨42c 42d⟩, 42e]` hanging, connect 42c·42d →
  `FtIn[⟨Ser[42c,42d]⟩, 42e]` — the Ft/In stays hanging. It never
  "automatically connects."
- **A2 — explicit completion via the pickup dot.** The hanging tick's
  pickup dot is a connect TARGET: connecting it with the room's SOLE
  lodger settles that side and the bracket becomes whole ("connect that
  to Ft" — the analyst's own phrase, which always meant this gesture).
  With ≥2 lodgers it refuses (shake only, §A5). One undo step; no new
  bracket; no menu.
- **A3 — rooms never empty either.** A join that would consume a room's
  last lodger LANDS INSIDE that room instead (the room's extent grows
  over the adjacent material the join brought in — v1's elastic-room
  idea, now the rule). With two such rooms, the left. So a release
  never kills a bracket, and joins out of rooms GROW the hanging side
  rather than hollowing it. (Example: `FtIn[⟨Ser'⟩, 42e]` hanging,
  connect Ser'·42b-from-outside → `FtIn[⟨X[42b, Ser']⟩, 42e]`, still
  hanging, span grown. Then the A2 gesture finishes it.)
- **A4 — no cascade; both-ends-hanging is a legal WORKING state.** I3
  is demoted from an invariant to a SAVE-TIME rule, exactly per the
  analyst's original instruction: "relax validation to only validate
  the tree structure when there are no holes remaining." Deleting a
  bracket spills its sides' contents into a room where it stood and
  touches NOTHING else — no chains, no shells coming down. The server
  applies full structural validation only to documents with no rooms;
  a document with rooms is a work-in-progress and saves as it stands
  (wire holes may hold ≥1 child; a bracket may carry two holes while
  work is in progress).
- **Q1 stands, scoped as ruled:** a connect involving a COMMITTED unit
  still breaks that unit's immediate claiming bracket (the analyst's
  "b–a breaks" example) — one bracket, nothing above it, no cascade.
- **A5 — Q6 is REVERSED: Ser default returns.** connect mints
  `rel: 'Ser'`; the menu opens preloaded on Ser; clicking away keeps
  the Ser. No unlabeled state exists — delete the unstorable-snapshot
  machinery, the Escape-undo, the "no relationship yet" messaging, and
  the provisional translucency.
- **A6 — quiet the UI.** The hover span-wash is REMOVED. NO flash or
  toast messages for ordinary gestures — the pickup-dot hint, the
  assemble-first hint, all of it: gone; a refused gesture SHAKES and
  that is all. Any message that ever does render must be absolutely
  positioned: nothing may shift the page or the tree, ever. The
  endangered wash while aiming stays.
- **A7 — verification standard.** No behavior is "done" until it has
  been driven in the real browser with real clicks, on the analyst's
  own scenarios. Unit tests alone do not close a gesture.

- **A8 — boundaries are elastic wherever a room touches them (ruled
  2026-09-07, from the analyst's third screenshot).** When a join's span
  crosses a bracket's internal boundary, the join LANDS IN THE NEAREST
  ROOM on either fringe of the join — at ANY depth, not just a room that
  is directly a side of the crossed bracket. The chain of brackets
  enclosing the landing room GROWS to cover the join; the chain enclosing
  the released endpoint CONTRACTS; the one crossed boundary slides.
  Choose the landing room to avoid emptying any room; tiebreak: the LEFT
  endpoint's room. A crossed bracket gives way ONLY when no room exists
  on either fringe (and committed endpoints still break their immediate
  claimers first per Q1/Q3 — whose spills themselves create rooms the
  landing can then use, so in practice a crossing almost never destroys).
  THE test case: `Alt[FtIn[Ser[41b,41c], ⟨inner 42b⟩], FtIn[⟨42c 42d⟩,
  42e]]`, connect 42b·42c →
  `Alt[FtIn[Ser[41b,41c], ⟨inner Ser[42b,42c]⟩], FtIn[⟨42d⟩, 42e]]` —
  the Alt and both Ft/Ins all stand; the Alt's internal boundary slid
  past 42c; preview shows ZERO endangered brackets.
- **A9 — the tree rides a node of its own, not the doc's attrs (fixed
  2026-09-17, from the analyst's report that "everything on the page
  jumps" on every connect and delete).** prosemirror-view rebuilds a node
  view whose node fails `sameMarkup` — type OR attrs — and for the DOC
  node that meant destroying and re-creating EVERY row's node view on
  every gesture: the page collapsed by the tree's whole height for one
  task and grew back (measured 5551px → 3614px → 5551px over ~600ms),
  which the reader saw as a jump up and back. The core state now rides a
  hidden leaf node `treeState`, always the doc's first child; a gesture is
  an AttrStep on that node, the view rebuilds that one invisible leaf and
  touches no row, and `keepPageScroll` has nothing left to restore on a
  connect or delete (it still guards split/merge, which replace rows).
  Pinned by `rowStability.test.tsx`: the same row elements are in the
  DOM before and after a delete, a connect, and an undo.
