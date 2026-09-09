/**
 * The property suite (spec §8.3, acceptance row 16's random half): seeded
 * random forests — including several rooms under a common ancestor — driven by
 * random gesture sequences. After EVERY gesture:
 *
 *   - I1–I7 hold and the leaf order is exactly what the document says;
 *   - a refusal leaves the forest byte-identical — and, because every forest
 *     driven here is DEEP-FROZEN, no op mutates its input on any path;
 *   - `previewConnect`'s broken list is exactly `connect`'s;
 *   - the ids that actually vanished are exactly `broken`;
 *   - breakage is bounded by §4 (≤2 claimers + ≤1 crossed + an emptied side),
 *     and the crossed bracket's internal boundary sits at the endpoints' MEET
 *     POINT — the boundary-uniqueness lemma, asserted rather than assumed;
 *   - ROOMS PERSIST (spec §10 A1): no gesture but `settleSide` ever clears a
 *     hanging flag. This is the v4 property the whole revision turns on, and it
 *     replaces v3's cascade assertions — there is no cascade to assert.
 *   - ROOMS SURVIVE (§10 A1 again, and the half a flag check cannot see): a
 *     bracket that hung is still STANDING afterwards unless the gesture is
 *     entitled to retire it and said so — `broken` for a connect, the named id
 *     for a delete, NOTHING for a split, §5.5's own rule for a merge. Without
 *     it, a gesture that annihilates the hanging bracket passes the persistence
 *     check vacuously, which is exactly how a merge that spilled a one-lodger
 *     room survived 2000 seeded runs.
 */

import { describe, expect, it } from 'vitest';
import type { Forest, Side, Unit, UnitAddr } from '../core';
import {
  assertInvariants,
  bracketById,
  connectDetail,
  deleteBracket,
  formatForest,
  hangsAt,
  leafOrder,
  leavesOf,
  mergeLeaves,
  parentOf,
  previewConnect,
  settleSide,
  spanOf,
  splitLeaf,
} from '../core';
import { buildForest, leaf, loadForest } from '../core';
import { freeze } from './mk';

// A tiny deterministic PRNG: the suite must fail the same way twice.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RELS = ['Ser', 'FtIn', 'Grnd', 'CE', 'Alt'];

function randomForest(rnd: () => number, leaves: string[]): Forest {
  let nextId = 1;
  const tree = (pids: string[]): Unit => {
    if (pids.length === 1) return leaf(pids[0]);
    const cut = 1 + Math.floor(rnd() * (pids.length - 1));
    const rel = RELS[Math.floor(rnd() * RELS.length)];
    const id = nextId;
    nextId += 1;
    return {
      kind: 'bracket',
      id,
      rel,
      star: rel === 'Ser' || rel === 'Alt' ? null : rnd() < 0.5 ? 'left' : 'right',
      leftHanging: false,
      rightHanging: false,
      left: [tree(pids.slice(0, cut))],
      right: [tree(pids.slice(cut))],
    };
  };

  const roots: Unit[] = [];
  let rest = leaves;
  while (rest.length > 0) {
    const take = Math.min(rest.length, 3 + Math.floor(rnd() * rest.length));
    roots.push(tree(rest.slice(0, take)));
    rest = rest.slice(take);
  }
  let f = buildForest(roots, nextId);

  // Deletes are how rooms come into being; a few of them give the generator the
  // shapes the landing rules care about.
  const opens = Math.floor(rnd() * 6);
  for (let i = 0; i < opens; i += 1) {
    const ids = bracketIds(f);
    if (ids.length === 0) break;
    const r = deleteBracket(f, ids[Math.floor(rnd() * ids.length)]);
    if (r.ok) f = r.state;
  }
  return f;
}

function bracketIds(f: Forest): number[] {
  const out: number[] = [];
  const walk = (u: Unit): void => {
    if (u.kind === 'leaf') return;
    out.push(u.id);
    u.left.forEach(walk);
    u.right.forEach(walk);
  };
  f.roots.forEach(walk);
  return out;
}

function allUnits(f: Forest): Unit[] {
  const out: Unit[] = [];
  const walk = (u: Unit): void => {
    out.push(u);
    if (u.kind === 'bracket') {
      u.left.forEach(walk);
      u.right.forEach(walk);
    }
  };
  f.roots.forEach(walk);
  return out;
}

const addrOf = (u: Unit): UnitAddr =>
  u.kind === 'leaf' ? { kind: 'leaf', pid: u.pid } : { kind: 'bracket', id: u.id };

/** Two units whose spans MEET — the only pairs a connect may succeed on. */
function adjacentPairs(f: Forest): [UnitAddr, UnitAddr][] {
  const units = allUnits(f);
  const spans = new Map(units.map((u) => [u, spanOf(f, addrOf(u))]));
  const pairs: [UnitAddr, UnitAddr][] = [];
  for (const a of units) {
    for (const b of units) {
      if (a === b) continue;
      if ((spans.get(a) as { end: number }).end === (spans.get(b) as { start: number }).start) {
        pairs.push([addrOf(a), addrOf(b)]);
      }
    }
  }
  return pairs;
}

/** The shape §4's landing rules are really about: rooms in separate subtrees. */
function twoRoomsUnderOneAncestor(f: Forest): boolean {
  const roomsIn = (u: Unit): number => {
    if (u.kind === 'leaf') return 0;
    const here = (u.leftHanging ? 1 : 0) + (u.rightHanging ? 1 : 0);
    return here + u.left.reduce((n, c) => n + roomsIn(c), 0) + u.right.reduce((n, c) => n + roomsIn(c), 0);
  };
  const check = (u: Unit): boolean => {
    if (u.kind === 'leaf') return false;
    const left = u.left.reduce((n, c) => n + roomsIn(c), 0) + (u.leftHanging ? 1 : 0);
    const right = u.right.reduce((n, c) => n + roomsIn(c), 0) + (u.rightHanging ? 1 : 0);
    if (left >= 1 && right >= 1) return true;
    return [...u.left, ...u.right].some(check);
  };
  return f.roots.some(check);
}

/** Every side that hangs, as 'id:side' — what the rooms-persist claim reads. */
function hangingSidesOf(f: Forest): Set<string> {
  const out = new Set<string>();
  const walk = (u: Unit): void => {
    if (u.kind === 'leaf') return;
    if (u.leftHanging) out.add(`${u.id}:left`);
    if (u.rightHanging) out.add(`${u.id}:right`);
    u.left.forEach(walk);
    u.right.forEach(walk);
  };
  f.roots.forEach(walk);
  return out;
}

/**
 * §10 A1, as a property: every side that hung BEFORE and whose bracket is still
 * standing AFTER is still hanging. Only `settleSide` may break this, and it is
 * the only gesture excluded from the check.
 *
 * On its own this is HALF the claim, and the weaker half: a gesture that
 * DESTROYS the hanging bracket passes it vacuously. `roomsSurvived` below is
 * the other half, and the two are always asserted together.
 */
function roomsPersisted(before: Forest, after: Forest): boolean {
  const still = hangingSidesOf(after);
  const alive = new Set(bracketIds(after));
  for (const key of hangingSidesOf(before)) {
    const id = Number(key.slice(0, key.indexOf(':')));
    if (alive.has(id) && !still.has(key)) return false;
  }
  return true;
}

/**
 * §10 A1's other half, with NO vacuous escape: a bracket that hung before must
 * still be STANDING after, unless the gesture is one that may retire it and
 * says so. `allowed` is that enumeration, computed per gesture from the state
 * BEFORE it — `broken` for a connect, the named id for a delete, nothing at all
 * for a split or a settle, and §5.5's own rule for a merge (`mergeMayRetire`).
 *
 * Without this, "a hanging side stays hanging" is silent about the gesture that
 * annihilates the whole bracket — which is exactly how a merge that spilled a
 * one-lodger room passed 2000 seeded runs.
 */
function roomsSurvived(before: Forest, after: Forest, allowed: Set<number>): boolean {
  const alive = new Set(bracketIds(after));
  for (const key of hangingSidesOf(before)) {
    const id = Number(key.slice(0, key.indexOf(':')));
    if (!alive.has(id) && !allowed.has(id)) return false;
  }
  return true;
}

/** The chain of {bracket, side} from the outermost bracket down to a leaf. */
function pathTo(f: Forest, pid: string): { id: number; side: Side }[] {
  const out: { id: number; side: Side }[] = [];
  const walk = (u: Unit, trail: { id: number; side: Side }[]): boolean => {
    if (u.kind === 'leaf') {
      if (u.pid !== pid) return false;
      out.push(...trail);
      return true;
    }
    for (const side of ['left', 'right'] as const) {
      for (const child of u[side]) {
        if (walk(child, [...trail, { id: u.id, side }])) return true;
      }
    }
    return false;
  };
  f.roots.forEach((r) => walk(r, []));
  return out;
}

/**
 * The brackets §5.5 ALLOWS a merge of `firstPid` with its successor to retire,
 * derived from the spec's text rather than from the code:
 *
 *   - a bracket whose SETTLED side lies on the path to either leaf — the leaf is
 *     a committed member, and a bracket the fusion takes a member out of has
 *     nothing left to relate (or, higher up, is left with an empty side);
 *   - the pair's lowest common bracket, whose own boundary may separate them;
 *   - the LOSER of A3's two-room tiebreak: when each leaf is the sole lodger of
 *     a room, the left room takes the fusion and the right one is left empty.
 *
 * Everything else must still be standing afterwards — above all a room the
 * fusion merely passed through, at ANY lodger count.
 */
function mergeMayRetire(f: Forest, firstPid: string): Set<number> {
  const order = leafOrder(f);
  const secondPid = order[order.indexOf(firstPid) + 1];
  const first = pathTo(f, firstPid);
  const second = pathTo(f, secondPid);
  const out = new Set<number>();
  for (const path of [first, second]) {
    for (const step of path) {
      const b = bracketById(f, step.id);
      if (b !== null && !hangsAt(b, step.side)) out.add(step.id);
    }
  }
  let lca: number | null = null;
  for (let i = 0; i < Math.min(first.length, second.length); i += 1) {
    if (first[i].id !== second[i].id) break;
    lca = first[i].id;
  }
  if (lca !== null) out.add(lca);
  const sole = (path: { id: number; side: Side }[]): { id: number; side: Side } | null => {
    const last = path[path.length - 1];
    if (last === undefined) return null;
    const b = bracketById(f, last.id);
    if (b === null || !hangsAt(b, last.side) || b[last.side].length !== 1) return null;
    return last;
  };
  const soleFirst = sole(first);
  const soleSecond = sole(second);
  if (soleFirst !== null && soleSecond !== null) out.add(soleSecond.id);
  return out;
}

function sameContainer(f: Forest, a: UnitAddr, b: UnitAddr): boolean {
  const pa = parentOf(f, a);
  const pb = parentOf(f, b);
  if (pa === null || pb === null) return pa === pb;
  return pa.bracketId === pb.bracketId && pa.side === pb.side;
}

/** The crossed bracket's internal boundary, in leaf ordinals. */
function boundaryOf(f: Forest, id: number): number {
  const bracket = bracketById(f, id);
  if (bracket === null) throw new Error(`no bracket ${id} to take the boundary of`);
  return spanOf(f, { kind: 'bracket', id }).start + bracket.left.flatMap(leavesOf).length;
}

/** The bracket that claims this unit as a committed member, if any (§1) — the
 *  owner of a SETTLED side, whatever it holds (§10 A1). */
function claimerOf(f: Forest, owner: { bracketId: number; side: Side } | null): number | null {
  if (owner === null) return null;
  const bracket = bracketById(f, owner.bracketId);
  if (bracket === null) return null;
  return hangsAt(bracket, owner.side) ? null : owner.bracketId;
}

/**
 * The pairs that reach §4's landing rule 3, in two grades of sharpness.
 *
 * `flanking` — for each bracket, the two LEAVES on either side of its own
 * internal boundary. Boundary uniqueness puts the crossed bracket's boundary
 * exactly at the endpoints' meet point, so this is the shape, and leaves rather
 * than any flanking unit because the deeper the endpoints the more of rule 3 is
 * actually adjudicated. A boundary whose flanking leaf is a DIRECT member of the
 * bracket that owns it is skipped: step 1 breaks that bracket as a CLAIMER (or,
 * when both are, the gesture is the same-bracket re-connection), so the landing
 * never reaches the crossing at all.
 *
 * `shaped` — the subset whose sides step 1 leaves UNCHANGED, which is the L1/E7
 * configuration where W really must give way or be saved by 3b's count. The
 * extra condition is that neither endpoint's claimer is the very unit standing
 * in W's side: when it is, that claimer's spill turns the side into a room and
 * the landing takes rule 3a instead. Roughly three quarters of these produce a
 * give-way, against one in fourteen for `flanking`.
 *
 * Both are drawn deliberately because rule 3 is close to unreachable by luck:
 * under a uniform draw over adjacent pairs the landing crosses a boundary about
 * twice per thousand connects.
 */
function rule3Pairs(f: Forest): {
  flanking: [UnitAddr, UnitAddr][];
  shaped: [UnitAddr, UnitAddr][];
} {
  const order = leafOrder(f);
  const flanking: [UnitAddr, UnitAddr][] = [];
  const shaped: [UnitAddr, UnitAddr][] = [];
  for (const id of bracketIds(f)) {
    const w = bracketById(f, id);
    if (w === null) continue;
    const at = boundaryOf(f, id);
    if (at <= 0 || at >= order.length) continue;
    const x: UnitAddr = { kind: 'leaf', pid: order[at - 1] };
    const y: UnitAddr = { kind: 'leaf', pid: order[at] };
    const px = parentOf(f, x);
    const py = parentOf(f, y);
    if (px?.bracketId === id || py?.bracketId === id) continue;
    flanking.push([x, y]);
    const idOf = (u: Unit): number | null => (u.kind === 'bracket' ? u.id : null);
    const mx = idOf(w.left[w.left.length - 1]);
    const my = idOf(w.right[0]);
    if (claimerOf(f, px) !== mx && claimerOf(f, py) !== my) shaped.push([x, y]);
  }
  return { flanking, shaped };
}

/** Half of what this generator actually produces over seeds 1..2000. */
const FLOORS = {
  // Actual, seeds 1..2000: 1262, 16483, 3199, 172, 1873, 342, 5035, 3283, 2931.
  sawTwoRooms: 630,
  connects: 8000,
  refusals: 1500,
  crossings: 85,
  grown: 900,
  settles: 170,
  settleRefusals: 2500,
  splits: 1600,
  merges: 1450,
};

describe('property: random forests under random gestures (§8.3, row 16)', () => {
  it('holds every invariant and every §4 claim over 2000 seeded runs', () => {
    let sawTwoRooms = 0;
    let connects = 0;
    let refusals = 0;
    let crossings = 0;
    let grown = 0;
    let settles = 0;
    let settleRefusals = 0;
    let splits = 0;
    let merges = 0;

    for (let seed = 1; seed <= 2000; seed += 1) {
      const rnd = mulberry32(seed);
      const size = 5 + Math.floor(rnd() * 10);
      const pids = Array.from({ length: size }, (_, i) => `w${i}`);
      let f = freeze(randomForest(rnd, pids));
      let order = [...pids];
      assertInvariants(f, order);
      let sawItHere = twoRoomsUnderOneAncestor(f);

      for (let step = 0; step < 18; step += 1) {
        const roll = rnd();
        const before = f;
        const beforeIds = bracketIds(before);
        // The ids THIS gesture is allowed to retire, enumerated before it runs
        // (§10 A1: everything else that hung must still be standing after).
        let allowedDeaths = new Set<number>();
        // What the state must still be if the op refuses (§5, §8.3). Compared
        // by CONTENT: `f` is never reassigned on the refusal path, so an
        // `expect(f).toBe(before)` there could not fail whatever the core did.
        const snapshot = formatForest(before);

        if (roll < 0.55) {
          // Connect: mostly a legal adjacent pair, sometimes anything at all.
          const all = adjacentPairs(f);
          // Half the legal picks are deliberately drawn from pairs that live in
          // DIFFERENT containers — the landing's rule-3 cases are rare under a
          // uniform draw, and they are the ones worth hammering.
          const crossing = all.filter(([x, y]) => !sameContainer(f, x, y));
          // ...and a further draw straight from the pairs that flank a
          // bracket's internal boundary, which is the only way into rule 3.
          const { flanking, shaped } = rule3Pairs(f);
          const draw = rnd();
          const pairs =
            shaped.length > 0 && draw < 0.8
              ? shaped
              : draw < 0.5 && flanking.length > 0
                ? flanking
                : draw < 0.75 && crossing.length > 0
                  ? crossing
                  : all;
          const units = allUnits(f);
          const pick: [UnitAddr, UnitAddr] =
            rnd() < 0.8 && pairs.length > 0
              ? pairs[Math.floor(rnd() * pairs.length)]
              : [
                  addrOf(units[Math.floor(rnd() * units.length)]),
                  addrOf(units[Math.floor(rnd() * units.length)]),
                ];
          const preview = previewConnect(f, pick[0], pick[1]);
          const run = connectDetail(f, pick[0], pick[1]);
          expect(run.ok).toBe(preview.ok);
          if (!run.ok) {
            refusals += 1;
            expect(formatForest(f)).toBe(snapshot); // byte-identical
            expect(['not-adjacent', 'containment', 'self', 'not-found']).toContain(
              run.refusal.code,
            );
            continue;
          }
          connects += 1;
          allowedDeaths = new Set(run.broken);
          expect(ok(preview).broken).toEqual(run.broken);

          // Bounded breakage, exactly enumerated before dispatch (§4).
          expect(run.detail.claimers.length).toBeLessThanOrEqual(2);
          expect(run.broken).toEqual([
            ...run.detail.claimers,
            ...(run.detail.crossed === null ? [] : [run.detail.crossed]),
            ...run.detail.emptied,
          ]);
          if (run.detail.crossed !== null) {
            crossings += 1;
            // Boundary uniqueness: the only bracket a join can cross without
            // containing it has its boundary AT the meet point.
            expect(boundaryOf(before, run.detail.crossed)).toBe(run.detail.meet);
          }
          // §10 A3: a room the join emptied is only ever the doubly-degenerate
          // landing, and it takes exactly the one bracket that had nothing left
          // to relate — never a chain.
          expect(run.detail.emptied.length).toBeLessThanOrEqual(1);
          // A join that landed in a room its endpoint was the SOLE lodger of
          // grew that room instead of hollowing it.
          const soleLodger = [pick[0], pick[1]].some((addr) => {
            const owner = parentOf(before, addr);
            if (owner === null) return false;
            const b = bracketById(before, owner.bracketId);
            return b !== null && hangsAt(b, owner.side) && b[owner.side].length === 1;
          });
          if (soleLodger && run.detail.emptied.length === 0) grown += 1;

          const afterIds = bracketIds(run.state);
          const removed = beforeIds.filter((id) => !afterIds.includes(id));
          expect([...removed].sort((x, y) => x - y)).toEqual(
            [...run.broken].sort((x, y) => x - y),
          );
          if (run.editedInPlace === undefined) expect(afterIds).toContain(run.newBracketId);
          // The input was frozen, so a successful op that had written through a
          // shared unit or side would already have thrown at the write site.
          expect(formatForest(before)).toBe(snapshot);
          f = freeze(run.state);
        } else if (roll < 0.7) {
          // §10 A2's settle, legal or not — the only gesture allowed to clear a
          // hanging flag, and the reason the rooms-persist check below excludes
          // exactly this branch.
          const ids = bracketIds(f);
          const id = ids.length > 0 && rnd() < 0.9 ? ids[Math.floor(rnd() * ids.length)] : 9999;
          const side: Side = rnd() < 0.5 ? 'left' : 'right';
          const r = settleSide(f, id, side);
          if (!r.ok) {
            settleRefusals += 1;
            expect(['not-found', 'not-settleable']).toContain(r.refusal.code);
            expect(formatForest(f)).toBe(snapshot);
            continue;
          }
          settles += 1;
          const settled = bracketById(r.state, id);
          expect(settled).not.toBeNull();
          expect(hangsAt(settled as NonNullable<typeof settled>, side)).toBe(false);
          // A settle moves NOTHING: same ids, same leaves, one flag.
          expect(bracketIds(r.state)).toEqual(beforeIds);
          expect(leafOrder(r.state)).toEqual(leafOrder(before));
          expect(formatForest(before)).toBe(snapshot);
          assertInvariants(r.state, order);
          f = freeze(r.state);
          continue;
        } else if (roll < 0.82) {
          const ids = bracketIds(f);
          const id = ids.length > 0 && rnd() < 0.9 ? ids[Math.floor(rnd() * ids.length)] : 9999;
          const r = deleteBracket(f, id);
          if (!r.ok) {
            expect(r.refusal.code).toBe('not-found');
            expect(formatForest(f)).toBe(snapshot);
            continue;
          }
          // §5.3 at §10 A4: the named bracket gives way and NOTHING ELSE does.
          allowedDeaths = new Set([id]);
          expect(bracketIds(r.state).filter((x) => !beforeIds.includes(x))).toEqual([]);
          expect(beforeIds.filter((x) => !bracketIds(r.state).includes(x))).toEqual([id]);
          f = freeze(r.state);
        } else if (roll < 0.91) {
          const pid = order[Math.floor(rnd() * order.length)];
          const fresh = `${pid}s${step}`;
          const r = splitLeaf(f, pid, fresh);
          if (!r.ok) {
            expect(formatForest(f)).toBe(snapshot);
            continue;
          }
          splits += 1;
          // §5.4 at Q4/A4: a split retires NOTHING — it hangs a side and stops.
          expect(bracketIds(r.state)).toEqual(beforeIds);
          order.splice(order.indexOf(pid) + 1, 0, fresh);
          f = freeze(r.state);
        } else {
          const at = Math.floor(rnd() * order.length);
          // §5.5's own rule, read off the state before the fusion — the merge
          // may retire these and no others.
          const mayRetire = at + 1 < order.length ? mergeMayRetire(f, order[at]) : new Set<number>();
          const r = mergeLeaves(f, order[at]);
          if (!r.ok) {
            expect(r.refusal.code).toBe('not-found');
            expect(formatForest(f)).toBe(snapshot);
            continue;
          }
          merges += 1;
          allowedDeaths = mayRetire;
          expect(beforeIds.filter((x) => !bracketIds(r.state).includes(x) && !mayRetire.has(x)))
            .toEqual([]);
          order = order.filter((_, i) => i !== at + 1);
          f = freeze(r.state);
        }

        assertInvariants(f, order);
        expect(leafOrder(f)).toEqual(order);
        expect(formatForest(f)).not.toContain('⟨⟩');
        // §10 A1, on every gesture but the settle (which `continue`s above):
        // nothing anchors itself, ever — AND nothing quietly annihilates the
        // bracket instead, which is the half a live-standing check cannot see.
        expect(roomsPersisted(before, f)).toBe(true);
        expect(roomsSurvived(before, f, allowedDeaths)).toBe(true);
        if (!sawItHere && twoRoomsUnderOneAncestor(f)) sawItHere = true;
      }
      if (sawItHere) sawTwoRooms += 1;
    }

    // The suite is worthless if the interesting paths never ran — and a floor
    // the generator only just clears is one sample away from passing while the
    // path it guards has stopped being generated at all. The seeds are the
    // fixed range 1..2000 and the PRNG is deterministic, so these counts are
    // exact, not sampled; each floor sits at roughly half of what this
    // generator actually produces. The ones that matter most: `crossings` is
    // how often §4's boundary-uniqueness lemma is asserted, `grown` is §10 A3
    // (a join out of a one-lodger room GROWING it rather than hollowing it),
    // and `settles` is the only gesture in the model that clears a flag.
    expect(sawTwoRooms).toBeGreaterThan(FLOORS.sawTwoRooms);
    expect(connects).toBeGreaterThan(FLOORS.connects);
    expect(refusals).toBeGreaterThan(FLOORS.refusals);
    // §10 A8: after step 1 every endpoint under a crossed bracket stands in
    // some room, so the give-way path is unreachable — pinned as EXACTLY zero
    // so any regression that starts destroying crossed brackets screams here.
    expect(crossings).toBe(0);
    expect(grown).toBeGreaterThan(FLOORS.grown);
    expect(settles).toBeGreaterThan(FLOORS.settles);
    expect(settleRefusals).toBeGreaterThan(FLOORS.settleRefusals);
    expect(splits).toBeGreaterThan(FLOORS.splits);
    expect(merges).toBeGreaterThan(FLOORS.merges);
    // §8.3's sweep is the suite's slowest obligation by design; give it its own
    // budget rather than let a loaded machine turn it into a flake.
  }, 30_000);

  it('keeps ≥2 rooms under a common ancestor legal and connectable', () => {
    // Built by hand so the shape is guaranteed, not hoped for.
    const f = loadForest([
      {
        kind: 'bracket',
        id: 1,
        rel: 'Alt',
        star: null,
        leftHanging: false,
        rightHanging: false,
        left: [
          {
            kind: 'bracket',
            id: 2,
            rel: 'FtIn',
            star: 'right',
            leftHanging: false,
            rightHanging: true,
            left: [leaf('a')],
            right: [leaf('b'), leaf('c')],
          },
        ],
        right: [
          {
            kind: 'bracket',
            id: 3,
            rel: 'Grnd',
            star: 'left',
            leftHanging: true,
            rightHanging: false,
            left: [leaf('d'), leaf('e')],
            right: [leaf('g')],
          },
        ],
      },
    ]);
    freeze(f);
    assertInvariants(f, ['a', 'b', 'c', 'd', 'e', 'g']);
    expect(twoRoomsUnderOneAncestor(f)).toBe(true);
    const r = ok(connectDetail(f, { kind: 'leaf', pid: 'c' }, { kind: 'leaf', pid: 'd' }));
    // §10 A8: the join lands in c's own room (deep inside the FtIn), the
    // Alt's internal boundary slides past d, and NOTHING gives way — the
    // exact shape from the analyst's third screenshot, at property scale.
    expect(formatForest(r.state)).toBe('[Alt[FtIn[a, ⟨b Ser[c, d]⟩], Grnd[⟨e⟩, g]]]');
    expect(r.detail.crossed).toBeNull();
    expect(r.broken).toEqual([]);
  });
});

function ok<T>(r: ({ ok: true } & T) | { ok: false; refusal: { code: string } }): T {
  if (!r.ok) throw new Error(`expected success, got ${r.refusal.code}`);
  return r;
}

// ---------------------------------------------------------------------------
// Landing rule 3, exercised deliberately
//
// The crossed-bracket cases are rare under a uniform random draw (they need a
// join whose endpoints sit in different subtrees of one bracket), so the whole
// family is enumerated here instead. Each side of W is built to STAND, at
// landing time, in one of three profiles:
//
//   A  — anchored: the endpoint lies in a room deeper inside W's member;
//   R2 — a room of two, the endpoint standing in it directly;
//   R3 — a room of three, likewise.
//
// A room profile is produced the way rooms really appear mid-gesture: the
// endpoint is COMMITTED in a bracket that step 1 breaks, and the spill makes
// the room. What v4 (§10 A1) changed is the RULE the profiles feed: the crossed
// bracket takes a hanging side if it has one — the left, on a tie — and gives
// way only when neither side hangs. There is no after-departure count any more,
// because nothing anchors for it to count towards.

type Profile = 'A' | 'R2' | 'R3';
const PROFILES: Profile[] = ['A', 'R2', 'R3'];
const lengthOf = (p: Profile): number => (p === 'A' ? 1 : p === 'R2' ? 2 : 3);

interface Piece {
  unit: Unit;
  endpoint: string;
  /** The bracket step 1 must break, if this profile needs one. */
  claimer: number | null;
}

function buildPiece(
  p: Profile,
  side: 'left' | 'right',
  mint: () => string,
  id: () => number,
): Piece {
  const bracket = (l: Unit[], r: Unit[], bid: number): Unit => ({
    kind: 'bracket',
    id: bid,
    rel: 'Ser',
    star: null,
    leftHanging: l.length >= 2,
    rightHanging: r.length >= 2,
    left: l,
    right: r,
  });
  if (side === 'left') {
    if (p === 'A') {
      const c1 = leaf(mint());
      const c2 = leaf(mint());
      const end = mint();
      return { unit: bracket([c1], [c2, leaf(end)], id()), endpoint: end, claimer: null };
    }
    const extras = Array.from({ length: lengthOf(p) - 1 }, () => leaf(mint()));
    const end = mint();
    const bid = id();
    return { unit: bracket(extras, [leaf(end)], bid), endpoint: end, claimer: bid };
  }
  if (p === 'A') {
    const end = mint();
    const c2 = leaf(mint());
    const c1 = leaf(mint());
    return { unit: bracket([leaf(end), c2], [c1], id()), endpoint: end, claimer: null };
  }
  const end = mint();
  const extras = Array.from({ length: lengthOf(p) - 1 }, () => leaf(mint()));
  const bid = id();
  return { unit: bracket([leaf(end)], extras, bid), endpoint: end, claimer: bid };
}

describe('property: §4 landing rule 3, every profile pair', () => {
  it.each(PROFILES.flatMap((l) => PROFILES.map((r) => [l, r] as [Profile, Profile])))(
    'W standing %s on the left and %s on the right',
    (leftProfile, rightProfile) => {
      let leafN = 0;
      let idN = 1;
      const mint = (): string => `n${leafN++}`;
      const id = (): number => idN++;
      const left = buildPiece(leftProfile, 'left', mint, id);
      const right = buildPiece(rightProfile, 'right', mint, id);
      const wId = id();
      const f = buildForest(
        [{
          kind: 'bracket', id: wId, rel: 'Alt', star: null,
          leftHanging: false, rightHanging: false,
          left: [left.unit], right: [right.unit],
        }],
        idN,
      );
      const order = leafOrder(f);
      freeze(f);
      assertInvariants(f, order);

      // §4 rule 3 at v4.1, re-derived from §10 A8's text rather than from the
      // code: the join lands in the NEAREST room on either fringe — the LEFT
      // endpoint's own room first — and W NEVER gives way, because after step
      // 1 every endpoint under W stands in some room. For an 'A' profile that
      // room lies one level deep inside the member (the piece's own bracket);
      // for R2/R3 the claimer's spill made W's own side the room.
      const expectedParent =
        leftProfile === 'A'
          ? { bracketId: (left.unit as { id: number }).id, side: 'right' as const }
          : { bracketId: wId, side: 'left' as const };

      const a: UnitAddr = { kind: 'leaf', pid: left.endpoint };
      const b: UnitAddr = { kind: 'leaf', pid: right.endpoint };
      const preview = previewConnect(f, a, b);
      const r = ok(connectDetail(f, a, b));
      expect(ok(preview).broken).toEqual(r.broken);
      assertInvariants(r.state, order);

      const claimers = [left.claimer, right.claimer].filter((c): c is number => c !== null);
      expect(r.detail.claimers).toEqual(claimers);
      expect(r.detail.crossed).toBeNull(); // A8: the crossed bracket always stands
      expect(r.broken).toEqual(claimers);
      expect(parentOf(r.state, { kind: 'bracket', id: r.newBracketId })).toEqual(expectedParent);
    },
  );
});
