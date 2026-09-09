# Acceptance catalogue for the rebuilt tree engine

Every scenario the old test suite pinned (commands.test.ts and
john11.test.ts, deleted in the teardown — recoverable from git), at the
RULED semantics of `tree-engine-spec.md` **§10 (v4)**, which overrules
§2/§4/§5 wherever they disagree. Each row states the outcome the tests
must pin and cites the deciding spec section.

**What §10 changed, and why nearly every row below moved.** The analyst
drove the v3 build and overruled it: ROOMS ARE WHERE ASSEMBLY HAPPENS,
THE ANALYST FINISHES BRACKETS, AND NOTHING EVER COMPLETES OR DESTROYS
ITSELF.

- **A1 — nothing auto-anchors.** Hanging is an explicit per-side flag, not
  a count. A side with one lodger is a normal, drawable room — written
  `⟨x⟩` here — and every v3 "silent promotion" is gone.
- **A2 — the pickup dot finishes a bracket.** Connecting a room's tick
  with that room's SOLE lodger settles the side: one undo step, no new
  bracket, no menu. It is the only thing in the model that clears a flag.
- **A3 — rooms never empty.** A join that would take a room's last lodger
  lands INSIDE that room, whose extent grows over what the join brought
  in. So a lodger is never "committed", and reaching out of a room breaks
  nothing.
- **A4 — no cascade.** Both ends hanging is a legal working state. A
  delete takes exactly the relationship named, and the save-time rule is
  the analyst's own: "only validate the tree structure when there are no
  holes remaining".
- **A5 — Ser by default.** Q6 is reversed: connect mints `Ser`, the menu
  opens preloaded on it, clicking away keeps it. There is no unlabeled
  state and no Escape-undo.
- **A6 — quiet.** No flash or toast for any gesture; a refused gesture
  shakes its dot and that is all. The hover span-wash is gone.

Fixtures (all kept in frontend/src/editor/__tests__/):
- `john11-46.fixture.json` — the analyst's saved John 11:38–44 analysis.
- `john11-firstpass-min.fixture.json` — first pass, 15 flat roots, same
  9-leaf Alt region.
- `john11-firstpass-max.fixture.json` — embeds the same region mid-spine
  as a COMMITTED member of a Ser chain (no room in this fixture — why
  spills behave differently here, see row 11).
- `fixtures.ts` — synthetic docs incl. `hangingFtDoc`
  `[Ser[41a,41b], Inf[FtIn[41d, ⟨42a 42b 42c 42d⟩], 42e]]` and
  `packetDoc` `[Ser[p1, FtIn[p2, CndE[p3,p4]]], p5]`.
- `wellFormed.ts` — the legality checker; adapt to I1–I7 and run after
  every gesture.

## A. hangingFtDoc scenarios

1. **Rebuild the room from inside (3 joins, then the settle)** — connect
   42c·42d, then 42b·Ser, then 42a·CE: all in-room joins, zero breaks.
   The room shrinks join by join and does NOT anchor (§10 A1):
   `[Ser[41a,41b], Inf[FtIn[41d, ⟨Grnd[42a, CE[42b, Ser[42c,42d]]]⟩], 42e]]`.
   The pickup dot then settles it (§10 A2) and E5's final state stands:
   `[Ser[41a,41b], Inf[FtIn[41d, Grnd[42a, CE[42b, Ser[42c,42d]]]], 42e]]`,
   zero rooms, Inf's star kept. In-room work never costs anything.

2. **Reach out of the room** — connect 42d·42e: 42d releases (FtIn
   contracts and survives: `FtIn[41d, ⟨42a 42b 42c⟩]`); 42e is COMMITTED
   in Inf → **Inf breaks** (§4 Break; E4): spill FtIn' and 42e to the
   floor; the join lands there:
   `[Ser[41a,41b], FtIn[41d,⟨42a 42b 42c⟩], Ser[42d,42e]]`. The
   untouched root Ser[41a,41b] survives BY IDENTITY, as does the
   contracted FtIn. The preview must have highlighted Inf as breaking.

3. **Only the leaver is touched** — connect 42a·42b (Adv) in the room,
   then 42d·42e: the Adv survives BY NODE IDENTITY as a lodger; Inf
   breaks as in row 2:
   `[Ser[41a,41b], FtIn[41d, ⟨Adv[42a,42b] 42c⟩], Grnd[42d,42e]]`.

4. **Ft as a forest root** — obtain by deleting the Inf from
   hangingFtDoc: `[Ser[41a,41b], FtIn[41d,⟨42a..42d⟩], 42e]`. Connect
   42d·42e: 42d releases, 42e is a free root, nothing is committed →
   ZERO breaks; N lands at the floor:
   `[Ser[41a,41b], FtIn[41d,⟨42a 42b 42c⟩], Ser[42d,42e]]` (§4 landing
   rule 1).

5. **Preview contract** — `previewConnect` returns exactly the state and
   the exact `broken` list the gesture then produces, mutating nothing;
   the UI's endangered highlight = that list, never a re-derivation
   (§5.2, §7.1).

6. **Refusals are geometric only** — connect 42b·42e → refuse (42c, 42d
   between); 41a·42a → refuse; FtIn·42d → refuse (containment); state
   byte-identical after each. A refused gesture SHAKES its dot and says
   nothing (§10 A6). The room's pickup dot IS a connect target now
   (§10 A2), but only for that room's sole lodger; any other pairing
   with it shakes.

## B. packetDoc / firstJohn16 scenarios

7. **packetDoc: connect p4 · p5** (p4 committed in CndE; p5 a root).
   CndE breaks (spill p3, p4 into the FtIn's side → room; p4 then
   releases to join, and what it leaves behind is STILL a room):
   `[Ser[p1, FtIn[p2, ⟨p3⟩]], Grnd[p4,p5]]` — one break, Ser and FtIn
   alive, and the FtIn waiting for the analyst (§10 A1). To join the
   whole packet instead, click the Ser packet's dot · p5 (two adjacent
   roots, zero breaks).

8. **firstJohn16, no cascade** — delete FtIn then delete Ser: the CndE
   hangs at BOTH ends and STANDS (§10 A4). Forest
   `[CndE[⟨p1 Adv[p2,p3]⟩, ⟨p4 p5⟩]]` — two deletes, two relationships
   gone, and not one more. It saves as it stands: two holes on the wire.

9. **firstJohn16 hanging-end connect** — after delete FtIn:
   `CndE[⟨p1, Adv[p2,p3]⟩, Ser[p4,p5]]`; connect Adv·Ser: Adv is a
   lodger; Ser is COMMITTED in CndE → CndE breaks (root: spill p1, Adv,
   Ser as roots), then the join:
   `[p1, Inf[Adv[p2,p3], Ser[p4,p5]]]` (§4).

## C. John 11 region scenarios (all three fixtures)

Region after the standard three deletes (outer FtIn; Ser[41b,41c]; MEd):
`Alt[⟨41b 41c FtIn[FtIn[41d,Ser[41e,42a]],42b]⟩, FtIn[⟨42c 42d⟩,42e]]`.

10. **The ex-cascade route** — delete outer FtIn; delete Ser[41b,41c];
    delete the right `FtIn[MEd[42c,42d],42e]`: the Alt's second side
    hangs too, and the Alt STANDS (§10 A4):
    `Alt[⟨41b 41c FtIn[FtIn[41d,Ser[41e,42a]],42b]⟩, ⟨MEd[42c,42d] 42e⟩]`
    — the same in all three fixtures, every unit still inside the Alt.

11. **The screenshot gesture: connect 42b · 42c** — 42b committed in the
    packet → the packet breaks (spill `inner`, 42b into the Alt's room);
    42c releases and the right room keeps its remaining lodger; N lands
    in the Alt's room:
    `Alt[⟨41b 41c FtIn[41d,Ser[41e,42a]] Ser[42b,42c]⟩, FtIn[⟨42d⟩,42e]]`
    (E2, at §10 A1). One break, and the right Ft/In is left waiting
    rather than finished behind the analyst's back.

12. **Chain of shells** — delete Ser[41b,41c], then the FtIn above it:
    the emptied FtIn gives way upward; its UNITS — 41b, 41c, and the
    intact packet — spill into the Alt's single room (§5.3 never opens
    a spilled unit):
    `Alt[⟨41b 41c FtIn[FtIn[41d,Ser[41e,42a]],42b]⟩, FtIn[MEd[42c,42d],42e]]`
    — one room, the Alt stands, the packet whole inside it.

13. **Pristine tree: connect 42b · 42c** — 42b committed in the packet,
    42c committed in MEd → BOTH break (Q3). The join then lands in 42b's
    own room — the one the packet's spill just made — and **the Alt
    STANDS**, its internal boundary slid past 42c (§10 A8):
    `Alt[FtIn[Ser[41b,41c], ⟨FtIn[41d,Ser[41e,42a]] Ser[42b,42c]⟩],
    FtIn[⟨42d⟩, 42e]]` — two breaks, both directly-claimed, nothing else,
    in all three fixtures.

14. **Pristine tree: connect 42c · 42d** (the two members of MEd) — the
    same-bracket re-connection: the menu opens ON MEd preloaded; no
    structural change; MEd keeps its identity and id (§5.1 step 1).

15. **After a rebuild: connect 42c · 42d** — sequence: delete Alt, outer
    FtIn, MEd; connect 42b·42c (42b committed in the root packet →
    packet breaks, spill inner + 42b as roots; 42c releases; N a root):
    `[Ser[41b,41c], FtIn[41d,Ser[41e,42a]], Ser[42b,42c], FtIn[⟨42d⟩,42e]]`.
    Then connect 42c·42d: 42c is committed in the new Ser (which breaks),
    but 42d is the SOLE LODGER of the right FtIn's room — a lodger, not a
    member — so that bracket does not break, and §10 A3 lands the join
    inside the room it would have emptied:
    `[Ser[41b,41c], FtIn[41d,Ser[41e,42a]], 42b, FtIn[⟨CE[42c,42d]⟩, 42e]]`
    — ONE break, not two. (States as listed hold in 46/min; in max the
    same units are lodgers of the enclosing Ser's side throughout.)

16. **THE SWEEP** — every delete sequence ≤3 deep over the region's 8
    brackets, then the joins (42b,42c) and (42c,42d) singly and in both
    orders, PLUS random forests with ≥2 rooms under a common ancestor
    and random SETTLE gestures. After EVERY gesture: I1–I7 (I3 now reads
    "a side of ≥2 units is marked hanging"); leaf order fixed; every
    connect's removed set equals `previewConnect().broken` exactly;
    refusals leave state byte-identical; and ROOMS PERSIST — no gesture
    but `settleSide` ever clears a hanging flag (§8.3, §10 A1).

## D. Rows from the adversarial review, under v4

17. **L1 at A8 — the crossed bracket stands, its boundary slides**:
    `R[S[x,⟨y z⟩], T[⟨u v⟩,t]]`, connect z·u → the join lands in z's own
    room inside S; u releases from T's room; R's boundary slides:
    `[R[S[x, ⟨y Ser[z,u]⟩], T[⟨v⟩, t]]]`, broken = [] (§10 A8; E7
    re-ruled — this was the analyst's third screenshot, in miniature).

18. **L2 — the join lands in the room, and both rooms stay rooms**:
    `R[⟨a l⟩, S[⟨r s⟩,t]]`, connect l·r → N takes l's slot in R's room;
    r releases and S's room keeps ⟨s⟩:
    `R[⟨a Ser[l,r]⟩, S[⟨s⟩,t]]` (§10 A1).

19. **A3 — the join GROWS the room it came out of**: the E3 step-2
    state. After `42c·42d`, the right Ft/In holds `⟨Ser[42c,42d]⟩` — a
    room with ONE lodger. Connecting 42b to that Ser breaks the packet
    that claimed 42b and NOTHING ELSE: the Ser is a lodger, not a
    member, so the right Ft/In is untouched, and the join lands in its
    room, whose extent grows leftwards over 42b:
    `Alt[⟨41b 41c FtIn[41d,Ser[41e,42a]]⟩, FtIn[⟨CE[42b,Ser[42c,42d]]⟩, 42e]]`.
    One break, where v3 took two.

20. **The analyst's verbatim plan, end to end** (E3, §10): "connect 42c
    to 42d" ✓ (in-room, zero breaks, the Ft/In STAYS HANGING — A1's own
    test case); "connect that to 42b" ✓ (row 19: one break, the room
    grows); "and connect that to Ft" ✓ — which is the PICKUP DOT (A2),
    the gesture that phrase always meant. Final:
    `Alt[⟨41b 41c FtIn[41d,Ser[41e,42a]]⟩, FtIn[CE[42b,Ser[42c,42d]], 42e]]`.
    Zero refusals, one break in the whole plan.

21. **Split hangs both ends**: `R[⟨a b⟩, w]`, split w → R's right side
    holds ⟨w1 w2⟩ and hangs; R now hangs at both ends and STANDS
    (§5.4 at §10 A4).

22. **Merge, innermost-outward, and NO silent promotion**:
    `[R[y, S[x, w1]], w2]`, merge w1·w2 → S gives way, R then releases
    w1 as a fringe lodger and survives with a room: `[R[y,⟨x⟩], w1w2]`
    (§5.5, §10 A1). Both former promotion variants likewise keep their
    rooms: `R[⟨w1 w2⟩, c]` merge → `R[⟨w1⟩, c]`;
    `R[a, ⟨b w1⟩]` merge w1·w2 → `R[a, ⟨b⟩]`, w1w2 outside.
    A ONE-LODGER room is not annihilated either — §10 A1 names merges
    outright: `[R[a, ⟨w1⟩], w2]` merge w1·w2 → `[R[a, ⟨w1⟩]]`, the room
    absorbing the fusion and its extent growing over w2's words; the
    mirror `[w1, R[⟨w2⟩, a]]` merge w1·w2 → `[R[⟨w1⟩, a]]`, the room
    growing OUTWARD over w1 exactly as row 19's room grows over 42b.
    Neither direction touches R, and neither settles anything.

23. **Committed-inside-own-bracket**: `FtIn[a, ⟨b c⟩]`, connect a·b —
    a is committed in FtIn itself → FtIn breaks (spill a, b, c in
    place); the join forms among them: `[Ser[a,b], c]` in FtIn's old
    position (§4 Break; the blunt rule has no inward exception).

## E. Serialization / load (convert.test.ts — kept; update per Q2)

24. Round-trip identity on binary forests, rooms-as-holes, and
    disconnected forests; `reversed` written as its derived value. §10's
    two new wire shapes round-trip as they stand: a HANGING side is a
    hole at ANY count (a one-lodger room is a ONE-CHILD hole), and a
    bracket may carry TWO holes. `normalizeHoles` no longer collapses
    either — it only opens a hole at the floor and flattens a nested
    one — and the server validates the same way (§10 A1, A4).
    NO legacy paths: an n-ary bracket on load → propositions-only
    fallback with a warning (delete such documents; the server validator
    tightens to exactly-2 and the first pass must emit binary — spec
    §7.5–7.6). Drop the binarization round-trip rows. The v1→v2
    single-root conversion is a distinct, still-supported load path
    (normalizeDocument) — keep firstJohn16V1 for it. Housekeeping for
    the implementers: fixtures.ts's header and flatDoc comment still
    describe pre-v3 legacy-display behavior — reword to "exercises the
    propositions-only fallback + warning (Q2)".

## F. Attribute edits

25. setRelationship keeps star coherent (I7) with `reversed` derived at
    the edges; flipStar on any bracket; section breaks unchanged.
    Re-homed as core ops (§7.7) with identical observable behavior.

## G. §10's own rows

26. **A5 — Ser by default.** `connect` mints `rel: 'Ser'`, `star: null`
    (Ser is coordinate, so I7 holds from the mint). The menu opens
    PRELOADED on Series; clicking away or pressing Escape closes it and
    the Ser stands. No unlabeled bracket exists, so the per-docTick
    snapshot never fails on `rel` and `onChange` fires unconditionally;
    the fresh-join Escape-undo and the provisional translucency are
    deleted.

27. **A2 — the settle gesture.** `settleSide(f, id, side)` is legal iff
    that side hangs and holds exactly one unit: it clears the flag and
    nothing else moves (same ids, same leaves, one undo step, no menu).
    With ≥2 lodgers, with a settled side, or with an unknown bracket it
    refuses `not-settleable` / `not-found`. In the UI the pickup dot
    `hang:<id>:<side>` is a connect endpoint: paired with its room's
    sole lodger it settles; ANY other pairing shakes and does nothing.

28. **A6 — quiet.** No flash, toast or hint element renders anywhere for
    any gesture, and nothing a gesture does may shift the page. The
    hover span-wash is removed entirely (state, memo, rect and CSS); the
    endangered wash while aiming stays.

29. **A3's DOUBLY-DEGENERATE landing — pinned, and ONE QUESTION OPEN.**
    A3 says the landing takes "the left" of two rooms the join would
    empty, which is only reachable when each endpoint is its room's sole
    lodger. The right-hand side is then left with nothing, and I2 — not
    a cascade — makes that bracket give way. Two shapes, both pinned:
    ACROSS two brackets, `[R1[x, ⟨u⟩], R2[⟨v⟩, y]]` connect u·v →
    `[R1[x, ⟨Ser[u,v]⟩], y]`, broken `[R2]`; WITHIN one bracket,
    `FtIn[⟨a⟩, ⟨b⟩]` connect a·b → `[Ser[a, b]]`, broken `[FtIn]` —
    the new Ser stands where FtIn stood, over the same two units, and
    the menu opens preloaded on it (A5). Merge lands the same way:
    `[R1[x, ⟨w1⟩], R2[⟨w2⟩, y]]` merge w1·w2 → `[R1[x, ⟨w1⟩], y]`.
    OPEN FOR THE ANALYST: the WITHIN-one-bracket join is the only place
    in v4 where a bracket the analyst did not click disappears (its rel
    and flag go with it). It is reachable in four ordinary gestures —
    `Ser[Alt[a,b], Alt[c,d]]`, delete both Alts, reassemble each room,
    join the two groups. If "nothing destroys itself" outranks A3's
    tiebreak here, the join should instead REFUSE (shake) when both
    endpoints are the sole lodgers of the SAME bracket, and the analyst
    finishes that bracket with its two pickup dots (A2) instead. Nothing
    else in the model changes either way.
