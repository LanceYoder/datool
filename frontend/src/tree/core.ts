/**
 * The tree engine's pure core — the data model of §1, the invariants of §2 and
 * every operation of §5 of `docs/tree-engine-spec.md` (v3 — RULED).
 *
 * Zero dependencies beyond the TS standard library: no ProseMirror, no React,
 * no wire types. Structure lives OUTSIDE the text document (spec §0, §7.1), so
 * this module never learns what a proposition's words are — only its pid.
 *
 * Every op is a pure function `(state, args) → new state | Refusal` (§5), spelled
 * `Result<{ state: Forest, … }>` uniformly — connect included, whose success
 * shape is §7.1's `{state, newBracketId, broken}` verbatim — so a phase-2
 * command dispatcher can map over the ops without special cases. Inputs are
 * never mutated; untouched units are reused BY REFERENCE, so a caller can tell
 * what actually moved with `===`. A refusal returns the input forest itself.
 *
 * Because untouched units are SHARED between the input and the output forest,
 * the model's structure is declared `readonly` at the boundary (`Forest.roots`,
 * `Bracket.left`, `Bracket.right`). A caller that pushed into one of those
 * arrays would corrupt every snapshot sharing it — including the pre-op state
 * §7.2's atomic undo restores — so the type system, not discipline, forbids it.
 *
 * The core knows no taxonomy. Coordinate-ness and the taxonomy's default
 * starred end are facts the edge supplies (`TaxonomyFacts`) for the two
 * attribute ops and for the derived `reversed` (§1's follow-on ruling).
 */

// ---------------------------------------------------------------------------
// §1 The objects

export type Leaf = { kind: 'leaf'; pid: string };

export type Star = 'left' | 'right';
export type Side = 'left' | 'right';

/**
 * One relationship over EXACTLY TWO sides — the three-way bracket of the old
 * schema cannot be written down (§0.2, §1). `rel` is minted 'Ser' by every
 * connect (§10 A5) and is never null in practice; `star` is null iff the
 * relationship is coordinate (I7).
 *
 * HANGING IS EXPLICIT, per side (§10 A1). v3 derived it — "a side with >1 unit
 * is a room" — which made a room ANCHOR ITSELF the moment a join inside it
 * left one unit standing. The analyst overruled that: rooms are where assembly
 * happens, and only the analyst finishes a bracket (`settleSide`, §10 A2). So
 * each side carries its own flag:
 *
 *   - a side with ≥2 units is ALWAYS hanging (the invariant below);
 *   - a side with ONE unit may be hanging (a one-lodger room, drawn ⟨x⟩ —
 *     tick + pickup dot, the lone unit waiting) or settled (its unit is
 *     COMMITTED to this bracket);
 *   - no side is ever empty (I2).
 *
 * Both sides hanging is a legal WORKING state (§10 A4): nothing cascades.
 *
 * `flag` is the analyst's amber "come back to this" mark (`types.ts`'s
 * `BracketNode.flag`, validated by `da/documents.py`). It is presentation, not
 * structure — no invariant mentions it and no op of §5 reads it — but §7.4
 * item 4 rules that the wire adapter KEEPS flag normalization, so it rides
 * along on the bracket, beside `rel` and `star`, rather than in a side table
 * the ops would have to be trusted to maintain. It dies with the bracket that
 * carries it, exactly as `rel` and `star` do.
 */
export type Bracket = {
  kind: 'bracket';
  id: number;
  rel: string | null;
  star: Star | null;
  flag?: 'review';
  /** §10 A1: this side is a waiting room, whatever it holds. */
  leftHanging: boolean;
  rightHanging: boolean;
  left: readonly Unit[];
  right: readonly Unit[];
};

export type Unit = Leaf | Bracket;

/** The top level: an ordered list of root units, plus the id mint (§7.3). */
export type Forest = { roots: readonly Unit[]; nextId: number };

export type UnitAddr = { kind: 'leaf'; pid: string } | { kind: 'bracket'; id: number };

export type RefusalCode =
  | 'not-adjacent'
  | 'containment'
  | 'self'
  | 'not-found'
  | 'root-delete'
  /** §10 A2: this side is not one the analyst can settle right now. */
  | 'not-settleable';
export type Refusal = { code: RefusalCode; message: string };
export type Result<T> = ({ ok: true } & T) | { ok: false; refusal: Refusal };

/** Leaf ordinals, half-open: `end` is one past the span's last leaf, so two
 *  spans MEET (§1) exactly when `a.end === b.start`. */
export type Span = { start: number; end: number };

/** What the core needs to know about one relationship (§5.6, §7.1). */
export type TaxonomyFacts = { coordinate: boolean; starredLabel?: number };

/**
 * The break bookkeeping behind `connect`'s `broken` list, kept separable so the
 * property suite can assert §4's lemmas (the crossed bracket's boundary sits at
 * the endpoints' meet point; breakage is bounded by claimers + ≤1 crossed +
 * cascade). Phase 2's UI needs only `broken` (§5.2).
 */
export type ConnectDetail = {
  /** §5.1 step 1 — the bracket claiming each committed endpoint. */
  claimers: number[];
  /** §4 landing rule 3 — the ≤1 crossed bracket that gave way. */
  crossed: number | null;
  /**
   * NOT a cascade (§10 A4 abolished it): I2 alone, and at most one bracket.
   *
   * Only ever A3's DOUBLY-DEGENERATE landing — both endpoints the sole lodgers
   * of a room, so whichever room takes the join (A3: the left one), the other
   * is left holding nothing. Two shapes reach it, and both are pinned by
   * acceptance row 29:
   *
   *   - two BRACKETS, `[R1[x, ⟨u⟩], R2[⟨v⟩, y]]` — R1 grows, R2 gives way;
   *   - ONE bracket, `FtIn[⟨a⟩, ⟨b⟩]` — the join consumed both of its sides,
   *     so the new bracket takes its place: `[Ser[a, b]]`.
   *
   * The second is the only place in v4 where a bracket the analyst did not
   * click disappears, and it is flagged for their ruling in the catalogue: if
   * "nothing destroys itself" outranks A3's tiebreak, `connectDetail` refuses
   * (shake, §10 A6) when both endpoints are sole lodgers of the SAME bracket,
   * and the pickup dot (A2) is how that bracket gets finished instead.
   * Either way the bracket is REPORTED — `emptied` rides in `broken`, so the
   * endangered wash showed it while the analyst was still aiming (§5.2).
   */
  emptied: number[];
  /** The leaf ordinal where the two endpoint spans meet. */
  meet: number;
  /** Set on the §5.1 step-1 same-bracket re-connection: nothing structural. */
  editedInPlace?: number;
};

/**
 * §7.1's shape verbatim: `{state, newBracketId, broken}`. The field names are
 * the spec's, not the implementation's convenience, because §7.8's layout and
 * §7.9's endangered highlight are written against them.
 */
export type ConnectOutcome = {
  state: Forest;
  newBracketId: number;
  broken: number[];
  editedInPlace?: number;
};

/** Every op of §5 answers in this shape: a new state, or a Refusal. */
export type OpResult = Result<{ state: Forest }>;

// ---------------------------------------------------------------------------
// Construction helpers

export function leaf(pid: string): Leaf {
  return { kind: 'leaf', pid };
}

/**
 * Wrap roots as a forest with an EXPLICIT mint. `nextId` is the document
 * session's id counter (§7.3: monotonic, never reused), so it must be carried
 * from wherever the ids came from — a wire load, a prior forest, an undo
 * snapshot. Deriving it from the roots would resurrect ids that earlier breaks
 * retired, which is why there is no defaulting overload here; a genuinely fresh
 * load calls `loadForest` instead.
 */
export function buildForest(roots: readonly Unit[], nextId: number): Forest {
  return { roots: [...roots], nextId };
}

/**
 * Wrap roots that have NEVER been through an op — a fresh load, where no id has
 * been retired yet — minting `nextId` one above the largest id present.
 *
 * Only valid for that case. On a forest that has already lived (`loadForest(
 * afterDelete.roots)`), max+1 hands back an id a break retired, and §7.3's
 * "never reused" is broken; carry the prior forest's `nextId` into
 * `buildForest` instead.
 */
export function loadForest(roots: readonly Unit[]): Forest {
  let max = 0;
  const walk = (u: Unit): void => {
    if (u.kind === 'leaf') return;
    if (u.id >= max) max = u.id + 1;
    u.left.forEach(walk);
    u.right.forEach(walk);
  };
  roots.forEach(walk);
  return { roots: [...roots], nextId: max };
}

/** Every leaf of a unit, in reading order. */
export function leavesOf(u: Unit): string[] {
  const out: string[] = [];
  collectLeaves(u, out);
  return out;
}

/** The forest's leaves in reading order — the order no gesture may disturb (I6). */
export function leafOrder(f: Forest): string[] {
  const out: string[] = [];
  for (const root of f.roots) collectLeaves(root, out);
  return out;
}

function collectLeaves(u: Unit, out: string[]): void {
  if (u.kind === 'leaf') {
    out.push(u.pid);
    return;
  }
  for (const child of u.left) collectLeaves(child, out);
  for (const child of u.right) collectLeaves(child, out);
}

// ---------------------------------------------------------------------------
// Queries

export function bracketById(f: Forest, id: number): Bracket | null {
  let found: Bracket | null = null;
  const walk = (u: Unit): void => {
    if (found !== null || u.kind === 'leaf') return;
    if (u.id === id) {
      found = u;
      return;
    }
    u.left.forEach(walk);
    u.right.forEach(walk);
  };
  f.roots.forEach(walk);
  return found;
}

export function findUnit(f: Forest, addr: UnitAddr): Unit | null {
  if (addr.kind === 'bracket') return bracketById(f, addr.id);
  let found: Unit | null = null;
  const walk = (u: Unit): void => {
    if (found !== null) return;
    if (u.kind === 'leaf') {
      if (u.pid === addr.pid) found = u;
      return;
    }
    u.left.forEach(walk);
    u.right.forEach(walk);
  };
  f.roots.forEach(walk);
  return found;
}

/** Leaf ordinals for the whole forest; the basis of every span (§1). */
function ordinalsOf(f: Forest): Map<string, number> {
  const map = new Map<string, number>();
  leafOrder(f).forEach((pid, i) => map.set(pid, i));
  return map;
}

function spanOfUnit(u: Unit, ord: Map<string, number>): Span {
  const pids = leavesOf(u);
  const start = ord.get(pids[0]);
  const end = ord.get(pids[pids.length - 1]);
  if (start === undefined || end === undefined) {
    throw new Error(`tree/core: leaf outside the forest while spanning ${describeUnit(u)}`);
  }
  return { start, end: end + 1 };
}

/** The unit's leaf run, half-open. Throws when the address names nothing. */
export function spanOf(f: Forest, addr: UnitAddr): Span {
  const u = findUnit(f, addr);
  if (u === null) throw new Error(`tree/core: spanOf on a missing unit — ${describeAddr(addr)}`);
  return spanOfUnit(u, ordinalsOf(f));
}

/** The bracket and side holding this unit, or null when it is a root. */
export function parentOf(f: Forest, addr: UnitAddr): { bracketId: number; side: Side } | null {
  const target = findUnit(f, addr);
  if (target === null) {
    throw new Error(`tree/core: parentOf on a missing unit — ${describeAddr(addr)}`);
  }
  let out: { bracketId: number; side: Side } | null = null;
  let seen = false;
  const walk = (u: Unit): void => {
    if (u === target) seen = true;
    if (u.kind === 'leaf') return;
    for (const side of ['left', 'right'] as const) {
      for (const child of u[side]) {
        if (child === target) {
          out = { bracketId: u.id, side };
          seen = true;
        }
        walk(child);
      }
    }
  };
  f.roots.forEach(walk);
  if (!seen) throw new Error(`tree/core: parentOf on a missing unit — ${describeAddr(addr)}`);
  return out;
}

/**
 * `reversed` is DERIVED, never stored (§1's follow-on ruling): true only when a
 * subordinate bracket stars the end that is not the taxonomy's default.
 *
 * Addressed by id, like every other query and command (§7.1, §7.3). The extra
 * `entry` is not a divergence from §7.1's `reversedOf(bracketId)` but its
 * precondition: `reversed` is a function of rel + star AND the taxonomy's
 * default starred end, and the core knows no taxonomy, so the edge supplies
 * the one fact about `rel` that the derivation needs.
 */
export function reversedOf(f: Forest, id: number, entry: TaxonomyFacts): boolean {
  const bracket = bracketById(f, id);
  if (bracket === null) throw new Error(`tree/core: reversedOf on a missing bracket ${id}`);
  return reversedFrom(bracket, entry);
}

/**
 * The same derivation, on a bracket the caller is ALREADY holding — no forest
 * walk. `reversedOf` is the addressed-by-id form of §7.1's query surface and
 * delegates here; a loop that has the bracket in hand (layout.ts's per-bracket
 * pass) calls this instead, so drawing a forest of B brackets stays O(B)
 * rather than paying a full `bracketById` walk per bracket.
 *
 * Same function, one definition: the two can never drift.
 */
export function reversedFrom(bracket: Bracket, entry: TaxonomyFacts): boolean {
  if (entry.coordinate || bracket.star === null) return false;
  return bracket.star !== defaultStar(entry);
}

function defaultStar(entry: TaxonomyFacts): Star {
  return (entry.starredLabel ?? 0) === 0 ? 'left' : 'right';
}

/**
 * Whether this side is a waiting room (§10 A1) — read off the bracket's own
 * flag, never off the unit count. A one-lodger room says yes; the settled side
 * beside it says no, and holds a COMMITTED unit.
 */
export function hangsAt(bracket: Bracket, side: Side): boolean {
  return side === 'left' ? bracket.leftHanging : bracket.rightHanging;
}

/** The sides of this bracket that hang — none, one, or (legally) both. */
export function hangingSides(bracket: Bracket): Side[] {
  const out: Side[] = [];
  if (bracket.leftHanging) out.push('left');
  if (bracket.rightHanging) out.push('right');
  return out;
}

// ---------------------------------------------------------------------------
// §2 The invariants

/**
 * I1–I7, asserted after every op. Throws with the exact violation.
 *
 * I7 is checked as far as the core can see it: `star` is null whenever `rel`
 * is, and is otherwise 'left'/'right'. Whether the relationship is coordinate
 * is taxonomy knowledge that only the edge holds, so the ops that receive a
 * `TaxonomyFacts` are the ones that keep the coordinate half of I7.
 */
export function assertInvariants(f: Forest, leafOrder: string[]): void {
  const seenUnits = new Set<Unit>();
  const seenIds = new Set<number>();
  const seenPids = new Set<string>();
  const order: string[] = [];

  const walk = (u: Unit, where: string): void => {
    if (seenUnits.has(u)) {
      throw new Error(`I5 violated: ${describeUnit(u)} appears more than once (at ${where})`);
    }
    seenUnits.add(u);
    if (u.kind === 'leaf') {
      if (seenPids.has(u.pid)) throw new Error(`I5 violated: leaf ${u.pid} appears twice`);
      seenPids.add(u.pid);
      order.push(u.pid);
      return;
    }
    if (seenIds.has(u.id)) throw new Error(`I5 violated: bracket id ${u.id} appears twice`);
    seenIds.add(u.id);
    if (!Array.isArray(u.left) || !Array.isArray(u.right)) {
      throw new Error(`I1 violated: bracket ${u.id} does not have two sides`);
    }
    if (u.left.length === 0 || u.right.length === 0) {
      throw new Error(
        `I2 violated: bracket ${u.id} has an empty side (left ${u.left.length}, right ${u.right.length})`,
      );
    }
    // I3 (v4 — §10 A4): NOT "at most one side hangs" (a bracket hanging at
    // both ends is a legal working state now), but HANGING COHERENCE — a side
    // holding more than one unit is a room whatever its flag was set to.
    for (const side of ['left', 'right'] as const) {
      if (u[side].length >= 2 && !hangsAt(u, side)) {
        throw new Error(
          `I3 violated: bracket ${u.id}'s ${side} side holds ${u[side].length} units `
            + 'but is not marked hanging',
        );
      }
    }
    if (u.rel === null && u.star !== null) {
      throw new Error(`I7 violated: bracket ${u.id} has a star but no relationship`);
    }
    if (u.star !== null && u.star !== 'left' && u.star !== 'right') {
      throw new Error(`I7 violated: bracket ${u.id} has a bad star ${String(u.star)}`);
    }
    if (u.id >= f.nextId) {
      throw new Error(`id mint violated: bracket ${u.id} is at or above nextId ${f.nextId}`);
    }
    for (const child of u.left) walk(child, `bracket ${u.id} left`);
    for (const child of u.right) walk(child, `bracket ${u.id} right`);
  };

  for (const root of f.roots) walk(root, 'the floor');

  // I4/I6: the roots partition the leaves in the document's order. Contiguity
  // and "left run immediately precedes right run" are structural here — a
  // side's run IS its units' traversal — so leaf order is the whole content.
  if (order.length !== leafOrder.length) {
    throw new Error(
      `I4/I6 violated: the forest holds ${order.length} leaves, the document ${leafOrder.length}`,
    );
  }
  for (let i = 0; i < order.length; i += 1) {
    if (order[i] !== leafOrder[i]) {
      throw new Error(
        `I6 violated: leaf ${i} is ${order[i]}, the document says ${leafOrder[i]}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// The working model
//
// Ops run on a mutable mirror of the forest (WBracket) and rebuild an immutable
// one at the end, reusing every original object whose attributes and children
// all survived. That is what makes "untouched units survive BY IDENTITY"
// (acceptance rows 2, 3) true by construction rather than by care.

interface WBracket {
  kind: 'wbracket';
  id: number;
  rel: string | null;
  star: Star | null;
  flag?: 'review';
  leftHanging: boolean;
  rightHanging: boolean;
  left: WUnit[];
  right: WUnit[];
  orig: Bracket | null;
}

type WUnit = Leaf | WBracket;

interface Work {
  roots: WUnit[];
  nextId: number;
  /** Leaf ordinals of the ORIGINAL forest; connect/delete never change them. */
  ord: Map<string, number>;
}

function isW(u: WUnit): u is WBracket {
  return u.kind === 'wbracket';
}

function toWork(f: Forest, ord: Map<string, number>): { work: Work; map: Map<Unit, WUnit> } {
  const map = new Map<Unit, WUnit>();
  const mirror = (u: Unit): WUnit => {
    if (u.kind === 'leaf') {
      map.set(u, u);
      return u;
    }
    const w: WBracket = {
      kind: 'wbracket',
      id: u.id,
      rel: u.rel,
      star: u.star,
      flag: u.flag,
      leftHanging: u.leftHanging,
      rightHanging: u.rightHanging,
      left: u.left.map(mirror),
      right: u.right.map(mirror),
      orig: u,
    };
    map.set(u, w);
    return w;
  };
  return { work: { roots: f.roots.map(mirror), nextId: f.nextId, ord }, map };
}

/**
 * The working counterpart of a unit that was just located in the input forest.
 * `toWork` mirrors every unit, so a miss is impossible — and therefore worth an
 * explicit throw at the cause rather than an `undefined` that surfaces two
 * frames later as 'unit vanished from the working forest'.
 */
function mirrored<T extends WUnit>(map: Map<Unit, WUnit>, u: Unit): T {
  const w = map.get(u);
  if (w === undefined) {
    throw new Error(`tree/core: ${describeUnit(u)} is not in the working mirror`);
  }
  return w as T;
}

function fromWork(work: Work): Forest {
  const rebuild = (u: WUnit): Unit => {
    if (!isW(u)) return u;
    const left = u.left.map(rebuild);
    const right = u.right.map(rebuild);
    const orig = u.orig;
    if (
      orig !== null &&
      orig.rel === u.rel &&
      orig.star === u.star &&
      orig.flag === u.flag &&
      orig.leftHanging === u.leftHanging &&
      orig.rightHanging === u.rightHanging &&
      sameRefs(orig.left, left) &&
      sameRefs(orig.right, right)
    ) {
      return orig;
    }
    // `flag` is spread conditionally, not written as `flag: undefined`: a
    // bracket that never carried one must not sprout the key, or a structural
    // comparison (tests, and §7.2's undo snapshots) sees a difference the
    // model does not have.
    return {
      kind: 'bracket',
      id: u.id,
      rel: u.rel,
      star: u.star,
      ...(u.flag === undefined ? {} : { flag: u.flag }),
      leftHanging: u.leftHanging,
      rightHanging: u.rightHanging,
      left,
      right,
    };
  };
  return { roots: work.roots.map(rebuild), nextId: work.nextId };
}

function sameRefs(a: readonly Unit[], b: readonly Unit[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/** Where a unit stands: the list holding it, its index, and the owning side. */
interface Slot {
  list: WUnit[];
  index: number;
  owner: WBracket | null;
  side: Side | null;
}

function locate(work: Work, target: WUnit): Slot {
  const search = (list: WUnit[], owner: WBracket | null, side: Side | null): Slot | null => {
    const index = list.indexOf(target);
    if (index >= 0) return { list, index, owner, side };
    for (const child of list) {
      if (!isW(child)) continue;
      const hit = search(child.left, child, 'left') ?? search(child.right, child, 'right');
      if (hit !== null) return hit;
    }
    return null;
  };
  const found = search(work.roots, null, null);
  if (found === null) throw new Error('tree/core: unit vanished from the working forest');
  return found;
}

function firstLeafPid(u: WUnit): string {
  let cur = u;
  while (isW(cur)) cur = cur.left[0];
  return cur.pid;
}

function lastLeafPid(u: WUnit): string {
  let cur = u;
  while (isW(cur)) cur = cur.right[cur.right.length - 1];
  return cur.pid;
}

function wSpan(work: Work, u: WUnit): Span {
  const start = work.ord.get(firstLeafPid(u));
  const end = work.ord.get(lastLeafPid(u));
  if (start === undefined || end === undefined) throw new Error('tree/core: unmapped leaf');
  return { start, end: end + 1 };
}

/** A side's extent: the concatenation of its units' spans (§1, §4). */
function listSpan(work: Work, list: WUnit[]): Span {
  return { start: wSpan(work, list[0]).start, end: wSpan(work, list[list.length - 1]).end };
}

function covers(outer: Span, inner: Span): boolean {
  return outer.start <= inner.start && outer.end >= inner.end;
}

/** The working mirror's own hanging read/write — the flags live on WBracket. */
function hangsW(b: WBracket, side: Side): boolean {
  return side === 'left' ? b.leftHanging : b.rightHanging;
}

function setHangingW(b: WBracket, side: Side, value: boolean): void {
  if (side === 'left') b.leftHanging = value;
  else b.rightHanging = value;
}

/**
 * §5.3 spill mechanics: B gives way and its units — both sides', in order —
 * take the position where B stood, AS LODGERS: the side that receives them
 * hangs (§10 A4 — "deleting a bracket spills its sides' contents into a room
 * where it stood and touches NOTHING else"). Nothing cascades from it: a
 * bracket left hanging at both ends is a legal working state now.
 */
function spill(work: Work, b: WBracket): WUnit[] {
  const slot = locate(work, b);
  slot.list.splice(slot.index, 1, ...b.left, ...b.right);
  if (slot.owner !== null && slot.side !== null) setHangingW(slot.owner, slot.side, true);
  return slot.list;
}

function removeUnit(work: Work, u: WUnit): WUnit[] {
  const slot = locate(work, u);
  slot.list.splice(slot.index, 1);
  return slot.list;
}

/**
 * The bracket that claims this unit as a COMMITTED member, if any (§1) — the
 * owner of a SETTLED side. A unit standing alone in a hanging side is a lodger,
 * not a member: connecting it must not break the bracket it lodges in (§10 A3),
 * and that is exactly what the flag, not the count, now decides.
 */
function claimerOf(work: Work, u: WUnit): WBracket | null {
  const slot = locate(work, u);
  if (slot.owner === null || slot.side === null) return null;
  return hangsW(slot.owner, slot.side) ? null : slot.owner;
}

/**
 * This unit's slot when it is the SOLE LODGER of a room (§10 A1's one-lodger
 * room), else null — the shape A3 protects: taking this unit out would empty a
 * hanging side, so the gesture lands INSIDE the room instead of hollowing it.
 */
function soleLodgerSlot(work: Work, u: WUnit): Slot | null {
  const slot = locate(work, u);
  if (slot.owner === null || slot.side === null) return null;
  if (slot.list.length !== 1 || !hangsW(slot.owner, slot.side)) return null;
  return slot;
}

/**
 * NOT the v3 cascade — §10 A4 deleted it. This closes I2 alone: a bracket whose
 * side the landing EMPTIED (the join consumed everything that side held) has
 * nothing left to relate, so it gives way and its remaining units take its
 * place. Only the doubly-degenerate landing of `connect` can produce one; every
 * other op leaves every side non-empty by construction.
 */
function repairEmptySides(work: Work, deaths: number[]): void {
  for (;;) {
    const victim = deepestEmptySided(work);
    if (victim === null) return;
    spill(work, victim);
    deaths.push(victim.id);
  }
}

function deepestEmptySided(work: Work): WBracket | null {
  let best: WBracket | null = null;
  let bestDepth = -1;
  const walk = (u: WUnit, depth: number): void => {
    if (!isW(u)) return;
    if ((u.left.length === 0 || u.right.length === 0) && depth > bestDepth) {
      best = u;
      bestDepth = depth;
    }
    for (const child of u.left) walk(child, depth + 1);
    for (const child of u.right) walk(child, depth + 1);
  };
  work.roots.forEach((r) => walk(r, 0));
  return best;
}

// ---------------------------------------------------------------------------
// §5.1 Connect

function refuse<T>(code: RefusalCode, message: string): Result<T> {
  return { ok: false, refusal: { code, message } };
}

/**
 * Connect(u, v) — §5.1, landing per §4.
 *
 * The law (§4): the join SUCCEEDS whenever the two spans meet; it breaks
 * exactly the brackets standing directly in its way — the bracket claiming a
 * clicked committed unit, and at most one bracket whose boundary the join
 * crosses with no room to house it — and nothing else. The only refusals are
 * geometric.
 *
 * v4 (§10) changes three things and nothing else:
 *   - there is NO cascade to defer: a bracket hanging at both ends is a legal
 *     working state, so the only closing pass is I2's (a side the join emptied);
 *   - ROOMS NEVER EMPTY (A3): a join that would take a room's last lodger lands
 *     in that room instead, growing its extent over what the join brought in —
 *     which is checked BEFORE the covering descent, because the room the join
 *     came out of is not always the one the descent would find;
 *   - nothing anchors (A1); and a crossed boundary is ELASTIC wherever a room
 *     touches it (A8): the join lands in the nearest room on either fringe —
 *     the endpoint's own, at any depth, left endpoint first — so the crossed
 *     bracket stands and its boundary slides. Give-way survives only as a
 *     defensive floor no reachable gesture hits.
 *
 * The endpoints still keep STANDING in their slots until the landing lifts them
 * into N, so the landing site is classified with them in place.
 */
export function connect(f: Forest, a: UnitAddr, b: UnitAddr): Result<ConnectOutcome> {
  const run = connectDetail(f, a, b);
  if (!run.ok) return run;
  const out: { ok: true } & ConnectOutcome = {
    ok: true,
    state: run.state,
    newBracketId: run.newBracketId,
    broken: run.broken,
  };
  if (run.editedInPlace !== undefined) out.editedInPlace = run.editedInPlace;
  return out;
}

/**
 * §5.2's preview IS the gesture: the same pure function, so the endangered
 * highlight can never drift from what the click then does. Nothing is mutated
 * either way; the caller simply discards the forest when it is only aiming.
 */
export const previewConnect = connect;

/** `connect` plus the §4 break bookkeeping the property suite reads. */
export function connectDetail(
  f: Forest,
  a: UnitAddr,
  b: UnitAddr,
): Result<ConnectOutcome & { detail: ConnectDetail }> {
  const unitA = findUnit(f, a);
  if (unitA === null) return refuse('not-found', `Nothing here to connect (${describeAddr(a)}).`);
  const unitB = findUnit(f, b);
  if (unitB === null) return refuse('not-found', `Nothing here to connect (${describeAddr(b)}).`);
  if (unitA === unitB) return refuse('self', 'A unit cannot be connected to itself.');

  const ord = ordinalsOf(f);
  const spanA = spanOfUnit(unitA, ord);
  const spanB = spanOfUnit(unitB, ord);
  const forward = spanA.start < spanB.start;
  const firstUnit = forward ? unitA : unitB;
  const secondUnit = forward ? unitB : unitA;
  const firstSpan = forward ? spanA : spanB;
  const secondSpan = forward ? spanB : spanA;

  // Spans nest or are disjoint (I4), so any overlap at all is containment.
  if (firstSpan.end > secondSpan.start) {
    return refuse('containment', 'One of these already contains the other.');
  }
  if (firstSpan.end !== secondSpan.start) {
    return refuse('not-adjacent', 'These two are not next to each other.');
  }
  const meet = firstSpan.end;

  const { work, map } = toWork(f, ord);
  const u = mirrored<WUnit>(map, firstUnit);
  const v = mirrored<WUnit>(map, secondUnit);

  // --- Step 1: break claimers (spill mechanics, cascade deferred).
  const claimerU = claimerOf(work, u);
  const claimerV = claimerOf(work, v);
  if (claimerU !== null && claimerU === claimerV) {
    // §5.1 step 1's exception: the two clicked units are the two COMMITTED
    // members of one bracket — a re-connection. Nothing structural changes and
    // the bracket keeps its id; the menu opens on it preloaded (§7.3).
    return {
      ok: true,
      state: f,
      newBracketId: claimerU.id,
      broken: [],
      editedInPlace: claimerU.id,
      detail: { claimers: [], crossed: null, emptied: [], meet, editedInPlace: claimerU.id },
    };
  }
  const claimers: number[] = [];
  for (const claimer of [claimerU, claimerV]) {
    if (claimer === null) continue;
    spill(work, claimer);
    claimers.push(claimer.id);
  }
  // Q1, scoped as §10 re-ruled it: the IMMEDIATE claimer of a committed
  // endpoint, one bracket, nothing above it, no chain.
  // After step 1 both endpoints are FREE — a root or a lodger — because a
  // claimer's spill drops ≥2 units into the slot it vacated. That is what makes
  // Release total and the landing's classification well defined (§4).

  // --- Step 2: lodger endpoints are marked for release. Nothing moves yet.

  // --- Step 3: build N and land it (§4, as §10 A3 re-ruled it).
  const nSpan: Span = { start: firstSpan.start, end: secondSpan.end };
  let crossed: number | null = null;

  // A3 FIRST — ROOMS NEVER EMPTY. A join that would consume a room's last
  // lodger lands INSIDE that room; the room's extent simply grows over the
  // material the join brought in, and the side stays hanging. Two such rooms
  // (only ever reachable when each endpoint is its own room's sole lodger) →
  // the left one, and the other side, left with nothing, gives way below.
  const emptying: WUnit[][] = [];
  for (const endpoint of [u, v]) {
    const slot = locate(work, endpoint);
    if (slot.owner === null || slot.side === null) continue;
    if (!hangsW(slot.owner, slot.side)) continue; // committed: its claimer broke
    if (slot.list.length === 1) emptying.push(slot.list);
  }

  let target: WUnit[];
  if (emptying.length > 0) {
    target = emptying[0]!;
  } else {
    // Descend through the sides whose extent covers N's span; covering sides
    // nest, so the chain is unique.
    let container: WUnit[] = work.roots;
    let blocking: WBracket | null = null;
    for (;;) {
      const cover = container.find((x) => covers(wSpan(work, x), nSpan));
      if (cover === undefined) break; // the floor, or a room with no covering unit
      if (!isW(cover)) throw new Error('tree/core: a leaf cannot cover a two-unit join');
      if (covers(listSpan(work, cover.left), nSpan)) {
        container = cover.left;
        continue;
      }
      if (covers(listSpan(work, cover.right), nSpan)) {
        container = cover.right;
        continue;
      }
      // Boundary uniqueness (§4): a unit that strictly contains the meet point
      // contains BOTH endpoints (nesting + I4) yet has neither side covering
      // the join — so its internal boundary sits exactly at the meet point, and
      // it is the only bracket whose boundary the join can cross without
      // containing it.
      blocking = cover;
      break;
    }

    if (blocking === null) {
      // Rule 1 (floor) / rule 2 (a hanging side, crossing no unit's boundary).
      target = container;
    } else {
      const w = blocking;
      // Rule 3, v4.1 (§10 A8): BOUNDARIES ARE ELASTIC WHEREVER A ROOM TOUCHES
      // THEM. The join lands in the NEAREST room on either fringe — the
      // endpoint's own room, at whatever depth — and the crossed boundary
      // slides: the chain above the landing room grows over the join, the
      // chain above the released endpoint contracts. Left endpoint's room
      // first (both rooms hold ≥2 here — a would-empty room was already taken
      // by the A3 check above, so neither choice can empty the other). Only
      // when NO room touches the join anywhere does the crossed bracket give
      // way — nearly unreachable, since a claimer's spill leaves its endpoint
      // a lodger; kept as the defensive floor of the rule.
      const roomOf = (endpoint: WUnit): WUnit[] | null => {
        const slot = locate(work, endpoint);
        if (slot.owner === null || slot.side === null) return null; // a root
        return hangsW(slot.owner, slot.side) ? slot.list : null; // settled: not a room
      };
      const uRoom = roomOf(u);
      const vRoom = roomOf(v);
      if (uRoom !== null) target = uRoom;
      else if (vRoom !== null) target = vRoom;
      else if (w.leftHanging) target = w.left;
      else if (w.rightHanging) target = w.right;
      else {
        target = spill(work, w);
        crossed = w.id;
      }
    }
  }

  // The landing moves both endpoints into N in one act.
  removeUnit(work, u);
  removeUnit(work, v);
  const n: WBracket = {
    kind: 'wbracket',
    id: work.nextId,
    // §10 A5: Ser by default — Q6 is reversed, and no unlabeled state exists.
    rel: 'Ser',
    star: null,
    leftHanging: false,
    rightHanging: false,
    left: [u],
    right: [v],
    orig: null,
  };
  work.nextId += 1;
  target.splice(insertIndex(work, target, nSpan.start), 0, n);

  // --- Step 4: NO CASCADE (§10 A4). Only I2 is closed here: a bracket both of
  // whose sides the join consumed has nothing left to relate.
  const deaths: number[] = [];
  repairEmptySides(work, deaths);

  const state = fromWork(work);
  assertInvariants(state, leafOrder(f));
  return {
    ok: true,
    state,
    newBracketId: n.id,
    broken: [...claimers, ...(crossed === null ? [] : [crossed]), ...deaths],
    detail: { claimers, crossed, emptied: deaths, meet },
  };
}

/** Where a span starting at `start` belongs among units that are all clear of it. */
function insertIndex(work: Work, list: WUnit[], start: number): number {
  let i = 0;
  while (i < list.length && wSpan(work, list[i]).start < start) i += 1;
  return i;
}

// ---------------------------------------------------------------------------
// §5.3 Delete

/**
 * The named bracket gives way — and NOTHING ELSE HAPPENS (§10 A4). Its units,
 * both sides' in order, spill into the position where it stood: roots at the
 * floor, lodgers of the side that held it otherwise, and that side hangs. No
 * chain, no shells coming down: a bracket left hanging at both ends is a legal
 * working state the analyst finishes by hand.
 */
export function deleteBracket(f: Forest, id: number): OpResult {
  const found = bracketById(f, id);
  if (found === null) return refuse('not-found', `No relationship with id ${id}.`);
  const { work, map } = toWork(f, ordinalsOf(f));
  spill(work, mirrored<WBracket>(map, found));
  const state = fromWork(work);
  assertInvariants(state, leafOrder(f));
  return { ok: true, state };
}

/**
 * §5.3's dot targeting, as a query the UI can call before deleting: a bracket
 * dot names its bracket; a leaf dot names the bracket owning the side that
 * holds the leaf; a ROOT leaf's dot-delete is a refusal.
 */
export function deleteTargetFor(f: Forest, addr: UnitAddr): Result<{ id: number }> {
  const unit = findUnit(f, addr);
  if (unit === null) return refuse('not-found', `Nothing here to delete (${describeAddr(addr)}).`);
  if (unit.kind === 'bracket') return { ok: true, id: unit.id };
  const parent = parentOf(f, addr);
  if (parent === null) {
    return refuse('root-delete', 'This proposition hangs from nothing — there is no relationship to delete.');
  }
  return { ok: true, id: parent.bracketId };
}

/** Delete by dot (§5.3) — `deleteTargetFor` followed by `deleteBracket`. */
export function deleteAt(f: Forest, addr: UnitAddr): OpResult {
  const target = deleteTargetFor(f, addr);
  if (!target.ok) return target;
  return deleteBracket(f, target.id);
}

// ---------------------------------------------------------------------------
// §10 A2 Settle — the pickup dot's own gesture

/**
 * Settle a hanging side: the room is done, and the bracket is whole.
 *
 * THE ONE WAY a side stops hanging (§10 A1, A2). Nothing else in the model
 * settles anything — not a join inside the room, not a release, not a spill,
 * not a merge. The analyst says when, with the pickup dot: "connect that to
 * Ft" always meant this gesture, and the UI spells it as connecting the room's
 * SOLE lodger with the tick's own dot.
 *
 * Legal exactly when the named side hangs and holds ONE unit; with two or more
 * lodgers it refuses (the UI shakes, §10 A6) because there is still a group to
 * assemble. `side` may be omitted when only one side hangs — the pickup dot
 * knows which it is, but a bracket hanging at both ends has two of them.
 */
export function settleSide(f: Forest, id: number, side?: Side): OpResult {
  const found = bracketById(f, id);
  if (found === null) return refuse('not-found', `No relationship with id ${id}.`);
  const hanging = hangingSides(found);
  let target: Side;
  if (side !== undefined) {
    if (!hangsAt(found, side)) {
      return refuse('not-settleable', `This bracket's ${side} side is not waiting for anything.`);
    }
    target = side;
  } else if (hanging.length === 1) {
    target = hanging[0]!;
  } else if (hanging.length === 0) {
    return refuse('not-settleable', 'This relationship is already whole.');
  } else {
    return refuse('not-settleable', 'Say which side to finish: this bracket hangs at both ends.');
  }
  if (found[target].length !== 1) {
    return refuse(
      'not-settleable',
      'This group is still being assembled — connect its pieces into one first.',
    );
  }
  const state = replaceBracket(f, id, (b) =>
    target === 'left' ? { ...b, leftHanging: false } : { ...b, rightHanging: false },
  );
  assertInvariants(state, leafOrder(f));
  return { ok: true, state };
}

/**
 * Which side of `id` the pickup dot at `side` could settle — the query the UI
 * asks before it dispatches, so a refused gesture costs a shake and no
 * transaction. Answers the sole lodger's address when the gesture is legal.
 */
export function settleTargetFor(f: Forest, id: number, side: Side): Unit | null {
  const found = bracketById(f, id);
  if (found === null || !hangsAt(found, side) || found[side].length !== 1) return null;
  return found[side][0]!;
}

// ---------------------------------------------------------------------------
// §5.4 Split

/**
 * The leaf divides into w1 (keeping `pid`) and w2 (`newPid`). Structure is
 * preserved up to I3 (Q4): a committed leaf's side now holds ⟨w1 w2⟩ and hangs,
 * awaiting reassembly; only a bracket left hanging at both ends gives way.
 *
 * Dividing the text at the chosen word is the edge's business (§7.10); the core
 * only knows that one leaf became two.
 */
export function splitLeaf(f: Forest, pid: string, newPid: string): OpResult {
  const target = findUnit(f, { kind: 'leaf', pid });
  if (target === null || target.kind !== 'leaf') {
    return refuse('not-found', `No proposition ${pid} to split.`);
  }
  if (findUnit(f, { kind: 'leaf', pid: newPid }) !== null) {
    throw new Error(`tree/core: splitLeaf would duplicate leaf ${newPid} (I5)`);
  }
  const { work, map } = toWork(f, ordinalsOf(f));
  const w1 = mirrored<Leaf>(map, target); // w1 keeps the pid, and so the object
  const w2 = leaf(newPid);
  const slot = locate(work, w1);
  slot.list.splice(slot.index + 1, 0, w2);
  // Q4: a committed leaf's side now holds ⟨w1 w2⟩ and HANGS, awaiting
  // reassembly. Nothing cascades from it (§10 A4) — a bracket whose other side
  // already hung simply hangs at both ends now.
  if (slot.owner !== null && slot.side !== null) setHangingW(slot.owner, slot.side, true);
  const state = fromWork(work);
  const order = leafOrder(f);
  order.splice(order.indexOf(pid) + 1, 0, newPid);
  assertInvariants(state, order);
  return { ok: true, state };
}

// ---------------------------------------------------------------------------
// §5.5 Merge

/**
 * Fuse a leaf with the NEXT one; the fused leaf keeps `firstPid` (§7.10) and,
 * here, its very object. A fused leaf cannot be half inside a claim, so the
 * brackets around the pair are processed INNERMOST-OUTWARD, re-classifying
 * after each step:
 *   - the leaf directly committed while its partner lies outside → give way;
 *   - the leaf a fringe lodger while its partner lies outside → release it and
 *     survive, contracted;
 *   - the leaf the SOLE LODGER of a room → the ROOM ABSORBS THE FUSION and
 *     stays hanging (§10 A1's "through … merges", A3's elastic room): nothing
 *     is released and nothing gives way;
 *   - a bracket whose own boundary separates the pair → give way.
 * Because spills re-classify, an outer bracket usually sees a fresh fringe
 * lodger and releases: merge removes the MINIMAL set.
 */
export function mergeLeaves(f: Forest, firstPid: string): OpResult {
  const order = leafOrder(f);
  const at = order.indexOf(firstPid);
  if (at < 0) return refuse('not-found', `No proposition ${firstPid} to merge.`);
  if (at + 1 >= order.length) {
    return refuse('not-found', `Nothing follows ${firstPid} to merge it with.`);
  }
  const secondPid = order[at + 1];
  const first = findUnit(f, { kind: 'leaf', pid: firstPid });
  const second = findUnit(f, { kind: 'leaf', pid: secondPid });
  if (first === null || second === null) {
    // `order` came from this very forest, so both leaves are in it.
    throw new Error(`tree/core: leaf order names ${firstPid}/${secondPid}, the forest does not`);
  }
  const { work, map } = toWork(f, ordinalsOf(f));
  const w1 = mirrored<Leaf>(map, first);
  const w2 = mirrored<Leaf>(map, second);

  const lca = lowestCommonBracket(work, w1, w2);
  climbTo(work, w1, lca, 'right');
  climbTo(work, w2, lca, 'left');
  if (lca !== null && lca.left.includes(w1) && lca.right.includes(w2)) {
    // The LCA's own internal boundary separates the pair — it gives way.
    spill(work, lca);
  }
  // §10 A3's elastic room, mirrored onto the fusion. The fused leaf is w1's own
  // object (§7.10), so a room w1 stopped in has already absorbed the merge and
  // there is nothing to do. When only W2 sits alone in a room, that room takes
  // w1 IN — growing outward over the material the merge brought in, exactly as
  // A3's own example grows `⟨Ser'⟩` over the 42b beside it — rather than being
  // emptied by w2's departure. With two such rooms A3 rules for the left, and
  // the left is where w1 stands by construction.
  const room2 = soleLodgerSlot(work, w2);
  if (room2 !== null && soleLodgerSlot(work, w1) === null) {
    removeUnit(work, w1);
    room2.list.splice(0, 0, w1);
  }
  removeUnit(work, w2); // the fusion itself: one leaf where two stood
  // I2, closed exactly as `connect` closes it (`repairEmptySides`): a bracket
  // the fusion left with an EMPTY side — the loser of A3's two-room tiebreak,
  // or one whose settled side held nothing but w2 — has nothing left to relate
  // and gives way. No room is ever the victim: rooms kept their lodger above.
  repairEmptySides(work, []);

  const state = fromWork(work);
  order.splice(at + 1, 1);
  assertInvariants(state, order);
  return { ok: true, state };
}

/**
 * Walk one half of the pair out to `stop` (the lowest bracket holding both, or
 * the floor). At each level the leaf is either committed — its bracket gives
 * way — or a fringe lodger, which the bracket releases while surviving. It is
 * always at the fringe FACING its partner: everything between the two leaves is
 * empty, so no unit of that side can stand between them (edge-lodger totality).
 */
function climbTo(work: Work, leafUnit: Leaf, stop: WBracket | null, facing: Side): void {
  for (;;) {
    const slot = locate(work, leafUnit);
    const owner = slot.owner;
    if (owner === null || owner === stop) return;
    if (slot.list.length === 1) {
      // §10 A1 names merges outright: "a hanging side stays hanging — through
      // in-room joins, releases, spills, MERGES — until the analyst settles it
      // explicitly". So a ROOM holding this leaf alone is not annihilated by
      // the fusion; the lodger stays put and the room's extent grows over the
      // partner's words (A3's elastic room). Only a sole COMMITTED unit still
      // forces its bracket to give way: that bracket really is left with
      // nothing to relate.
      if (slot.side !== null && hangsW(owner, slot.side)) return;
      spill(work, owner);
      continue;
    }
    const fringe = facing === 'right' ? slot.list.length - 1 : 0;
    if (slot.index !== fringe) {
      throw new Error(`tree/core: merge found ${leafUnit.pid} off the fringe of its room`);
    }
    slot.list.splice(slot.index, 1);
    const outer = locate(work, owner);
    outer.list.splice(facing === 'right' ? outer.index + 1 : outer.index, 0, leafUnit);
  }
}

function lowestCommonBracket(work: Work, a: WUnit, b: WUnit): WBracket | null {
  const path = (target: WUnit): WBracket[] => {
    const chain: WBracket[] = [];
    let cur = target;
    for (;;) {
      const slot = locate(work, cur);
      if (slot.owner === null) return chain.reverse();
      chain.push(slot.owner);
      cur = slot.owner;
    }
  };
  const pa = path(a);
  const pb = path(b);
  let out: WBracket | null = null;
  for (let i = 0; i < Math.min(pa.length, pb.length); i += 1) {
    if (pa[i] !== pb[i]) break;
    out = pa[i];
  }
  return out;
}

// ---------------------------------------------------------------------------
// §5.6 Attribute edits and clear

/**
 * Set a bracket's relationship. The star is fixed up locally, exactly as the
 * old command did: null for a coordinate target (I7); for a subordinate target
 * the existing star is kept, or — coming from coordinate or from an unlabeled
 * new bracket — the taxonomy's default end.
 */
export function setRelationship(
  f: Forest,
  id: number,
  rel: string,
  entry: TaxonomyFacts,
): OpResult {
  const found = bracketById(f, id);
  if (found === null) return refuse('not-found', `No relationship with id ${id}.`);
  const star: Star | null = entry.coordinate ? null : (found.star ?? defaultStar(entry));
  const state = replaceBracket(f, id, (b) => ({ ...b, rel, star }));
  assertInvariants(state, leafOrder(f));
  return { ok: true, state };
}

/**
 * Move the star to the other end, so the label at each end — and the derived
 * `reversed` — follows it. A coordinate bracket has no star to move (I7): the
 * forest comes back untouched, as the old command reported failure.
 */
export function flipStar(f: Forest, id: number, entry: TaxonomyFacts): OpResult {
  const found = bracketById(f, id);
  if (found === null) return refuse('not-found', `No relationship with id ${id}.`);
  if (entry.coordinate || found.star === null) return { ok: true, state: f };
  const star: Star = found.star === 'left' ? 'right' : 'left';
  const state = replaceBracket(f, id, (b) => ({ ...b, star }));
  assertInvariants(state, leafOrder(f));
  return { ok: true, state };
}

/**
 * §5.6 Clear tree: brackets := none; every leaf a root. Ids are not reused, so
 * the mint carries over untouched. It cannot refuse, but it answers in the same
 * `Result` as every other op (§5) so a command dispatcher needs no special case.
 */
export function clearTree(f: Forest): OpResult {
  const roots: Unit[] = [];
  const walk = (u: Unit): void => {
    if (u.kind === 'leaf') {
      roots.push(u);
      return;
    }
    u.left.forEach(walk);
    u.right.forEach(walk);
  };
  f.roots.forEach(walk);
  const state = { roots, nextId: f.nextId };
  assertInvariants(state, leafOrder(f));
  return { ok: true, state };
}

function replaceBracket(f: Forest, id: number, edit: (b: Bracket) => Bracket): Forest {
  const rebuild = (u: Unit): Unit => {
    if (u.kind === 'leaf') return u;
    if (u.id === id) return edit(u);
    const left = u.left.map(rebuild);
    const right = u.right.map(rebuild);
    if (sameRefs(left, u.left) && sameRefs(right, u.right)) return u;
    return { ...u, left, right };
  };
  return { roots: f.roots.map(rebuild), nextId: f.nextId };
}

// ---------------------------------------------------------------------------
// Formatting — the spec's own notation, so tests read like §6

/**
 * `Alt[X, Y]` for settled sides, `⟨a b c⟩` for a hanging one (§6) — INCLUDING
 * `⟨x⟩`, the one-lodger room §10 A1 made an ordinary state.
 */
export function formatUnit(u: Unit): string {
  if (u.kind === 'leaf') return u.pid;
  return `${u.rel ?? '?'}[${formatSide(u.left, u.leftHanging)}, ${
    formatSide(u.right, u.rightHanging)
  }]`;
}

function formatSide(side: readonly Unit[], hanging: boolean): string {
  if (!hanging) return side.map(formatUnit).join(' ');
  return `⟨${side.map(formatUnit).join(' ')}⟩`;
}

export function formatForest(f: Forest): string {
  return `[${f.roots.map(formatUnit).join(', ')}]`;
}

function describeAddr(addr: UnitAddr): string {
  return addr.kind === 'leaf' ? `prop:${addr.pid}` : `bracket:${addr.id}`;
}

function describeUnit(u: Unit): string {
  return u.kind === 'leaf' ? `leaf ${u.pid}` : `bracket ${u.id}`;
}
