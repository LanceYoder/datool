/**
 * Unit tables for the pure core, at v4 (spec §10): every §5.1 connect path,
 * §5.3 delete, §10 A2's settle, §5.4 split, §5.5 merge, §5.6 attribute edits,
 * the refusals, and the invariants themselves. Expected states are written in
 * the spec's notation (`formatForest`) so a failure reads against §6 and §10
 * directly — and ⟨x⟩, the ONE-LODGER ROOM, is all over them, because §10 A1
 * is exactly the ruling that nothing settles itself.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { Forest } from '../core';
import {
  assertInvariants,
  bracketById,
  buildForest,
  clearTree,
  connect,
  connectDetail,
  deleteAt,
  deleteBracket,
  flipStar,
  formatForest,
  leafOrder,
  leavesOf,
  leaf,
  loadForest,
  mergeLeaves,
  parentOf,
  previewConnect,
  reversedOf,
  setRelationship,
  settleSide,
  settleTargetFor,
  spanOf,
  splitLeaf,
} from '../core';
import { B, L, Ls, P, br, bracketOver, forestOf, freeze, idOver, resetIds } from './mk';

const SER = { coordinate: true };
const FTIN = { coordinate: false, starredLabel: 1 };
const GRND = { coordinate: false, starredLabel: 0 };

beforeEach(() => resetIds());

/** Every op must leave a legal forest over the same leaves. */
function legal(before: Forest, after: Forest): void {
  assertInvariants(after, leafOrder(before));
}

function ok<T extends { state: Forest }>(r: { ok: true } & T | { ok: false; refusal: unknown }): T {
  if (!r.ok) throw new Error(`expected success, got refusal ${JSON.stringify(r.refusal)}`);
  return r;
}

// ---------------------------------------------------------------------------
// §5.1 Connect — one row per path

describe('connect: in-room joins cost nothing and settle nothing (§10 A1)', () => {
  it('joins two lodgers of one room and leaves the room shorter', () => {
    const f = forestOf(br('FtIn', L('41d'), Ls('42a', '42b', '42c', '42d'), 'right'));
    const r = ok(connect(f, P('42c'), P('42d')));
    expect(formatForest(r.state)).toBe('[FtIn[41d, ⟨42a 42b Ser[42c, 42d]⟩]]');
    expect(r.broken).toEqual([]);
    legal(f, r.state);
  });

  it('A1, THE test case: the last two lodgers join and the side STILL HANGS', () => {
    // The analyst's own scenario, verbatim: with FtIn[⟨42c 42d⟩, 42e] hanging,
    // connect 42c·42d → FtIn[⟨Ser[42c,42d]⟩, 42e]. It never "automatically
    // connects"; the pickup dot is what finishes it (A2, below).
    const f = forestOf(br('FtIn', Ls('42c', '42d'), L('42e'), 'right'));
    const r = ok(connect(f, P('42c'), P('42d')));
    expect(formatForest(r.state)).toBe('[FtIn[⟨Ser[42c, 42d]⟩, 42e]]');
    expect(bracketOver(r.state, ['42c', '42d', '42e']).leftHanging).toBe(true);
    expect(r.broken).toEqual([]);
    legal(f, r.state);
  });

  it('mints a SER, never an unlabeled bracket (§10 A5 reverses Q6)', () => {
    const f = forestOf(L('a'), L('b'));
    const r = ok(connect(f, P('a'), P('b')));
    const n = bracketById(r.state, r.newBracketId);
    expect(n?.rel).toBe('Ser');
    expect(n?.star).toBeNull(); // Ser is coordinate: I7 holds from the mint
    expect(n?.leftHanging).toBe(false);
    expect(n?.rightHanging).toBe(false);
    expect(r.newBracketId).toBe(f.nextId);
    expect(r.state.nextId).toBe(f.nextId + 1);
  });
});

describe('connect: landing rule 1 — the floor (§4)', () => {
  it('brackets two adjacent roots and breaks nothing', () => {
    const f = forestOf(br('Ser', L('a'), L('b')), L('c'));
    const r = ok(connect(f, B(idOver(f, ['a', 'b'])), P('c')));
    expect(formatForest(r.state)).toBe('[Ser[Ser[a, b], c]]');
    expect(r.broken).toEqual([]);
  });

  it('lands at the floor when the endpoint came out of a room deep inside', () => {
    // Row 4: Ft as a forest root — 42d releases, 42e is free, ZERO breaks.
    const f = forestOf(
      br('Ser', L('41a'), L('41b')),
      br('FtIn', L('41d'), Ls('42a', '42b', '42c', '42d'), 'right'),
      L('42e'),
    );
    const r = ok(connect(f, P('42d'), P('42e')));
    expect(formatForest(r.state)).toBe(
      '[Ser[41a, 41b], FtIn[41d, ⟨42a 42b 42c⟩], Ser[42d, 42e]]',
    );
    expect(r.broken).toEqual([]);
    legal(f, r.state);
  });
});

describe('connect: step 1 breaks the claimer (§5.1, Q1/Q3)', () => {
  it('breaks the one bracket that claims a committed endpoint', () => {
    // packetDoc, row 7: p4 committed in CndE; p5 a free root.
    const f = forestOf(
      br('Ser', L('p1'), br('FtIn', L('p2'), br('CndE', L('p3'), L('p4'), 'right'), 'right')),
      L('p5'),
    );
    const cnd = idOver(f, ['p3', 'p4']);
    const r = ok(connectDetail(f, P('p4'), P('p5')));
    // The CndE's spill leaves ⟨p3 p4⟩ in the FtIn's right side; p4 then leaves
    // for N and the room stays a room with ONE lodger (§10 A1). v3 anchored it
    // here — that is the auto-completion the analyst overruled.
    expect(formatForest(r.state)).toBe('[Ser[p1, FtIn[p2, ⟨p3⟩]], Ser[p4, p5]]');
    expect(r.broken).toEqual([cnd]);
    expect(r.detail).toMatchObject({ claimers: [cnd], crossed: null, emptied: [] });
    legal(f, r.state);
  });

  it('breaks BOTH claimers when each endpoint is committed elsewhere (Q3)', () => {
    const f = forestOf(br('Ser', L('a'), L('u')), br('Ser', L('v'), L('b')));
    const left = idOver(f, ['a', 'u']);
    const right = idOver(f, ['v', 'b']);
    const r = ok(connect(f, P('u'), P('v')));
    expect(formatForest(r.state)).toBe('[a, Ser[u, v], b]');
    expect(r.broken).toEqual([left, right]);
    legal(f, r.state);
  });

  it('has no inward exception: a committed unit of the very bracket breaks it (row 23)', () => {
    const f = forestOf(L('z'), br('FtIn', L('a'), Ls('b', 'c'), 'left'));
    const ft = idOver(f, ['a', 'b', 'c']);
    const r = ok(connect(f, P('a'), P('b')));
    expect(formatForest(r.state)).toBe('[z, Ser[a, b], c]');
    expect(r.broken).toEqual([ft]);
    legal(f, r.state);
  });

  it('spills the claimer into the side that held it, which thereby hangs', () => {
    const f = forestOf(br('Ser', L('x'), br('CE', L('y'), L('u'), 'right')), L('v'));
    const ce = idOver(f, ['y', 'u']);
    const r = ok(connect(f, P('u'), P('v')));
    // The Ser's right side took the spill (⟨y u⟩), u then left for N at the
    // floor, and what it left behind is still a room (§10 A1).
    expect(formatForest(r.state)).toBe('[Ser[x, ⟨y⟩], Ser[u, v]]');
    expect(r.broken).toEqual([ce]);
  });

  it('breaks NESTED claimers, outer first, and the inner spill lands inside it', () => {
    // The two claimers are not siblings: O strictly contains I. Both give way
    // (Q3 says nothing about their relationship, only that both break), and the
    // §5.1 loop takes them in the endpoints' reading order — so the OUTER one
    // spills first and the inner one then spills into the room that made.
    const f = forestOf(
      br('Top', L('z'), br('O', L('u'), br('I', L('v'), L('b'), 'right'), 'right'), 'right'),
    );
    const inner = idOver(f, ['v', 'b']);
    const outer = idOver(f, ['u', 'v', 'b']);
    const r = ok(connectDetail(f, P('u'), P('v')));
    expect(r.broken).toEqual([outer, inner]);
    expect(r.detail).toMatchObject({ claimers: [outer, inner], crossed: null, emptied: [] });
    expect(formatForest(r.state)).toBe('[Top[z, ⟨Ser[u, v] b⟩]]');
    legal(f, r.state);
  });
});

describe('connect: the same-bracket re-connection (§5.1 step 1, exception)', () => {
  it('changes nothing structural and keeps the bracket id', () => {
    const f = forestOf(br('MEd', L('42c'), L('42d'), 'right'), L('42e'));
    const med = idOver(f, ['42c', '42d']);
    const r = ok(connect(f, P('42c'), P('42d')));
    expect(r.editedInPlace).toBe(med);
    expect(r.newBracketId).toBe(med);
    expect(r.broken).toEqual([]);
    expect(r.state).toBe(f); // byte-identical: the menu opens, nothing moves
  });

  it('is NOT the exception when one endpoint is a lodger, not a member (row 23)', () => {
    const f = forestOf(br('FtIn', L('a'), Ls('b', 'c'), 'left'));
    const r = ok(connect(f, P('a'), P('b')));
    expect(r.editedInPlace).toBeUndefined();
    expect(r.broken).toHaveLength(1);
  });
});

describe('connect: landing rule 3 — the crossed bracket (§4)', () => {
  it('3a — exactly one side hangs: N lands in it, the boundary slides', () => {
    const f = forestOf(br('R', Ls('a', 'u'), br('S', Ls('v', 'c'), L('d'), 'left'), 'left'));
    const r = ok(connectDetail(f, P('u'), P('v')));
    expect(formatForest(r.state)).toBe('[R[⟨a Ser[u, v]⟩, S[⟨c⟩, d]]]');
    expect(r.broken).toEqual([]);
    expect(r.detail.crossed).toBeNull();
    legal(f, r.state);
  });

  it('A8 — the left endpoint\'s OWN room outranks the crossed bracket\'s room', () => {
    // u waits one level deep inside S; v waits in R's own right room. The
    // nearest room on the join's left fringe is u's — so the join lands
    // there, S grows over v, and R's boundary slides (§10 A8).
    const f = forestOf(br('R', br('S', L('a'), Ls('b', 'u'), 'left'), Ls('v', 'c'), 'left'));
    const r = ok(connect(f, P('u'), P('v')));
    expect(formatForest(r.state)).toBe('[R[S[a, ⟨b Ser[u, v]⟩], ⟨c⟩]]');
    expect(r.broken).toEqual([]);
  });

  it('3b — both sides hang: the LEFT one takes the join (the v3 tiebreak is gone)', () => {
    // §10 A1 removed the count v3's tiebreak was made of: nothing anchors, so
    // there is no "which side would be left with exactly one" to prefer. Left.
    const f = forestOf(
      br(
        'Alt',
        [L('a'), L('b'), br('FtIn', br('In', L('i1'), L('i2'), 'right'), L('u'), 'right')],
        br('Q', L('v'), L('w'), 'right'),
      ),
    );
    const pkt = idOver(f, ['i1', 'i2', 'u']);
    const q = idOver(f, ['v', 'w']);
    const r = ok(connectDetail(f, P('u'), P('v')));
    expect(formatForest(r.state)).toBe('[Alt[⟨a b In[i1, i2] Ser[u, v]⟩, ⟨w⟩]]');
    expect(r.broken).toEqual([pkt, q]);
    expect(r.detail.crossed).toBeNull(); // the Alt SURVIVES
    legal(f, r.state);
  });

  it('3b — two rooms and neither empties: the Alt stands, hanging at both ends', () => {
    // v3 called this a "two-room shell" and brought the Alt down. §10 A4 says
    // both-ends-hanging is a legal WORKING STATE: nothing gives way at all.
    const f = forestOf(
      br(
        'Alt',
        [L('a'), L('b'), br('FtIn', br('In', L('i1'), L('i2'), 'right'), L('u'), 'right')],
        br('Q', L('v'), [L('w'), L('x')], 'left'),
      ),
    );
    const pkt = idOver(f, ['i1', 'i2', 'u']);
    const q = idOver(f, ['v', 'w', 'x']);
    const r = ok(connectDetail(f, P('u'), P('v')));
    expect(formatForest(r.state)).toBe('[Alt[⟨a b In[i1, i2] Ser[u, v]⟩, ⟨w x⟩]]');
    expect(r.broken).toEqual([pkt, q]);
    expect(r.detail.crossed).toBeNull();
    legal(f, r.state);
  });

  it('A8 — L1: the crossed bracket STANDS, its boundary slides into the deep room', () => {
    // v3 refused this shape; v4 broke R; §10 A8 finally does what the analyst
    // means: z's own room (inside S) takes the join, u releases from T's room,
    // and R's internal boundary slides past u. NOTHING breaks.
    const f = forestOf(
      br('R', br('S', L('x'), Ls('y', 'z'), 'left'), br('T', Ls('u', 'v'), L('t'), 'left'), 'left'),
    );
    const r = ok(connectDetail(f, P('z'), P('u')));
    expect(formatForest(r.state)).toBe('[R[S[x, ⟨y Ser[z, u]⟩], T[⟨v⟩, t]]]');
    expect(r.broken).toEqual([]);
    expect(r.detail.crossed).toBeNull();
    legal(f, r.state);
  });

  it('A8 — deep inside a hanging grandparent, still nothing gives way', () => {
    // v3's 3c broke W here and v4 kept that; §10 A8 lands the join in z's own
    // room instead. W stands, G stands with its one room, zero breakage.
    const f = forestOf(
      br(
        'G',
        Ls('p', 'q'),
        br('W', br('S', L('x'), Ls('y', 'z'), 'left'), br('T', Ls('u', 'v'), L('t'), 'left'), 'left'),
        'left',
      ),
    );
    const r = ok(connectDetail(f, P('z'), P('u')));
    expect(r.detail).toMatchObject({ claimers: [], crossed: null, emptied: [] });
    expect(r.broken).toEqual([]);
    expect(formatForest(r.state)).toBe(
      '[G[⟨p q⟩, W[S[x, ⟨y Ser[z, u]⟩], T[⟨v⟩, t]]]]',
    );
    legal(f, r.state);
  });

  it('A8 — the boundary slide is real: the landing side\'s bracket absorbs the far leaf', () => {
    // The crossed bracket survives (crossed === null), and the evidence of the
    // slide is in the spans: S — the bracket over the landing room — now
    // reaches past R's old internal boundary to include u.
    const f = forestOf(
      br('R', br('S', L('x'), Ls('y', 'z'), 'left'), br('T', Ls('u', 'v'), L('t'), 'left'), 'left'),
    );
    const sid = idOver(f, ['x', 'y', 'z']);
    const r = ok(connectDetail(f, P('z'), P('u')));
    expect(r.detail.crossed).toBeNull();
    const s = bracketById(r.state, sid);
    if (s === null) throw new Error('S should have survived the slide');
    expect([...s.left.flatMap(leavesOf), ...s.right.flatMap(leavesOf)]).toContain('u');
  });
});

describe('connect: NOTHING CASCADES (§10 A4)', () => {
  it('leaves the Alt standing with both sides hanging', () => {
    const f = forestOf(
      br(
        'Alt',
        [L('a'), br('FtIn', L('i1'), L('u'), 'right')],
        br('Q', L('v'), L('w'), 'right'),
      ),
    );
    const r = ok(connectDetail(f, P('u'), P('v')));
    expect(formatForest(r.state)).toBe('[Alt[⟨a i1 Ser[u, v]⟩, ⟨w⟩]]');
    expect(r.detail.emptied).toEqual([]);
  });

  it('takes the ONE claimer and leaves everything the spills hung alone', () => {
    // v3 read this state as two shells and brought A and W down after the
    // claimer. Under §10 A4 the join takes B — the bracket that claimed u —
    // and nothing else: A hangs at both ends, W hangs on the right, and both
    // stand, waiting for the analyst.
    const f = forestOf(
      br(
        'W',
        br('A', Ls('x', 'y'), br('B', Ls('z1', 'z2'), L('u'), 'right'), 'left'),
        Ls('v', 'c'),
        'left',
      ),
    );
    const b = idOver(f, ['z1', 'z2', 'u']);
    const r = ok(connectDetail(f, P('u'), P('v')));
    expect(r.broken).toEqual([b]);
    expect(r.detail).toMatchObject({ claimers: [b], crossed: null, emptied: [] });
    // The claimer's spill left u a lodger of A's right room, and §10 A8 lands
    // the join in THAT room (the left endpoint's own), v releasing from W's.
    expect(formatForest(r.state)).toBe('[W[A[⟨x y⟩, ⟨z1 z2 Ser[u, v]⟩], ⟨c⟩]]');
    legal(f, r.state);
  });
});

describe('connect: ROOMS NEVER EMPTY (§10 A3)', () => {
  it('grows the room over what the join brought in, rather than hollowing it', () => {
    // The spec's own A3 example: FtIn[⟨Ser'⟩, 42e] hanging, and the sole lodger
    // reaches OUT of the room for 42b. The join lands INSIDE the room, whose
    // extent grows leftwards over 42b; the side is still hanging afterwards.
    const f = forestOf(
      L('42b'),
      br('FtIn', [br('Ser', L('42c'), L('42d'))], L('42e'), 'right'),
    );
    const ser = idOver(f, ['42c', '42d']);
    const r = ok(connectDetail(f, P('42b'), B(ser)));
    expect(formatForest(r.state)).toBe('[FtIn[⟨Ser[42b, Ser[42c, 42d]]⟩, 42e]]');
    expect(r.broken).toEqual([]);
    legal(f, r.state);
  });

  it('does NOT break the bracket a sole lodger lodges in: a lodger is no member', () => {
    const f = forestOf(L('z'), br('FtIn', [L('a')], L('b'), 'right'));
    const r = ok(connectDetail(f, P('z'), P('a')));
    expect(formatForest(r.state)).toBe('[FtIn[⟨Ser[z, a]⟩, b]]');
    expect(r.detail.claimers).toEqual([]);
  });

  it('prefers the LEFT room when the join would empty two of them', () => {
    // The one doubly-degenerate landing: each endpoint is its own room's only
    // lodger, so whichever room takes the join, the other is left with nothing
    // and its bracket has nothing to relate. I2 — not a cascade — closes it.
    const f = forestOf(br('R', [L('a')], [L('b')]));
    const rid = idOver(f, ['a', 'b']);
    const r = ok(connectDetail(f, P('a'), P('b')));
    expect(formatForest(r.state)).toBe('[Ser[a, b]]');
    expect(r.detail).toMatchObject({ claimers: [], crossed: null, emptied: [rid] });
    // The bracket that gave way is REPORTED, not silent: `broken` is what the
    // endangered wash showed while the analyst was aiming (§5.2).
    expect(r.broken).toEqual([rid]);
    legal(f, r.state);
  });

  it('and across TWO brackets: the left room takes the join, the right gives way', () => {
    // The same doubly-degenerate landing with the two rooms in different
    // brackets — the shape A3's "with two such rooms, the left" is really
    // about. R1 grows; R2, left with nothing to relate, gives way (I2).
    const f = forestOf(br('R1', L('x'), [L('u')], 'right'), br('R2', [L('v')], L('y'), 'right'));
    const r1 = idOver(f, ['x', 'u']);
    const r2 = idOver(f, ['v', 'y']);
    const r = ok(connectDetail(f, P('u'), P('v')));
    expect(formatForest(r.state)).toBe('[R1[x, ⟨Ser[u, v]⟩], y]');
    expect(r.detail).toMatchObject({ claimers: [], crossed: null, emptied: [r2] });
    expect(bracketById(r.state, r1)).not.toBeNull();
    legal(f, r.state);
  });
});

describe('connect: refusals are geometric only (§5.1)', () => {
  const f = () => forestOf(br('FtIn', L('a'), br('Ser', L('b'), L('c')), 'right'), L('d'), L('e'));

  it('refuses self-connect and changes nothing', () => {
    const before = f();
    const r = connect(before, P('a'), P('a'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal.code).toBe('self');
  });

  it('refuses containment', () => {
    const before = f();
    const r = connect(before, B(idOver(before, ['b', 'c'])), P('b'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal.code).toBe('containment');
  });

  it('refuses non-adjacent units', () => {
    const before = f();
    const r = connect(before, P('a'), P('d'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal.code).toBe('not-adjacent');
  });

  it('refuses an address that names nothing', () => {
    const before = f();
    expect(connect(before, P('nope'), P('d')).ok).toBe(false);
    const r = connect(before, B(999), P('d'));
    if (!r.ok) expect(r.refusal.code).toBe('not-found');
  });

  it('leaves the state byte-identical on every refusal (§5, §8.3)', () => {
    // DEEP-FROZEN, and compared against its own snapshot rather than against a
    // freshly built forest: a refusal must change nothing, and the frozen input
    // makes an in-place write a TypeError at the write site rather than a
    // difference some later assertion might or might not notice.
    const before = freeze(f());
    const snapshot = formatForest(before);
    for (const [x, y] of [
      [P('a'), P('a')],
      [P('a'), P('d')],
      [P('nope'), P('d')],
      [B(idOver(before, ['b', 'c'])), P('b')],
    ] as const) {
      const r = connect(before, x, y);
      expect(r.ok).toBe(false);
      expect(formatForest(before)).toBe(snapshot);
    }
  });

  it('mutates nothing on the SUCCESS path either: the input stays frozen', () => {
    const before = freeze(f());
    const snapshot = formatForest(before);
    const r = ok(connect(before, P('d'), P('e')));
    expect(formatForest(before)).toBe(snapshot);
    expect(formatForest(r.state)).not.toBe(snapshot);
  });
});

describe('connect: identity and preview (§5.2, §7.1)', () => {
  it('keeps untouched units BY IDENTITY and rebuilds only the path that moved', () => {
    const untouched = br('Ser', L('41a'), L('41b'));
    const room = br('FtIn', L('41d'), Ls('42a', '42b', '42c', '42d'), 'right');
    const f = forestOf(untouched, br('Inf', room, L('42e'), 'right'));
    const r = ok(connect(f, P('42d'), P('42e')));
    expect(r.state.roots[0]).toBe(untouched); // the same object, not a copy
    const contracted = bracketOver(r.state, ['41d', '42a', '42b', '42c']);
    expect(contracted.id).toBe(room.id); // contracted, but the same relationship
    expect(contracted).not.toBe(room);
    expect(contracted.left[0]).toBe(room.left[0]); // 41d never moved
  });

  it('previewConnect returns exactly what connect then does, mutating nothing', () => {
    const f = forestOf(br('Ser', L('a'), L('u')), br('Ser', L('v'), L('b')));
    const snapshot = formatForest(f);
    const p = ok(previewConnect(f, P('u'), P('v')));
    const c = ok(connect(f, P('u'), P('v')));
    expect(p.broken).toEqual(c.broken);
    expect(formatForest(p.state)).toBe(formatForest(c.state));
    expect(formatForest(f)).toBe(snapshot);
  });
});

// ---------------------------------------------------------------------------
// §5.3 Delete

describe('deleteBracket: spill, and NOTHING ELSE (§5.3, §10 A4)', () => {
  it('spills a root bracket onto the floor, in order', () => {
    const f = forestOf(br('Ser', L('a'), br('CE', L('b'), L('c'), 'right')), L('d'));
    const r = ok(deleteBracket(f, idOver(f, ['a', 'b', 'c'])));
    expect(formatForest(r.state)).toBe('[a, CE[b, c], d]');
    legal(f, r.state);
  });

  it('spills into the side that held it, which thereby hangs', () => {
    const f = forestOf(br('Inf', br('Ser', L('a'), L('b')), L('c'), 'right'));
    const r = ok(deleteBracket(f, idOver(f, ['a', 'b'])));
    expect(formatForest(r.state)).toBe('[Inf[⟨a b⟩, c]]');
    legal(f, r.state);
  });

  it('never opens a spilled unit (row 12: the packet stays whole)', () => {
    const packet = br('FtIn', br('In', L('c'), L('d'), 'right'), L('e'), 'right');
    const f = forestOf(br('Alt', br('FtIn', br('Ser', L('a'), L('b')), packet, 'right'), L('f')));
    const inner = ok(deleteBracket(f, idOver(f, ['a', 'b'])));
    const r = ok(deleteBracket(inner.state, idOver(inner.state, ['a', 'b', 'c', 'd', 'e'])));
    expect(formatForest(r.state)).toBe('[Alt[⟨a b FtIn[In[c, d], e]⟩, f]]');
    expect(bracketOver(r.state, ['c', 'd', 'e'])).toBe(packet); // whole, BY IDENTITY
  });

  it('leaves a bracket hanging at both ends standing (row 8, re-ruled by A4)', () => {
    const f = forestOf(
      br('CndE', br('FtIn', L('p1'), br('Adv', L('p2'), L('p3'), 'left'), 'right'), br('Ser', L('p4'), L('p5')), 'right'),
    );
    const step1 = ok(deleteBracket(f, idOver(f, ['p1', 'p2', 'p3'])));
    expect(formatForest(step1.state)).toBe('[CndE[⟨p1 Adv[p2, p3]⟩, Ser[p4, p5]]]');
    const step2 = ok(deleteBracket(step1.state, idOver(step1.state, ['p4', 'p5'])));
    // v3's cascade took the CndE here. It stands now: the analyst deleted one
    // relationship and exactly one relationship went.
    expect(formatForest(step2.state)).toBe('[CndE[⟨p1 Adv[p2, p3]⟩, ⟨p4 p5⟩]]');
    legal(f, step2.state);
  });

  it('refuses an unknown id, and a root leaf has no relationship to delete', () => {
    const f = forestOf(br('Ser', L('a'), L('b')), L('c'));
    const missing = deleteBracket(f, 999);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.refusal.code).toBe('not-found');
    const rootLeaf = deleteAt(f, P('c'));
    expect(rootLeaf.ok).toBe(false);
    if (!rootLeaf.ok) expect(rootLeaf.refusal.code).toBe('root-delete');
    const byLeafDot = ok(deleteAt(f, P('a')));
    expect(formatForest(byLeafDot.state)).toBe('[a, b, c]');
  });
});

// ---------------------------------------------------------------------------
// §10 A2 Settle — the pickup dot's own gesture

describe('settleSide: the ONE way a side stops hanging (§10 A2)', () => {
  it('settles a one-lodger room and the bracket is whole', () => {
    const f = forestOf(br('FtIn', [br('Ser', L('42c'), L('42d'))], L('42e'), 'right'));
    const ft = idOver(f, ['42c', '42d', '42e']);
    const r = ok(settleSide(f, ft, 'left'));
    expect(formatForest(r.state)).toBe('[FtIn[Ser[42c, 42d], 42e]]');
    expect(bracketById(r.state, ft)?.leftHanging).toBe(false);
    legal(f, r.state);
  });

  it('refuses while the room still holds a group to assemble', () => {
    const f = forestOf(br('FtIn', Ls('42c', '42d'), L('42e'), 'right'));
    const r = settleSide(f, idOver(f, ['42c', '42d', '42e']), 'left');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal.code).toBe('not-settleable');
  });

  it('refuses a side that is not hanging, and a bracket that is not there', () => {
    const f = forestOf(br('FtIn', [L('a')], L('b'), 'right'));
    const id = idOver(f, ['a', 'b']);
    const settled = settleSide(f, id, 'right');
    expect(settled.ok).toBe(false);
    if (!settled.ok) expect(settled.refusal.code).toBe('not-settleable');
    expect(settleSide(f, 999, 'left').ok).toBe(false);
  });

  it('needs the side named when the bracket hangs at both ends', () => {
    const f = forestOf(br('R', [L('a')], [L('b')]));
    const id = idOver(f, ['a', 'b']);
    const ambiguous = settleSide(f, id);
    expect(ambiguous.ok).toBe(false);
    if (!ambiguous.ok) expect(ambiguous.refusal.code).toBe('not-settleable');
    // Named, each side settles on its own — and one at a time, which is the
    // point: the analyst finishes what they say they have finished.
    const left = ok(settleSide(f, id, 'left'));
    expect(formatForest(left.state)).toBe('[R[a, ⟨b⟩]]');
    expect(formatForest(ok(settleSide(left.state, id, 'right')).state)).toBe('[R[a, b]]');
  });

  it('takes the only hanging side without being told', () => {
    const f = forestOf(br('FtIn', [L('a')], L('b'), 'right'));
    expect(formatForest(ok(settleSide(f, idOver(f, ['a', 'b']))).state)).toBe('[FtIn[a, b]]');
  });

  it('settleTargetFor names the sole lodger the pickup dot must be paired with', () => {
    const f = forestOf(br('FtIn', [br('Ser', L('a'), L('b'))], L('c'), 'right'));
    const ft = idOver(f, ['a', 'b', 'c']);
    expect(settleTargetFor(f, ft, 'left')).toBe(bracketOver(f, ['a', 'b']));
    expect(settleTargetFor(f, ft, 'right')).toBeNull();
    const crowded = forestOf(br('FtIn', Ls('a', 'b'), L('c'), 'right'));
    expect(settleTargetFor(crowded, idOver(crowded, ['a', 'b', 'c']), 'left')).toBeNull();
  });

  it('round-trips: settle, undo by re-hanging nothing — the state is the state', () => {
    // A settle is a pure attribute edit: the units are the same objects, and
    // only the flag moved. That is what makes it one clean undo step upstream.
    const inner = br('Ser', L('a'), L('b'));
    const f = forestOf(br('FtIn', [inner], L('c'), 'right'));
    const id = idOver(f, ['a', 'b', 'c']);
    const settled = ok(settleSide(f, id, 'left')).state;
    expect(bracketOver(settled, ['a', 'b'])).toBe(inner);
    expect(leafOrder(settled)).toEqual(leafOrder(f));
  });
});

// ---------------------------------------------------------------------------
// §5.4 Split

describe('splitLeaf: structure preserved up to I3 (§5.4, Q4)', () => {
  it('stands w1 and w2 side by side where a free root stood', () => {
    const f = forestOf(br('Ser', L('a'), L('b')), L('w'));
    const r = ok(splitLeaf(f, 'w', 'w2'));
    expect(formatForest(r.state)).toBe('[Ser[a, b], w, w2]');
    expect(leafOrder(r.state)).toEqual(['a', 'b', 'w', 'w2']);
  });

  it('lengthens the room when the leaf was a lodger', () => {
    const f = forestOf(br('FtIn', L('a'), Ls('b', 'w'), 'left'));
    const r = ok(splitLeaf(f, 'w', 'w2'));
    expect(formatForest(r.state)).toBe('[FtIn[a, ⟨b w w2⟩]]');
  });

  it('hangs the side of a committed leaf, awaiting reassembly (Q4)', () => {
    const f = forestOf(br('FtIn', L('a'), L('w'), 'right'));
    const r = ok(splitLeaf(f, 'w', 'w2'));
    expect(formatForest(r.state)).toBe('[FtIn[a, ⟨w w2⟩]]');
  });

  it('hangs the bracket at BOTH ends rather than bringing it down (row 21, A4)', () => {
    const f = forestOf(br('R', Ls('a', 'b'), L('w'), 'right'));
    const r = ok(splitLeaf(f, 'w', 'w2'));
    expect(formatForest(r.state)).toBe('[R[⟨a b⟩, ⟨w w2⟩]]');
  });

  it('refuses a leaf that is not there', () => {
    const f = forestOf(L('a'));
    const r = splitLeaf(f, 'zz', 'zz2');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal.code).toBe('not-found');
  });
});

// ---------------------------------------------------------------------------
// §5.5 Merge

describe('mergeLeaves: innermost-outward, minimal removal (§5.5)', () => {
  it('gives way inside, releases outside (the pinned row 22 case)', () => {
    const f = forestOf(br('R', L('y'), br('S', L('x'), L('w1'), 'right'), 'right'), L('w2'));
    const r = ok(mergeLeaves(f, 'w1'));
    expect(formatForest(r.state)).toBe('[R[y, ⟨x⟩], w1]');
    expect(leafOrder(r.state)).toEqual(['y', 'x', 'w1']);
    legal(forestOf(L('y'), L('x'), L('w1')), r.state);
  });

  it('NEVER promotes silently: fusion down to one lodger leaves a room (A1)', () => {
    const f = forestOf(br('R', Ls('w1', 'w2'), L('c'), 'right'));
    const r = ok(mergeLeaves(f, 'w1'));
    expect(formatForest(r.state)).toBe('[R[⟨w1⟩, c]]'); // still a room, still waiting
  });

  it('nor when the RELEASE leaves one lodger behind (A1)', () => {
    const f = forestOf(br('R', L('a'), Ls('b', 'w1'), 'left'), L('w2'));
    const r = ok(mergeLeaves(f, 'w1'));
    expect(formatForest(r.state)).toBe('[R[a, ⟨b⟩], w1]');
  });

  it('NEVER annihilates a one-lodger room: it absorbs the fusion (A1, A3)', () => {
    // §10 A1 names merges: "a hanging side stays hanging — through in-room
    // joins, releases, spills, MERGES". The room's extent simply grows over the
    // partner's words, as A3's elastic room grows over what a join brought in.
    const f = forestOf(br('FtIn', L('x'), [L('w1')], 'right'), L('w2'));
    const ft = idOver(f, ['x', 'w1']);
    const r = ok(mergeLeaves(f, 'w1'));
    expect(formatForest(r.state)).toBe('[FtIn[x, ⟨w1⟩]]');
    expect(bracketById(r.state, ft)).not.toBeNull();
    legal(forestOf(L('x'), L('w1')), r.state);
  });

  it('and grows OUTWARD when the room holds the SECOND leaf alone', () => {
    // The mirror: the fused leaf keeps w1's pid (§7.10) and w1 stands OUTSIDE,
    // so the room takes it in rather than being emptied by w2's departure —
    // A3's own example grows ⟨Ser'⟩ leftwards over 42b in just this way.
    const f = forestOf(L('w1'), br('R', [L('w2')], L('a'), 'right'));
    const r = ok(mergeLeaves(f, 'w1'));
    expect(formatForest(r.state)).toBe('[R[⟨w1⟩, a]]');
    legal(forestOf(L('w1'), L('a')), r.state);
  });

  it('prefers the LEFT room when the fusion would empty two of them', () => {
    // A3's tiebreak, on a merge: the left room keeps its lodger (the fused leaf
    // is w1's own object) and the right room, left with nothing, has nothing to
    // relate — I2 closes it exactly as on the doubly-degenerate join.
    const f = forestOf(br('R1', L('x'), [L('w1')], 'right'), br('R2', [L('w2')], L('y'), 'right'));
    const r = ok(mergeLeaves(f, 'w1'));
    expect(formatForest(r.state)).toBe('[R1[x, ⟨w1⟩], y]');
    legal(forestOf(L('x'), L('w1'), L('y')), r.state);
  });

  it('gives way when a bracket boundary separates the pair', () => {
    const f = forestOf(br('CE', L('w1'), L('w2'), 'right'));
    const r = ok(mergeLeaves(f, 'w1'));
    expect(formatForest(r.state)).toBe('[w1]');
  });

  it('leaves brackets that hold the whole pair alone (the inner one gives way)', () => {
    const f = forestOf(br('R', L('a'), br('S', L('w1'), L('w2'), 'right'), 'right'));
    const r = ok(mergeLeaves(f, 'w1'));
    expect(formatForest(r.state)).toBe('[R[a, ⟨w1⟩]]');
  });

  it('fuses across two ROOTS, each half committed in its own bracket', () => {
    // No common bracket at all, so there is no LCA boundary to adjudicate:
    // each half's own claimer gives way independently (§5.5, innermost-outward)
    // and the fused leaf ends up on the floor between the survivors' units.
    const f = forestOf(br('A', L('a'), L('w1'), 'right'), br('B', L('w2'), L('b'), 'left'));
    const r = ok(mergeLeaves(f, 'w1'));
    expect(formatForest(r.state)).toBe('[a, w1, b]');
    expect(leafOrder(r.state)).toEqual(['a', 'w1', 'b']);
  });

  it('kills the intervening brackets first, THEN finds the LCA boundary between the pair', () => {
    // Innermost-outward, re-classifying after each step: M and N give way (each
    // claims one half), which drops both halves directly into L's two sides —
    // and only NOW does L's own boundary separate them, so L gives way too. Had
    // the boundary been judged before the climbs, L would have been spared.
    const f = forestOf(
      br(
        'Top',
        L('z'),
        br('L', br('M', L('a'), L('w1'), 'right'), br('N', L('w2'), L('b'), 'left'), 'left'),
        'left',
      ),
    );
    const r = ok(mergeLeaves(f, 'w1'));
    expect(formatForest(r.state)).toBe('[Top[z, ⟨a w1 b⟩]]');
    expect(leafOrder(r.state)).toEqual(['z', 'a', 'w1', 'b']);
  });

  it('refuses when the leaf is missing or nothing follows it', () => {
    const f = forestOf(L('a'), L('b'));
    expect(mergeLeaves(f, 'zz').ok).toBe(false);
    const last = mergeLeaves(f, 'b');
    expect(last.ok).toBe(false);
    if (!last.ok) expect(last.refusal.code).toBe('not-found');
  });
});

// ---------------------------------------------------------------------------
// §5.6 Attributes, clear

describe('attribute edits keep I7 and derive reversed (§5.6, row 25)', () => {
  it('drops the star for a coordinate relationship', () => {
    const f = forestOf(br('FtIn', L('a'), L('b'), 'right'));
    const id = idOver(f, ['a', 'b']);
    const r = ok(setRelationship(f, id, 'Ser', SER));
    const b = bracketById(r.state, id);
    expect(b?.rel).toBe('Ser');
    expect(b?.star).toBeNull();
    expect(reversedOf(r.state, id, SER)).toBe(false);
  });

  it('keeps an existing star across a subordinate relabel', () => {
    const f = forestOf(br('FtIn', L('a'), L('b'), 'left'));
    const id = idOver(f, ['a', 'b']);
    const r = ok(setRelationship(f, id, 'Grnd', GRND));
    expect(bracketById(r.state, id)?.star).toBe('left');
    expect(reversedOf(r.state, id, GRND)).toBe(false);
  });

  it('takes the taxonomy default when there is no star yet (new or coordinate)', () => {
    const f = forestOf(br(null, L('a'), L('b')));
    const id = idOver(f, ['a', 'b']);
    const r = ok(setRelationship(f, id, 'FtIn', FTIN));
    expect(bracketById(r.state, id)?.star).toBe('right');
    expect(reversedOf(r.state, id, FTIN)).toBe(false);
  });

  it('flips the star, and the derived reversed follows it', () => {
    const f = forestOf(br('FtIn', L('a'), L('b'), 'right'));
    const id = idOver(f, ['a', 'b']);
    const r = ok(flipStar(f, id, FTIN));
    expect(bracketById(r.state, id)?.star).toBe('left');
    expect(reversedOf(r.state, id, FTIN)).toBe(true);
  });

  it('has no star to flip on a coordinate bracket', () => {
    const f = forestOf(br('Ser', L('a'), L('b')));
    const r = ok(flipStar(f, idOver(f, ['a', 'b']), SER));
    expect(r.state).toBe(f);
  });

  it('refuses attribute edits on an unknown id', () => {
    const f = forestOf(br('Ser', L('a'), L('b')));
    expect(setRelationship(f, 999, 'Ser', SER).ok).toBe(false);
    expect(flipStar(f, 999, SER).ok).toBe(false);
  });

  it('touches nothing but the named bracket', () => {
    const kept = br('Ser', L('a'), L('b'));
    const f = forestOf(kept, br('FtIn', L('c'), L('d'), 'right'));
    const r = ok(setRelationship(f, idOver(f, ['c', 'd']), 'Grnd', GRND));
    expect(r.state.roots[0]).toBe(kept);
  });
});

describe('the id mint (§7.3): monotonic per session, never reused', () => {
  it('never re-mints an id that a break retired', () => {
    const f = forestOf(br('A', L('a'), br('Bk', L('b'), L('c'))));
    const a = idOver(f, ['a', 'b', 'c']);
    const afterDelete = ok(deleteBracket(f, a)).state;
    expect(afterDelete.nextId).toBe(f.nextId); // a delete retires an id, it does not free it
    const rejoined = ok(connect(afterDelete, P('a'), B(idOver(afterDelete, ['b', 'c']))));
    expect(rejoined.newBracketId).not.toBe(a);
    expect(rejoined.newBracketId).toBe(f.nextId);

    // Which is exactly why `buildForest` demands the mint: `loadForest`'s
    // max-id derivation is valid only for a FRESH load, and on a forest that
    // has already lived it hands back the id the delete retired.
    expect(loadForest(afterDelete.roots).nextId).toBe(a);
    expect(buildForest(afterDelete.roots, afterDelete.nextId).nextId).toBe(f.nextId);
  });
});

describe('clearTree (§5.6)', () => {
  it('leaves every leaf a root, in order, and never reuses an id', () => {
    const f = forestOf(br('Ser', L('a'), br('FtIn', L('b'), Ls('c', 'd'), 'left')));
    const cleared = ok(clearTree(f)).state;
    expect(formatForest(cleared)).toBe('[a, b, c, d]');
    expect(cleared.nextId).toBe(f.nextId);
  });
});

// ---------------------------------------------------------------------------
// Queries and invariants

describe('queries (§7.1)', () => {
  const f = () => forestOf(br('Ser', L('a'), br('FtIn', L('b'), Ls('c', 'd'), 'left')), L('e'));

  it('spans are leaf ordinals, half-open, so meeting spans share a number', () => {
    const forest = f();
    expect(spanOf(forest, P('a'))).toEqual({ start: 0, end: 1 });
    expect(spanOf(forest, B(idOver(forest, ['b', 'c', 'd'])))).toEqual({ start: 1, end: 4 });
    expect(spanOf(forest, P('e'))).toEqual({ start: 4, end: 5 });
  });

  it('parentOf names the bracket and the side, null for a root', () => {
    const forest = f();
    expect(parentOf(forest, P('c'))).toEqual({
      bracketId: idOver(forest, ['b', 'c', 'd']),
      side: 'right',
    });
    expect(parentOf(forest, P('e'))).toBeNull();
    expect(parentOf(forest, B(idOver(forest, ['b', 'c', 'd'])))).toEqual({
      bracketId: idOver(forest, ['a', 'b', 'c', 'd']),
      side: 'right',
    });
  });

  it('leavesOf reads a unit in order; bracketById finds by id', () => {
    const forest = f();
    const id = idOver(forest, ['b', 'c', 'd']);
    expect(leavesOf(bracketById(forest, id) as never)).toEqual(['b', 'c', 'd']);
    expect(bracketById(forest, 999)).toBeNull();
  });
});

describe('assertInvariants catches every representable violation (§2)', () => {
  it('I2: an empty side', () => {
    const bad: Forest = {
      roots: [{
        kind: 'bracket', id: 1, rel: 'Ser', star: null,
        leftHanging: false, rightHanging: false, left: [], right: [L('a')],
      }],
      nextId: 2,
    };
    expect(() => assertInvariants(bad, ['a'])).toThrow(/I2/);
  });

  it('I3 (v4): a side of two units that is not marked hanging', () => {
    // The invariant is HANGING COHERENCE now, not "at most one side hangs":
    // a side holding a group is a room whatever the flag says, and a bracket
    // hanging at BOTH ends is legal (§10 A4) — the row below proves it.
    const room = br('Ser', Ls('a', 'b'), L('c'));
    const bad = forestOf({ ...room, leftHanging: false });
    expect(() => assertInvariants(bad, ['a', 'b', 'c'])).toThrow(/I3/);
  });

  it('I3 (v4): a bracket hanging at both ends is LEGAL', () => {
    const fine = forestOf(br('Ser', Ls('a', 'b'), Ls('c', 'd')));
    expect(() => assertInvariants(fine, ['a', 'b', 'c', 'd'])).not.toThrow();
  });

  it('I5: one unit in two places', () => {
    const shared = leaf('a');
    const bad = forestOf(br('Ser', shared, L('b')), shared);
    expect(() => assertInvariants(bad, ['a', 'b', 'a'])).toThrow(/I5/);
  });

  it('I6: leaf order that does not match the document', () => {
    const bad = forestOf(br('Ser', L('b'), L('a')));
    expect(() => assertInvariants(bad, ['a', 'b'])).toThrow(/I6/);
  });

  it('I7: a star without a relationship', () => {
    const bad = forestOf(br(null, L('a'), L('b'), 'left'));
    expect(() => assertInvariants(bad, ['a', 'b'])).toThrow(/I7/);
  });

  it('the id mint: a bracket at or above nextId', () => {
    const bad: Forest = { roots: [br('Ser', L('a'), L('b'))], nextId: 1 };
    expect(() => assertInvariants(bad, ['a', 'b'])).toThrow(/id mint/);
  });
});
