/**
 * The acceptance catalogue (`docs/tree-engine-acceptance.md`), row by row, on
 * the analyst's own fixtures, AT v4 (spec §10). Row numbers and section letters
 * are the ones in the catalogue; the deciding spec section is cited where the
 * row cites it.
 *
 * What changed from v3, and shows up in nearly every expectation here: nothing
 * auto-completes (A1 — the ⟨x⟩ one-lodger rooms), nothing cascades (A4), a join
 * out of a room GROWS that room rather than hollowing it (A3), and the pickup
 * dot is what finishes a bracket (A2 — `settleSide`).
 *
 * Row 16's random half and row 5's general form live in `property.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import type { Forest, Unit } from '../core';
import {
  assertInvariants,
  bracketById,
  connect,
  connectDetail,
  deleteBracket,
  formatForest,
  formatUnit,
  leafOrder,
  leavesOf,
  mergeLeaves,
  parentOf,
  previewConnect,
  reversedOf,
  setRelationship,
  settleSide,
  splitLeaf,
} from '../core';
import { B, L, Ls, P, br, bracketOver, forestOf, freeze, idOver, resetIds } from './mk';
import type { LoadedFixture } from './wire';
import { forestFromWire, john1146, john11Max, john11Min } from './wire';

const SER = { coordinate: true };
const ALT = { coordinate: true };
const FTIN = { coordinate: false, starredLabel: 1 };
const GRND = { coordinate: false, starredLabel: 0 };
const CE = { coordinate: false, starredLabel: 1 };
const ADV = { coordinate: false, starredLabel: 1 };
const INF = { coordinate: false, starredLabel: 1 };

function ok<T>(r: ({ ok: true } & T) | { ok: false; refusal: { code: string } }): T {
  if (!r.ok) throw new Error(`expected success, got ${r.refusal.code}`);
  return r;
}

function refusal(r: { ok: boolean } | { ok: false; refusal: { code: string } }): string {
  if (r.ok) throw new Error('expected a refusal');
  return (r as { refusal: { code: string } }).refusal.code;
}

/** Connect, then name the new relationship — the menu step of §5.1 step 3. */
function join(
  f: Forest,
  a: Parameters<typeof connect>[1],
  b: Parameters<typeof connect>[2],
  rel: string,
  entry: { coordinate: boolean; starredLabel?: number },
): { state: Forest; broken: number[]; newBracketId: number } {
  const made = ok(connectDetail(f, a, b));
  const named = ok(setRelationship(made.state, made.newBracketId, rel, entry));
  assertInvariants(named.state, leafOrder(f));
  return { state: named.state, broken: made.broken, newBracketId: made.newBracketId };
}

function del(f: Forest, id: number): Forest {
  const r = ok(deleteBracket(f, id));
  assertInvariants(r.state, leafOrder(f));
  return r.state;
}

// ---------------------------------------------------------------------------
// A. hangingFtDoc scenarios (rows 1–6)
//
//   [ Ser[41a, 41b], Inf[ FtIn[41d, ⟨42a 42b 42c 42d⟩], 42e ] ]

function hangingFt(): Forest {
  resetIds();
  return forestOf(
    br('Ser', L('41a'), L('41b')),
    br('Inf', br('FtIn', L('41d'), Ls('42a', '42b', '42c', '42d'), 'right'), L('42e'), 'right'),
  );
}

describe('A. hangingFtDoc', () => {
  it('row 1 — rebuilds the room from inside in three joins, then SETTLES it (E5, A1/A2)', () => {
    let f = hangingFt();
    const inf = bracketOver(f, ['41d', '42a', '42b', '42c', '42d', '42e']);
    const ft = bracketOver(f, ['41d', '42a', '42b', '42c', '42d']);
    const s1 = join(f, P('42c'), P('42d'), 'Ser', SER);
    expect(s1.broken).toEqual([]);
    const s2 = join(s1.state, P('42b'), B(s1.newBracketId), 'CE', CE);
    expect(s2.broken).toEqual([]);
    const s3 = join(s2.state, P('42a'), B(s2.newBracketId), 'Grnd', GRND);
    expect(s3.broken).toEqual([]);
    f = s3.state;
    // §10 A1: the room is down to ONE lodger and is STILL A ROOM. The tree is
    // assembled and the Ft/In is not finished — that is the analyst's call.
    expect(formatForest(f)).toBe(
      '[Ser[41a, 41b], Inf[FtIn[41d, ⟨Grnd[42a, CE[42b, Ser[42c, 42d]]]⟩], 42e]]',
    );
    // §10 A2: the pickup dot finishes it, in one step, with no new bracket.
    f = ok(settleSide(f, ft.id, 'right')).state;
    expect(formatForest(f)).toBe(
      '[Ser[41a, 41b], Inf[FtIn[41d, Grnd[42a, CE[42b, Ser[42c, 42d]]]], 42e]]',
    );
    expect(bracketById(f, inf.id)?.star).toBe('right'); // Inf's star kept
    expect(formatForest(f)).not.toContain('⟨'); // zero rooms
  });

  it('row 2 — reaching out of the room breaks the Inf that claimed 42e (E4)', () => {
    const f = hangingFt();
    const keptSer = f.roots[0];
    const ft = bracketOver(f, ['41d', '42a', '42b', '42c', '42d']);
    const inf = bracketOver(f, ['41d', '42a', '42b', '42c', '42d', '42e']);
    const preview = ok(previewConnect(f, P('42d'), P('42e')));
    expect(preview.broken).toEqual([inf.id]); // the preview highlighted Inf
    const r = join(f, P('42d'), P('42e'), 'Ser', SER);
    expect(formatForest(r.state)).toBe(
      '[Ser[41a, 41b], FtIn[41d, ⟨42a 42b 42c⟩], Ser[42d, 42e]]',
    );
    expect(r.broken).toEqual([inf.id]);
    expect(r.state.roots[0]).toBe(keptSer); // untouched, BY IDENTITY
    const contracted = bracketOver(r.state, ['41d', '42a', '42b', '42c']);
    expect(contracted.id).toBe(ft.id); // the Ft/In survived, contracted
    expect(contracted.left[0]).toBe(ft.left[0]);
  });

  it('row 3 — only the leaver is touched: the in-room Adv survives BY NODE IDENTITY', () => {
    const first = join(hangingFt(), P('42a'), P('42b'), 'Adv', ADV);
    const adv = bracketById(first.state, first.newBracketId) as Unit;
    const inf = bracketOver(first.state, ['41d', '42a', '42b', '42c', '42d', '42e']);
    const r = join(first.state, P('42d'), P('42e'), 'Grnd', GRND);
    expect(formatForest(r.state)).toBe(
      '[Ser[41a, 41b], FtIn[41d, ⟨Adv[42a, 42b] 42c⟩], Grnd[42d, 42e]]',
    );
    expect(r.broken).toEqual([inf.id]);
    expect(bracketOver(r.state, ['42a', '42b'])).toBe(adv);
  });

  it('row 4 — Ft as a forest root: nothing is committed, so ZERO breaks', () => {
    const start = hangingFt();
    const f = del(start, bracketOver(start, ['41d', '42a', '42b', '42c', '42d', '42e']).id);
    expect(formatForest(f)).toBe('[Ser[41a, 41b], FtIn[41d, ⟨42a 42b 42c 42d⟩], 42e]');
    const r = join(f, P('42d'), P('42e'), 'Ser', SER);
    expect(r.broken).toEqual([]);
    expect(formatForest(r.state)).toBe(
      '[Ser[41a, 41b], FtIn[41d, ⟨42a 42b 42c⟩], Ser[42d, 42e]]',
    );
  });

  it('row 5 — the preview IS the gesture: same state, same broken list, no mutation', () => {
    const f = hangingFt();
    const snapshot = formatForest(f);
    const p = ok(previewConnect(f, P('42d'), P('42e')));
    const c = ok(connect(f, P('42d'), P('42e')));
    expect(p.broken).toEqual(c.broken);
    expect(formatForest(p.state)).toBe(formatForest(c.state));
    expect(formatForest(f)).toBe(snapshot);
  });

  it('row 6 — refusals are geometric only, and change nothing', () => {
    const f = hangingFt();
    const snapshot = formatForest(f);
    expect(refusal(connect(f, P('42b'), P('42e')))).toBe('not-adjacent');
    expect(refusal(connect(f, P('41a'), P('42a')))).toBe('not-adjacent');
    const ft = bracketOver(f, ['41d', '42a', '42b', '42c', '42d']);
    expect(refusal(connect(f, B(ft.id), P('42d')))).toBe('containment');
    expect(refusal(connect(f, P('42d'), P('42d')))).toBe('self');
    expect(formatForest(f)).toBe(snapshot);
  });
});

// ---------------------------------------------------------------------------
// B. packetDoc / firstJohn16 (rows 7–9)

const packetDoc = (): Forest => {
  resetIds();
  return forestOf(
    br('Ser', L('p1'), br('FtIn', L('p2'), br('CndE', L('p3'), L('p4'), 'right'), 'right')),
    L('p5'),
  );
};

const firstJohn16 = (): Forest => {
  resetIds();
  return forestOf(
    br(
      'CndE',
      br('FtIn', L('p1'), br('Adv', L('p2'), L('p3'), 'left'), 'right'),
      br('Ser', L('p4'), L('p5')),
      'right',
    ),
  );
};

describe('B. packetDoc / firstJohn16', () => {
  it('row 7 — p4·p5 breaks only the CndE that claimed p4', () => {
    const f = packetDoc();
    const cnd = bracketOver(f, ['p3', 'p4']);
    const r = join(f, P('p4'), P('p5'), 'Grnd', GRND);
    // ⟨p3⟩: the CndE's spill made a room, and p4's departure leaves it a room
    // with one lodger (§10 A1). v3 anchored p3 here, unasked.
    expect(formatForest(r.state)).toBe('[Ser[p1, FtIn[p2, ⟨p3⟩]], Grnd[p4, p5]]');
    expect(r.broken).toEqual([cnd.id]);
  });

  it('row 7 — the packet dot instead: two adjacent roots, zero breaks', () => {
    const f = packetDoc();
    const packet = bracketOver(f, ['p1', 'p2', 'p3', 'p4']);
    const r = join(f, B(packet.id), P('p5'), 'Grnd', GRND);
    expect(formatForest(r.state)).toBe('[Grnd[Ser[p1, FtIn[p2, CndE[p3, p4]]], p5]]');
    expect(r.broken).toEqual([]);
    expect(bracketOver(r.state, ['p1', 'p2', 'p3', 'p4'])).toBe(packet);
  });

  it('row 8 — the CndE hangs at BOTH ends and STANDS (§10 A4: no cascade)', () => {
    const start = firstJohn16();
    const afterFt = del(start, bracketOver(start, ['p1', 'p2', 'p3']).id);
    expect(formatForest(afterFt)).toBe('[CndE[⟨p1 Adv[p2, p3]⟩, Ser[p4, p5]]]');
    const cnd = bracketOver(afterFt, ['p1', 'p2', 'p3', 'p4', 'p5']);
    const afterSer = del(afterFt, bracketOver(afterFt, ['p4', 'p5']).id);
    // Two deletes, two relationships gone — and not one more. The CndE is a
    // working state now, not a shell to bring down.
    expect(formatForest(afterSer)).toBe('[CndE[⟨p1 Adv[p2, p3]⟩, ⟨p4 p5⟩]]');
    expect(bracketById(afterSer, cnd.id)).not.toBeNull();
  });

  it('row 9 — the hanging-end connect: the Ser is committed, so the CndE breaks', () => {
    const start = firstJohn16();
    const f = del(start, bracketOver(start, ['p1', 'p2', 'p3']).id);
    const cnd = bracketOver(f, ['p1', 'p2', 'p3', 'p4', 'p5']);
    const adv = bracketOver(f, ['p2', 'p3']);
    const ser = bracketOver(f, ['p4', 'p5']);
    const r = join(f, B(adv.id), B(ser.id), 'Inf', INF);
    expect(formatForest(r.state)).toBe('[p1, Inf[Adv[p2, p3], Ser[p4, p5]]]');
    expect(r.broken).toEqual([cnd.id]);
  });
});

// ---------------------------------------------------------------------------
// C. The John 11 region, on all three fixtures (rows 10–16)
//
// The region's units are read back by label, so one expectation covers all
// three fixtures; where the fixtures must DIFFER — roots in 46/min, lodgers of
// the enclosing Ser in max — the row says so separately.

const REGION_LABELS = ['41b', '41c', '41d', '41e', '42a', '42b', '42c', '42d', '42e'];

const FIXTURES: [string, () => LoadedFixture][] = [
  ['john11-46', john1146],
  ['john11-firstpass-min', john11Min],
  ['john11-firstpass-max', john11Max],
];

/** The maximal units whose leaves all lie in the region, in reading order. */
function regionUnits(f: Forest, pids: Set<string>): Unit[] {
  const out: Unit[] = [];
  const walk = (u: Unit): void => {
    const leaves = leavesOf(u);
    if (leaves.every((pid) => pids.has(pid))) {
      out.push(u);
      return;
    }
    if (u.kind === 'bracket') {
      u.left.forEach(walk);
      u.right.forEach(walk);
    }
  };
  f.roots.forEach(walk);
  return out;
}

function regionText(fx: LoadedFixture, f: Forest): string {
  const pids = new Set(REGION_LABELS.map(fx.pid));
  return regionUnits(f, pids)
    .map(formatUnit)
    .join(', ')
    .replace(/p\d+/g, (pid) => fx.label(pid));
}

const over = (fx: LoadedFixture, f: Forest, labels: string[]): number =>
  idOver(f, labels.map(fx.pid));

const OUTER_FTIN = ['41b', '41c', '41d', '41e', '42a', '42b'];
const SER_41BC = ['41b', '41c'];
const MED = ['42c', '42d'];
const RIGHT_FTIN = ['42c', '42d', '42e'];
const PACKET = ['41d', '41e', '42a', '42b'];
const ALT_SPAN = REGION_LABELS;

/** The catalogue's "standard three deletes": outer FtIn; Ser[41b,41c]; MEd. */
function threeDeletes(fx: LoadedFixture): Forest {
  let f = fx.forest;
  f = del(f, over(fx, f, OUTER_FTIN));
  f = del(f, over(fx, f, SER_41BC));
  f = del(f, over(fx, f, MED));
  return f;
}

describe.each(FIXTURES)('C. John 11 region — %s', (_name, load) => {
  it('the standard three deletes leave the catalogue\'s region', () => {
    const fx = load();
    expect(regionText(fx, threeDeletes(fx))).toBe(
      'Alt[⟨41b 41c FtIn[FtIn[41d, Ser[41e, 42a]], 42b]⟩, FtIn[⟨42c 42d⟩, 42e]]',
    );
  });

  it('row 10 — the ex-cascade route: the Alt hangs at both ends and STANDS (A4)', () => {
    const fx = load();
    let f = fx.forest;
    f = del(f, over(fx, f, OUTER_FTIN));
    f = del(f, over(fx, f, SER_41BC));
    const alt = over(fx, f, ALT_SPAN);
    f = del(f, over(fx, f, RIGHT_FTIN));
    // v3's I3 cascade took the Alt down here and scattered five units. §10 A4:
    // three deletes, three relationships, and the Alt is simply unfinished.
    expect(bracketById(f, alt)).not.toBeNull();
    expect(regionText(fx, f)).toBe(
      'Alt[⟨41b 41c FtIn[FtIn[41d, Ser[41e, 42a]], 42b]⟩, ⟨MEd[42c, 42d] 42e⟩]',
    );
    // …and every unit it held is still inside it, in both fixture shapes.
    const home = parentOf(f, P(fx.pid('41b')));
    expect(home).toEqual({ bracketId: alt, side: 'left' });
  });

  it('row 11 — the screenshot gesture: 42b·42c, one break, the Alt binary', () => {
    const fx = load();
    const f = threeDeletes(fx);
    const packet = over(fx, f, PACKET);
    const r = join(f, P(fx.pid('42b')), P(fx.pid('42c')), 'Ser', SER);
    expect(r.broken).toEqual([packet]);
    // One break — the bracket that claimed 42b — and the right Ft/In's room
    // keeps its remaining lodger rather than anchoring behind the analyst's
    // back (§10 A1).
    expect(regionText(fx, r.state)).toBe(
      'Alt[⟨41b 41c FtIn[41d, Ser[41e, 42a]] Ser[42b, 42c]⟩, FtIn[⟨42d⟩, 42e]]',
    );
  });

  it('row 12 — a chain of shells never opens a spilled unit', () => {
    const fx = load();
    let f = fx.forest;
    const packet = bracketById(f, over(fx, f, PACKET)) as Unit;
    f = del(f, over(fx, f, SER_41BC));
    f = del(f, over(fx, f, OUTER_FTIN));
    expect(regionText(fx, f)).toBe(
      'Alt[⟨41b 41c FtIn[FtIn[41d, Ser[41e, 42a]], 42b]⟩, FtIn[MEd[42c, 42d], 42e]]',
    );
    expect(bracketOver(f, PACKET.map(fx.pid))).toBe(packet); // whole, BY IDENTITY
  });

  it('row 13 — pristine 42b·42c: the claimers break, and the Alt\'s boundary SLIDES (A8)', () => {
    // v4 brought the Alt down here (rule 3c); §10 A8 lands the join in 42b's
    // own room — the one the packet's spill just made — and the Alt stands,
    // its internal boundary slid past 42c. Two breaks, both of them the
    // brackets that directly claimed the clicked units, and nothing else.
    const fx = load();
    const f = fx.forest;
    const packet = over(fx, f, PACKET);
    const med = over(fx, f, MED);
    const alt = over(fx, f, ALT_SPAN);
    const r = join(f, P(fx.pid('42b')), P(fx.pid('42c')), 'Ser', SER);
    expect(r.broken).toEqual([packet, med]);
    expect(bracketById(r.state, alt)).not.toBeNull(); // the Alt STANDS
    expect(regionText(fx, r.state)).toBe(
      'Alt[FtIn[Ser[41b, 41c], \u27e8FtIn[41d, Ser[41e, 42a]] Ser[42b, 42c]\u27e9], FtIn[\u27e842d\u27e9, 42e]]',
    );
    // The join lives in the outer Ft/In's right room, on the Alt's left side.
    const home = parentOf(r.state, B(r.newBracketId));
    expect(home).not.toBeNull();
    const owner = bracketById(r.state, (home as { bracketId: number }).bracketId);
    expect((owner as { rel: string }).rel).toBe('FtIn');
    expect((home as { side: string }).side).toBe('right');
  });

  it('row 14 — pristine 42c·42d is the same-bracket re-connection', () => {
    const fx = load();
    const med = over(fx, fx.forest, MED);
    const r = ok(connect(fx.forest, P(fx.pid('42c')), P(fx.pid('42d'))));
    expect(r.editedInPlace).toBe(med);
    expect(r.newBracketId).toBe(med);
    expect(r.broken).toEqual([]);
    expect(r.state).toBe(fx.forest);
    // The menu opens ON MEd, preloaded with its own rel and star.
    const before = bracketById(fx.forest, med);
    expect(before?.rel).toBe('MEd');
    expect(before?.star).toBe('right');
    const relabelled = ok(setRelationship(r.state, r.newBracketId, 'CE', CE));
    expect(bracketById(relabelled.state, med)?.star).toBe('right');
  });

  it('row 15 — after a rebuild, 42c·42d breaks both claimers', () => {
    const fx = load();
    let f = fx.forest;
    f = del(f, over(fx, f, ALT_SPAN));
    f = del(f, over(fx, f, OUTER_FTIN));
    f = del(f, over(fx, f, MED));
    const first = join(f, P(fx.pid('42b')), P(fx.pid('42c')), 'Ser', SER);
    expect(regionText(fx, first.state)).toBe(
      'Ser[41b, 41c], FtIn[41d, Ser[41e, 42a]], Ser[42b, 42c], FtIn[⟨42d⟩, 42e]',
    );
    const newSer = first.newBracketId;
    const second = join(first.state, P(fx.pid('42c')), P(fx.pid('42d')), 'CE', CE);
    // ONE break, not two: 42d is the SOLE LODGER of the right Ft/In's room, not
    // a committed member, so that bracket is not in the way — and §10 A3 lands
    // the join inside the room it would otherwise have emptied.
    expect(second.broken).toEqual([newSer]);
    expect(regionText(fx, second.state)).toBe(
      'Ser[41b, 41c], FtIn[41d, Ser[41e, 42a]], 42b, FtIn[⟨CE[42c, 42d]⟩, 42e]',
    );
  });

  it('row 16 — THE SWEEP: every delete sequence ≤3 deep, then the joins', () => {
    const fx = load();
    const order = leafOrder(fx.forest);
    const shapes = [OUTER_FTIN, SER_41BC, MED, RIGHT_FTIN, PACKET, ALT_SPAN,
      ['41d', '41e', '42a'], ['41e', '42a']];
    const bc: [string, string] = ['42b', '42c'];
    const cd: [string, string] = ['42c', '42d'];
    const joins: [string, string][][] = [[bc], [cd], [bc, cd], [cd, bc]];

    let connectsRun = 0;
    const sweepJoins = (start: Forest): void => {
      for (const sequence of joins) {
        let f = start;
        for (const [x, y] of sequence) {
          const a = P(fx.pid(x));
          const b = P(fx.pid(y));
          const before = f;
          // By CONTENT: `f` is not reassigned on the refusal path, so comparing
          // it to `before` there could not fail whatever the core did.
          const snapshot = formatForest(before);
          const preview = previewConnect(f, a, b);
          const result = connect(f, a, b);
          expect(result.ok).toBe(preview.ok);
          if (!result.ok) {
            expect(formatForest(f)).toBe(snapshot); // byte-identical (§8.3)
            continue;
          }
          expect(formatForest(before)).toBe(snapshot); // nor on the success path
          connectsRun += 1;
          expect(ok(preview).broken).toEqual(result.broken);
          const removed = idsOf(before).filter((id) => !idsOf(result.state).includes(id));
          expect(removed.sort()).toEqual([...result.broken].sort());
          assertInvariants(result.state, order);
          f = result.state;
        }
      }
    };

    const sweep = (f: Forest, depth: number): void => {
      sweepJoins(f);
      if (depth === 0) return;
      for (const shape of shapes) {
        const pids = shape.map(fx.pid);
        let id: number;
        try {
          id = idOver(f, pids);
        } catch {
          continue; // already gone, by an earlier delete or its cascade
        }
        const next = ok(deleteBracket(f, id));
        assertInvariants(next.state, order);
        sweep(next.state, depth - 1);
      }
    };

    sweep(freeze(fx.forest), 3);
    expect(connectsRun).toBeGreaterThan(100);
  });
});

function idsOf(f: Forest): number[] {
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

// ---------------------------------------------------------------------------
// D. Rows from the adversarial review, under v3 (rows 17–23)

describe('D. the adversarial review, under v4', () => {
  it('row 17 — L1 at A8: the crossed bracket STANDS, its boundary slides', () => {
    // v3 refused; v4 broke R; §10 A8 lands the join in z's own room and the
    // Alt-shaped R survives with its boundary slid — zero breakage.
    const f = forestOf(
      br('R', br('S', L('x'), Ls('y', 'z'), 'left'), br('T', Ls('u', 'v'), L('t'), 'left'), 'left'),
    );
    const r = ok(connectDetail(f, P('z'), P('u')));
    const named = ok(setRelationship(r.state, r.newBracketId, 'Ser', SER));
    expect(formatForest(named.state)).toBe('[R[S[x, ⟨y Ser[z, u]⟩], T[⟨v⟩, t]]]');
    expect(r.broken).toEqual([]);
    expect(r.detail.crossed).toBeNull();
  });

  it('row 18 — L2: the join lands in the room, and both rooms stay rooms', () => {
    resetIds();
    const f = forestOf(br('R', Ls('a', 'l'), br('S', Ls('r', 's'), L('t'), 'left'), 'left'));
    const r = ok(connectDetail(f, P('l'), P('r')));
    const named = ok(setRelationship(r.state, r.newBracketId, 'Ser', SER));
    expect(formatForest(named.state)).toBe('[R[⟨a Ser[l, r]⟩, S[⟨s⟩, t]]]');
    expect(r.broken).toEqual([]);
  });

  it('row 19 — A3: the join GROWS the room it came out of, and breaks one bracket', () => {
    const fx = john1146();
    const f = threeDeletes(fx);
    const first = join(f, P(fx.pid('42c')), P(fx.pid('42d')), 'Ser', SER);
    const packet = over(fx, first.state, PACKET);
    const rightFt = over(fx, first.state, ['42c', '42d', '42e']);
    const alt = over(fx, first.state, ALT_SPAN);
    // The Ser is the right Ft/In's room's SOLE lodger. v3 called it committed,
    // broke that Ft/In and landed in the Alt. §10 A3: it is a lodger, the Ft/In
    // is untouched, and the join lands in its room — whose extent grows
    // leftwards over the 42b the join brought in.
    const second = join(first.state, P(fx.pid('42b')), B(first.newBracketId), 'CE', CE);
    expect(second.broken).toEqual([packet]);
    expect(bracketById(second.state, alt)).not.toBeNull();
    expect(bracketById(second.state, rightFt)).not.toBeNull();
    expect(regionText(fx, second.state)).toBe(
      'Alt[⟨41b 41c FtIn[41d, Ser[41e, 42a]]⟩, FtIn[⟨CE[42b, Ser[42c, 42d]]⟩, 42e]]',
    );
  });

  it('row 20 — the analyst\'s verbatim plan, end to end, zero refusals (E3, §10)', () => {
    // "Connect 42c to 42d, connect that to 42b, and connect that to Ft." Under
    // §10 the third step is the PICKUP DOT (A2): "connect that to Ft" is the
    // gesture that finishes the Ft/In, and it always was.
    const fx = john1146();
    const f = threeDeletes(fx);
    const packet = over(fx, f, PACKET);
    const rightFt = over(fx, f, RIGHT_FTIN);

    const s1 = join(f, P(fx.pid('42c')), P(fx.pid('42d')), 'Ser', SER);
    expect(s1.broken).toEqual([]);
    // A1's own test case, inside the analyst's plan: the Ft/In STAYS HANGING.
    expect(regionText(fx, s1.state)).toBe(
      'Alt[⟨41b 41c FtIn[FtIn[41d, Ser[41e, 42a]], 42b]⟩, FtIn[⟨Ser[42c, 42d]⟩, 42e]]',
    );

    const s2 = join(s1.state, P(fx.pid('42b')), B(s1.newBracketId), 'CE', CE);
    expect(s2.broken).toEqual([packet]); // one break in the whole plan
    expect(regionText(fx, s2.state)).toBe(
      'Alt[⟨41b 41c FtIn[41d, Ser[41e, 42a]]⟩, FtIn[⟨CE[42b, Ser[42c, 42d]]⟩, 42e]]',
    );

    const s3 = ok(settleSide(s2.state, rightFt, 'left'));
    expect(regionText(fx, s3.state)).toBe(
      'Alt[⟨41b 41c FtIn[41d, Ser[41e, 42a]]⟩, FtIn[CE[42b, Ser[42c, 42d]], 42e]]',
    );
  });

  it('row 21 — split hangs R at BOTH ends; nothing comes down (§10 A4)', () => {
    resetIds();
    const f = forestOf(br('R', Ls('a', 'b'), L('w'), 'right'));
    const r = ok(splitLeaf(f, 'w', 'w2'));
    expect(formatForest(r.state)).toBe('[R[⟨a b⟩, ⟨w w2⟩]]');
  });

  it('row 22 — merge, innermost-outward, and NO silent promotion (§10 A1)', () => {
    resetIds();
    const pinned = forestOf(br('R', L('y'), br('S', L('x'), L('w1'), 'right'), 'right'), L('w2'));
    expect(formatForest(ok(mergeLeaves(pinned, 'w1')).state)).toBe('[R[y, ⟨x⟩], w1]');

    resetIds();
    const fused = forestOf(br('R', Ls('w1', 'w2'), L('c'), 'right'));
    expect(formatForest(ok(mergeLeaves(fused, 'w1')).state)).toBe('[R[⟨w1⟩, c]]');

    resetIds();
    const released = forestOf(br('R', L('a'), Ls('b', 'w1'), 'left'), L('w2'));
    expect(formatForest(ok(mergeLeaves(released, 'w1')).state)).toBe('[R[a, ⟨b⟩], w1]');

    // ...and a ONE-LODGER room is not annihilated either: A1 names merges
    // outright, so the room absorbs the fusion and its extent grows over the
    // partner's words. Both directions, because the fused leaf keeps w1's pid
    // (§7.10), so the mirror needs the room to grow OUTWARD — which is exactly
    // what row 19's room does over the 42b beside it.
    resetIds();
    const sole = forestOf(br('R', L('a'), [L('w1')], 'right'), L('w2'));
    expect(formatForest(ok(mergeLeaves(sole, 'w1')).state)).toBe('[R[a, ⟨w1⟩]]');

    resetIds();
    const mirror = forestOf(L('w1'), br('R', [L('w2')], L('a'), 'right'));
    expect(formatForest(ok(mergeLeaves(mirror, 'w1')).state)).toBe('[R[⟨w1⟩, a]]');
  });

  it('row 23 — committed inside its own bracket: the blunt rule has no exception', () => {
    resetIds();
    const f = forestOf(br('FtIn', L('a'), Ls('b', 'c'), 'left'));
    const ft = bracketOver(f, ['a', 'b', 'c']);
    const r = ok(connectDetail(f, P('a'), P('b')));
    const named = ok(setRelationship(r.state, r.newBracketId, 'Ser', SER));
    expect(formatForest(named.state)).toBe('[Ser[a, b], c]');
    expect(r.broken).toEqual([ft.id]);
    expect(r.editedInPlace).toBeUndefined();
  });

  it('row 29 — A3\'s doubly-degenerate landing: the LEFT room takes it', () => {
    // A3's "with two such rooms, the left" is only reachable when each endpoint
    // is its own room's sole lodger. Whichever room takes the join, the other
    // is left with nothing to relate — I2, not a cascade, closes it, and the
    // bracket that gave way is REPORTED in `broken`.
    resetIds();
    const across = forestOf(
      br('R1', L('x'), [L('u')], 'right'),
      br('R2', [L('v')], L('y'), 'right'),
    );
    const r2 = bracketOver(across, ['v', 'y']).id;
    const wide = ok(connectDetail(across, P('u'), P('v')));
    expect(formatForest(wide.state)).toBe('[R1[x, ⟨Ser[u, v]⟩], y]');
    expect(wide.broken).toEqual([r2]);

    // WITHIN one bracket — the case flagged for the analyst in catalogue row
    // 29. The new Ser stands where the FtIn stood, over the same two units,
    // and the menu opens preloaded on it (A5). If "nothing destroys itself"
    // outranks A3's tiebreak here, this join REFUSES instead and the analyst
    // finishes the FtIn with its two pickup dots; nothing else changes.
    resetIds();
    const within = forestOf(br('FtIn', [L('a')], [L('b')], 'right'));
    const ft = bracketOver(within, ['a', 'b']).id;
    const narrow = ok(connectDetail(within, P('a'), P('b')));
    expect(formatForest(narrow.state)).toBe('[Ser[a, b]]');
    expect(narrow.broken).toEqual([ft]);
    expect(narrow.detail.emptied).toEqual([ft]);
  });
});

// ---------------------------------------------------------------------------
// E/F. Load and attribute rows (24, 25)

describe('E/F. load and attributes', () => {
  it('row 24 — the loader is binary-only (Q2), rooms arrive as holes, reversed is derived', () => {
    // The wire adapter itself is phase 2 (spec §7.4); what the core owns today
    // is the shape it accepts and the value `reversed` must be written as.
    expect(() =>
      forestFromWire({
        schemaVersion: 2,
        propositions: [{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }, { id: 'c', label: 'c' }],
        forest: [
          {
            kind: 'bracket',
            rel: 'Ser',
            prominent: null,
            children: [
              { kind: 'prop', ref: 'a' },
              { kind: 'prop', ref: 'b' },
              { kind: 'prop', ref: 'c' },
            ],
          },
        ],
      }),
    ).toThrow(/not binary/);

    const withRoom = forestFromWire({
      schemaVersion: 2,
      propositions: [{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }, { id: 'c', label: 'c' }],
      forest: [
        {
          kind: 'bracket',
          rel: 'FtIn',
          prominent: 0,
          children: [
            { kind: 'prop', ref: 'a' },
            { kind: 'hole', children: [{ kind: 'prop', ref: 'b' }, { kind: 'prop', ref: 'c' }] },
          ],
        },
      ],
    });
    assertInvariants(withRoom, ['a', 'b', 'c']);
    expect(formatForest(withRoom)).toBe('[FtIn[a, ⟨b c⟩]]');
    // prominent 0 against starredLabel 1: exactly the fixtures' reversed:true.
    expect(reversedOf(withRoom, idOver(withRoom, ['a', 'b', 'c']), FTIN)).toBe(true);

    const fx = john1146();
    const wed = over(fx, fx.forest, ['38a', '38b']);
    expect(reversedOf(fx.forest, wed, { coordinate: false, starredLabel: 1 })).toBe(true);
    const alt = over(fx, fx.forest, REGION_LABELS);
    expect(reversedOf(fx.forest, alt, ALT)).toBe(false);
  });

  it('row 25 — setRelationship keeps the star coherent, flipStar moves it', () => {
    resetIds();
    const f = forestOf(br('FtIn', L('a'), L('b'), 'right'));
    const id = idOver(f, ['a', 'b']);
    const coordinate = ok(setRelationship(f, id, 'Ser', SER));
    expect(bracketById(coordinate.state, id)?.star).toBeNull();
    const back = ok(setRelationship(coordinate.state, id, 'Grnd', GRND));
    expect(bracketById(back.state, id)?.star).toBe('left'); // the taxonomy default
    expect(reversedOf(back.state, id, GRND)).toBe(false);
  });
});
