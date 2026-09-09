/**
 * The wire adapter (spec §7.4, acceptance row 24): the stored v2 document and
 * the core Forest, read and written.
 *
 * What is asserted here:
 *   - ROUND-TRIP IDENTITY on the analyst's three real John 11 documents:
 *     `toWire(fromWire(forest))` is the stored forest again, key for key —
 *     rooms as holes, ids stripped, `reversed` only where it was stored.
 *   - The row-24 SHAPE GATES: an n-ary bracket, a hole at the floor, a hole
 *     inside a hole → a typed refusal (never a throw, never a binarizer), so
 *     the caller can fall back to propositions-only with a warning (§7.5).
 *   - DERIVED `reversed` agrees with every flag the fixtures actually store
 *     (§1's follow-on ruling: computed from rel + star, never read back).
 *   - A PROPERTY round-trip: random core forests → wire → core preserve the
 *     forest exactly, as §8.3 requires of serialization.
 */

import { describe, expect, it } from 'vitest';
import type { BracketNode, TreeNode } from '../../types';
import type { Bracket, Forest, Unit } from '../core';
import {
  assertInvariants,
  buildForest,
  connect,
  deleteBracket,
  formatForest,
  leaf,
  leafOrder,
  parentOf,
  reversedOf,
  setRelationship,
  settleSide,
} from '../core';
import type { TaxonomyLike } from '../serialize';
import { fromWire, toWire, tryToWire } from '../serialize';
import type { WireDoc } from './wire';
import { john1146, john11Max, john11Min, wireDoc } from './wire';

/**
 * The 18 relationships as `toWire` needs them, mirroring da/taxonomy.py: the
 * three coordinate types carry no star (`starredLabel` None there), and every
 * subordinate type's starred end is the index the stored `reversed` flags are
 * measured against.
 */
const TAXONOMY: TaxonomyLike[] = (
  [
    ['Ser', null], ['Prog', null], ['Alt', null],
    ['WEd', 1], ['Cmp', 1], ['NegPos', 1], ['GnSp', 1], ['FtIn', 1],
    ['Grnd', 0], ['Inf', 1], ['CE', 1], ['CndE', 1], ['MEd', 1],
    ['Tmp', 1], ['Loc', 1], ['Adv', 1], ['QA', 1], ['SR', 1],
  ] as [string, number | null][]
).map(([code, starredLabel]) => ({ code, starredLabel, coordinate: starredLabel === null }));

const FIXTURE_NAMES = ['john11-46', 'john11-firstpass-min', 'john11-firstpass-max'];
const LOADERS = [john1146, john11Min, john11Max];

function ok(load: ReturnType<typeof fromWire>): Forest {
  if (!load.ok) throw new Error(`expected a forest, got ${load.reason.code}: ${load.reason.message}`);
  return load.forest;
}

// ---------------------------------------------------------------------------
// Round-trips on the real documents

describe('row 24 — fixture round-trips', () => {
  for (const name of FIXTURE_NAMES) {
    it(`${name}: fromWire → toWire is the stored forest again`, () => {
      const doc: WireDoc = wireDoc(name);
      const order = doc.propositions.map((p) => p.id);
      const forest = ok(fromWire(doc.forest, order));
      assertInvariants(forest, order);
      expect(toWire(forest, TAXONOMY)).toEqual(doc.forest);
    });

    it(`${name}: a second trip changes nothing (the adapter is idempotent)`, () => {
      const doc = wireDoc(name);
      const once = toWire(ok(fromWire(doc.forest)), TAXONOMY);
      const twice = toWire(ok(fromWire(once)), TAXONOMY);
      expect(twice).toEqual(once);
    });
  }

  it('a disconnected forest round-trips as its own roots', () => {
    // john11-firstpass-min is 15 roots: 14 of them connected, and the flat
    // ones stand alone — no hole, no wrapper (§1: the floor is a list).
    const doc = wireDoc('john11-firstpass-min');
    const wire = toWire(ok(fromWire(doc.forest)), TAXONOMY);
    expect(wire).toHaveLength(doc.forest.length);
    expect(wire.filter((n) => n.kind === 'prop')).toHaveLength(
      doc.forest.filter((n) => n.kind === 'prop').length,
    );
  });

  it('a ONE-LODGER room and a TWO-HANGING bracket round-trip (§10 A1, A4)', () => {
    // The two shapes v4 added to the wire. Neither existed under v3: a hole of
    // one was collapsed on the way in, and a bracket with two holes was
    // dissolved. Both are ordinary working states now, so both must survive a
    // save and a re-open exactly as they stand.
    const f = buildForest(
      [{
        kind: 'bracket', id: 1, rel: 'FtIn', star: 'right',
        leftHanging: true, rightHanging: true,
        left: [{
          kind: 'bracket', id: 2, rel: 'Ser', star: null,
          leftHanging: false, rightHanging: false,
          left: [leaf('a')], right: [leaf('b')],
        }],
        right: [leaf('c'), leaf('d')],
      }],
      3,
    );
    expect(formatForest(f)).toBe('[FtIn[⟨Ser[a, b]⟩, ⟨c d⟩]]');
    const wire = toWire(f, TAXONOMY);
    expect(wire[0]).toEqual({
      kind: 'bracket',
      rel: 'FtIn',
      prominent: 1,
      children: [
        { kind: 'hole', children: [{
          kind: 'bracket', rel: 'Ser', prominent: null,
          children: [{ kind: 'prop', ref: 'a' }, { kind: 'prop', ref: 'b' }],
        }] },
        { kind: 'hole', children: [{ kind: 'prop', ref: 'c' }, { kind: 'prop', ref: 'd' }] },
      ],
    });
    const back = ok(fromWire(wire, ['a', 'b', 'c', 'd'], TAXONOMY));
    expect(formatForest(back)).toBe(formatForest(f));
    expect(toWire(back, TAXONOMY)).toEqual(wire);
  });

  it('a SETTLE round-trips: the hole becomes the unit, and only that', () => {
    // §10 A2's gesture, through the wire and back. The settled side writes its
    // unit where the hole was; nothing else about the document moves.
    const f = buildForest(
      [{
        kind: 'bracket', id: 1, rel: 'FtIn', star: 'right',
        leftHanging: true, rightHanging: false,
        left: [{
          kind: 'bracket', id: 2, rel: 'Ser', star: null,
          leftHanging: false, rightHanging: false,
          left: [leaf('a')], right: [leaf('b')],
        }],
        right: [leaf('c')],
      }],
      3,
    );
    const hanging = toWire(f, TAXONOMY);
    const settled = settleSide(f, 1, 'left');
    if (!settled.ok) throw new Error('settle refused');
    const whole = toWire(settled.state, TAXONOMY);
    expect(countHoles(hanging)).toBe(1);
    expect(countHoles(whole)).toBe(0);
    expect((whole[0] as BracketNode).children[0]).toEqual(
      ((hanging[0] as BracketNode).children[0] as { children: TreeNode[] }).children[0],
    );
    expect(formatForest(ok(fromWire(whole, ['a', 'b', 'c'], TAXONOMY)))).toBe(
      '[FtIn[Ser[a, b], c]]',
    );
  });

  it('rooms are written as holes and read back as lodgers', () => {
    // Delete a relationship inside a tree: what it held stays put, hanging —
    // and that side is exactly what the wire spells as a hole.
    const fx = john1146();
    // A bracket that is COMMITTED inside another: its side held it alone, so
    // its spilled units make that side hang.
    const victim = allBrackets(fx.forest).find(
      (b) => parentOf(fx.forest, { kind: 'bracket', id: b.id }) !== null,
    );
    if (victim === undefined) throw new Error('no committed bracket in the fixture');
    const opened = deleteBracket(fx.forest, victim.id);
    if (!opened.ok) throw new Error('delete refused');
    const wire = toWire(opened.state, TAXONOMY);
    expect(countHoles(wire)).toBeGreaterThan(0);
    const back = ok(fromWire(wire, fx.order));
    expect(formatForest(back)).toBe(formatForest(opened.state));
  });
});

// ---------------------------------------------------------------------------
// Row 24's shape gates — typed refusals, no legacy paths (Q2)

describe('row 24 — the loader is strict', () => {
  const P = (ref: string): TreeNode => ({ kind: 'prop', ref });
  const BR = (rel: string, prominent: number | null, ...children: TreeNode[]): TreeNode =>
    ({ kind: 'bracket', rel, prominent, children }) as BracketNode;

  it('an n-ary bracket refuses — no binarization (ruling Q2)', () => {
    const load = fromWire([BR('Ser', null, P('a'), P('b'), P('c'))], ['a', 'b', 'c']);
    expect(load.ok).toBe(false);
    if (load.ok) return;
    expect(load.reason.code).toBe('n-ary');
    expect(load.reason.message).toMatch(/not binary/);
  });

  it('a one-child bracket refuses too — two sides, always', () => {
    const load = fromWire([BR('Ser', null, P('a'))], ['a']);
    expect(load.ok).toBe(false);
    if (!load.ok) expect(load.reason.code).toBe('n-ary');
  });

  it('a hole at the floor refuses: a root is unattached already', () => {
    const load = fromWire([{ kind: 'hole', children: [P('a'), P('b')] }], ['a', 'b']);
    expect(load.ok).toBe(false);
    if (!load.ok) expect(load.reason.code).toBe('root-hole');
  });

  it('a hole inside a hole refuses: what waits, waits together', () => {
    const nested: TreeNode = {
      kind: 'hole',
      children: [P('b'), { kind: 'hole', children: [P('c'), P('d')] }],
    };
    const load = fromWire([BR('FtIn', 0, P('a'), nested)], ['a', 'b', 'c', 'd']);
    expect(load.ok).toBe(false);
    if (!load.ok) expect(load.reason.code).toBe('nested-hole');
  });

  it('a hole of ONE loads as a one-lodger room (§10 A1)', () => {
    const load = fromWire(
      [BR('FtIn', 0, P('a'), { kind: 'hole', children: [P('b')] })],
      ['a', 'b'],
    );
    expect(load.ok).toBe(true);
    if (!load.ok) return;
    expect(formatForest(load.forest)).toBe('[FtIn[a, ⟨b⟩]]');
  });

  it('an EMPTY hole still refuses: a side is never empty (I2)', () => {
    const load = fromWire(
      [BR('FtIn', 0, P('a'), { kind: 'hole', children: [] })],
      ['a'],
    );
    expect(load.ok).toBe(false);
    if (!load.ok) expect(load.reason.code).toBe('thin-hole');
  });

  it('a bracket hanging at BOTH ends loads (§10 A4): two holes are legal', () => {
    const load = fromWire(
      [
        BR(
          'FtIn',
          0,
          { kind: 'hole', children: [P('a'), P('b')] },
          { kind: 'hole', children: [P('c'), P('d')] },
        ),
      ],
      ['a', 'b', 'c', 'd'],
    );
    expect(load.ok).toBe(true);
    if (!load.ok) return;
    expect(formatForest(load.forest)).toBe('[FtIn[⟨a b⟩, ⟨c d⟩]]');
  });

  it('a forest that does not match the propositions refuses (I4/I6)', () => {
    const load = fromWire([BR('Ser', null, P('a'), P('b'))], ['a', 'b', 'c']);
    expect(load.ok).toBe(false);
    if (!load.ok) expect(load.reason.code).toBe('invariant');
  });

  it('a bad node refuses rather than throwing', () => {
    expect(fromWire([], ['a']).ok).toBe(false);
    const badKind = fromWire([{ kind: 'twig' } as unknown as TreeNode], ['a']);
    expect(badKind.ok).toBe(false);
    if (!badKind.ok) expect(badKind.reason.code).toBe('bad-node');
    const badStar = fromWire([BR('FtIn', 2, P('a'), P('b'))], ['a', 'b']);
    expect(badStar.ok).toBe(false);
    if (!badStar.ok) expect(badStar.reason.code).toBe('bad-node');
    const noRel = fromWire(
      [{ kind: 'bracket', prominent: null, children: [P('a'), P('b')] } as unknown as TreeNode],
      ['a', 'b'],
    );
    expect(noRel.ok).toBe(false);
    if (!noRel.ok) expect(noRel.reason.code).toBe('bad-node');
    // The refusal is TYPED, so the caller falls back — it never throws.
    expect(() => fromWire([BR('Ser', null, P('a'), P('b'), P('c'))], ['a', 'b', 'c'])).not.toThrow();
  });

  it("a valid document's props are read as the wire spells them", () => {
    const forest = ok(
      fromWire([BR('FtIn', 1, P('a'), { kind: 'hole', children: [P('b'), P('c')] })], ['a', 'b', 'c']),
    );
    expect(formatForest(forest)).toBe('[FtIn[a, ⟨b c⟩]]');
    const bracket = allBrackets(forest)[0];
    expect(bracket.star).toBe('right'); // prominent 1 → the right end
  });
});

// ---------------------------------------------------------------------------
// The taxonomy-aware half of I7 — the checks §7.5 wants at LOAD, not at save
//
// `assertInvariants` cannot see whether a relationship is coordinate (the core
// knows no taxonomy), so I7's "star null iff coordinate" and "is this rel a rel
// at all" are only checked when `fromWire` is handed one. These are the three
// checks `da/documents.py`'s `_walk_tree` makes; without them the refusal moves
// from load — where the analyst gets propositions-only and a warning — to save,
// where it is an opaque 400 on a document already edited.

describe('§7.5 — with a taxonomy, the loader keeps all of I7', () => {
  const P = (ref: string): TreeNode => ({ kind: 'prop', ref });
  const BR = (rel: string, prominent: number | null): TreeNode =>
    ({ kind: 'bracket', rel, prominent, children: [P('a'), P('b')] }) as BracketNode;

  it('a starred coordinate bracket refuses', () => {
    const load = fromWire([BR('Ser', 0)], ['a', 'b'], TAXONOMY);
    expect(load.ok).toBe(false);
    if (!load.ok) expect(load.reason.code).toBe('incoherent-star');
  });

  it('an unstarred subordinate bracket refuses', () => {
    const load = fromWire([BR('FtIn', null)], ['a', 'b'], TAXONOMY);
    expect(load.ok).toBe(false);
    if (!load.ok) expect(load.reason.code).toBe('incoherent-star');
  });

  it('a rel the taxonomy does not carry refuses', () => {
    const load = fromWire([BR('Bogus', 0)], ['a', 'b'], TAXONOMY);
    expect(load.ok).toBe(false);
    if (!load.ok) expect(load.reason.code).toBe('unknown-rel');
  });

  it('all three load happily WITHOUT a taxonomy — the parameter is the check', () => {
    // Today's behaviour for callers that hold no taxonomy: structure only.
    for (const node of [BR('Ser', 0), BR('FtIn', null), BR('Bogus', 0)]) {
      expect(fromWire([node], ['a', 'b']).ok).toBe(true);
    }
  });

  it('the analyst’s real documents pass the tightened load', () => {
    for (const name of FIXTURE_NAMES) {
      const doc = wireDoc(name);
      const load = fromWire(doc.forest, doc.propositions.map((p) => p.id), TAXONOMY);
      expect(load.ok).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// `flag` survives the trip — §7.4 item 4's "flag normalization kept"

describe('§7.4 item 4 — the review flag is carried, not dropped', () => {
  const flagged: TreeNode = {
    kind: 'bracket',
    rel: 'FtIn',
    prominent: 1,
    flag: 'review',
    children: [{ kind: 'prop', ref: 'a' }, { kind: 'prop', ref: 'b' }],
  } as BracketNode;

  it('round-trips key for key', () => {
    const forest = ok(fromWire([flagged], ['a', 'b']));
    expect(allBrackets(forest)[0].flag).toBe('review');
    expect(toWire(forest, TAXONOMY)).toEqual([flagged]);
  });

  it('an unflagged bracket never sprouts the key', () => {
    const plain = { ...(flagged as BracketNode) };
    delete plain.flag;
    const forest = ok(fromWire([plain], ['a', 'b']));
    expect(allBrackets(forest)[0].flag).toBeUndefined();
    expect(toWire(forest, TAXONOMY)[0]).not.toHaveProperty('flag');
  });

  it('it rides through an op, as rel and star do', () => {
    // Relabelling the flagged bracket must not lose the analyst's amber mark;
    // nor must an unrelated op that rebuilds the tree around it.
    const forest = ok(fromWire(
      [{
        kind: 'bracket', rel: 'Ser', prominent: null,
        children: [flagged, { kind: 'prop', ref: 'c' }],
      } as BracketNode],
      ['a', 'b', 'c'],
    ));
    const inner = allBrackets(forest).find((b) => b.rel === 'FtIn');
    if (inner === undefined) throw new Error('no inner bracket');
    const relabelled = setRelationship(forest, inner.id, 'Grnd', {
      coordinate: false,
      starredLabel: 0,
    });
    if (!relabelled.ok) throw new Error('setRelationship refused');
    const after = allBrackets(relabelled.state).find((b) => b.rel === 'Grnd');
    expect(after?.flag).toBe('review');

    const outer = allBrackets(forest).find((b) => b.rel === 'Ser');
    if (outer === undefined) throw new Error('no outer bracket');
    const opened = deleteBracket(forest, outer.id);
    if (!opened.ok) throw new Error('delete refused');
    expect(allBrackets(opened.state).find((b) => b.rel === 'FtIn')?.flag).toBe('review');
  });

  it("a flag the schema does not describe refuses rather than being guessed at", () => {
    const bogus = { ...(flagged as BracketNode), flag: 'urgent' } as unknown as TreeNode;
    const load = fromWire([bogus], ['a', 'b']);
    expect(load.ok).toBe(false);
    if (!load.ok) expect(load.reason.code).toBe('bad-node');
  });
});

// ---------------------------------------------------------------------------
// `reversed` is derived — and agrees with what the analyst's documents store

describe('row 24 — reversed is written as its derived value', () => {
  for (let i = 0; i < FIXTURE_NAMES.length; i += 1) {
    it(`${FIXTURE_NAMES[i]}: every stored flag equals reversedOf`, () => {
      const fx = LOADERS[i]();
      const pairs = lockstep(fx.doc.forest, fx.forest.roots);
      expect(pairs.length).toBeGreaterThan(0);
      let storedTrue = 0;
      for (const [node, bracket] of pairs) {
        const entry = TAXONOMY.find((e) => e.code === node.rel);
        if (entry === undefined) throw new Error(`fixture uses unknown rel ${node.rel}`);
        const derived = reversedOf(fx.forest, bracket.id, {
          coordinate: entry.coordinate,
          starredLabel: entry.starredLabel ?? undefined,
        });
        expect(derived).toBe(node.reversed === true);
        if (node.reversed === true) storedTrue += 1;
      }
      // The fixtures are not vacuously reversed-free: each stores two.
      expect(storedTrue).toBe(2);
    });
  }

  it('a coordinate bracket is never reversed, whatever its star', () => {
    const wire = toWire(
      buildForest([{
        kind: 'bracket', id: 1, rel: 'Ser', star: null,
        leftHanging: false, rightHanging: false, left: [leaf('a')], right: [leaf('b')],
      }], 2),
      TAXONOMY,
    );
    expect(wire[0]).toEqual({ kind: 'bracket', rel: 'Ser', prominent: null, children: [
      { kind: 'prop', ref: 'a' }, { kind: 'prop', ref: 'b' },
    ] });
  });

  it('the star crosses as a child index: left → 0, right → 1', () => {
    const f = buildForest(
      [{
        kind: 'bracket', id: 1, rel: 'Grnd', star: 'right',
        leftHanging: false, rightHanging: false, left: [leaf('a')], right: [leaf('b')],
      }],
      2,
    );
    const node = toWire(f, TAXONOMY)[0] as BracketNode;
    expect(node.prominent).toBe(1);
    expect(node.reversed).toBe(true); // Grnd stars labels[0] by default
    const back = ok(fromWire([node], ['a', 'b']));
    expect(allBrackets(back)[0].star).toBe('right');
  });
});

// ---------------------------------------------------------------------------
// The two write paths (§7.4 item 4: ONE snapshot per docTick, shared by
// onChange, mainPids and the overlay — while §7.2 makes every op one
// transaction, so the docTick fires on states the wire cannot spell).

describe('§7.4 — the save path and the snapshot path', () => {
  it('a connect is STORABLE the moment it lands (§10 A5: it is a Ser)', () => {
    // Two dots clicked, transaction dispatched, docTick fired — and the
    // document goes straight to the draft, because Q6's unlabeled state does
    // not exist any more. There is nothing for the snapshot path to hold back.
    const fx = john1146();
    const joined = connect(
      fx.forest,
      { kind: 'leaf', pid: fx.order[1] },
      { kind: 'leaf', pid: fx.order[2] },
    );
    if (!joined.ok) throw new Error(`connect refused: ${joined.refusal.code}`);
    expect(formatForest(joined.state)).not.toContain('?[');
    const snapshot = tryToWire(joined.state, TAXONOMY);
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    expect(snapshot.forest).toEqual(toWire(joined.state, TAXONOMY));
    expect(fromWire(snapshot.forest, fx.order, TAXONOMY).ok).toBe(true);
  });

  it('and re-choosing the relationship writes the same document again', () => {
    const fx = john1146();
    const joined = connect(
      fx.forest,
      { kind: 'leaf', pid: fx.order[1] },
      { kind: 'leaf', pid: fx.order[2] },
    );
    if (!joined.ok) throw new Error('connect refused');
    const named = setRelationship(joined.state, joined.newBracketId, 'Ser', {
      coordinate: true,
    });
    if (!named.ok) throw new Error('setRelationship refused');
    const written = tryToWire(named.state, TAXONOMY);
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    expect(written.forest).toEqual(toWire(named.state, TAXONOMY));
    // And the document that results is loadable again — the trip closes.
    expect(fromWire(written.forest, fx.order, TAXONOMY).ok).toBe(true);
  });

  it('names the bracket and its leaves', () => {
    // `rel: null` is unreachable from any gesture now (§10 A5), but the wire
    // still has no spelling for it, so the guard — and its message — stay.
    const f = buildForest(
      [{
        kind: 'bracket', id: 7, rel: null, star: null,
        leftHanging: false, rightHanging: false, left: [leaf('a')], right: [leaf('b')],
      }],
      8,
    );
    expect(() => toWire(f, TAXONOMY)).toThrow(/bracket 7 over \[a b\] has no relationship/);
    const snapshot = tryToWire(f, TAXONOMY);
    if (snapshot.ok) throw new Error('expected a refusal');
    expect(snapshot.reason.bracketId).toBe(7);
  });

  it('a rel the taxonomy does not carry refuses — it does not write a wrong `reversed`', () => {
    // The old branch wrote this bracket with `reversed` silently omitted. The
    // server rejects the rel either way, so the refusal costs no save; it only
    // buys a message that names the bracket.
    const f = buildForest(
      [{
        kind: 'bracket', id: 3, rel: 'Bogus', star: 'left',
        leftHanging: false, rightHanging: false, left: [leaf('a')], right: [leaf('b')],
      }],
      4,
    );
    expect(() => toWire(f, TAXONOMY)).toThrow(/does not carry/);
    const snapshot = tryToWire(f, TAXONOMY);
    expect(snapshot.ok).toBe(false);
    if (snapshot.ok) return;
    expect(snapshot.reason.code).toBe('unknown-rel');
    expect(snapshot.reason.bracketId).toBe(3);
  });

  it('a storable forest gets the same bytes from either path', () => {
    const fx = john1146();
    const written = tryToWire(fx.forest, TAXONOMY);
    if (!written.ok) throw new Error(`unexpected refusal: ${written.reason.code}`);
    expect(written.forest).toEqual(toWire(fx.forest, TAXONOMY));
    expect(written.forest).toEqual(fx.doc.forest);
  });
});

// ---------------------------------------------------------------------------
// Property: random forests survive the trip (§8.3)

describe('property: core → wire → core', () => {
  it('preserves every forest over 400 seeded runs', () => {
    for (let seed = 1; seed <= 400; seed += 1) {
      const rnd = mulberry32(seed);
      const leaves = Array.from({ length: 2 + Math.floor(rnd() * 10) }, (_, i) => `p${i}`);
      const f = randomForest(rnd, leaves);
      const wire = toWire(f, TAXONOMY);
      const back = fromWire(wire, leafOrder(f));
      if (!back.ok) {
        throw new Error(`seed ${seed}: ${back.reason.code} on ${formatForest(f)}`);
      }
      expect(formatForest(back.forest)).toBe(formatForest(f));
      // Ids are stripped and re-minted; the mint still covers what came back.
      for (const b of allBrackets(back.forest)) expect(b.id).toBeLessThan(back.forest.nextId);
      assertInvariants(back.forest, leafOrder(f));
      // And back out again: the wire is a fixed point after one trip.
      expect(toWire(back.forest, TAXONOMY)).toEqual(wire);
    }
  });
});

// ---------------------------------------------------------------------------
// Helpers — the generator patterns of property.test.ts, with a real rel on
// every bracket (a rel-less bracket is a mid-gesture state, never stored).

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
const COORDINATE = new Set(['Ser', 'Alt']);

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
      star: COORDINATE.has(rel) ? null : rnd() < 0.5 ? 'left' : 'right',
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

  // Deletes are how rooms — and therefore holes on the wire — come into being.
  const opens = Math.floor(rnd() * 6);
  for (let i = 0; i < opens; i += 1) {
    const ids = allBrackets(f).map((b) => b.id);
    if (ids.length === 0) break;
    const r = deleteBracket(f, ids[Math.floor(rnd() * ids.length)]);
    if (r.ok) f = r.state;
  }
  return f;
}

function allBrackets(f: Forest): Bracket[] {
  const out: Bracket[] = [];
  const walk = (u: Unit): void => {
    if (u.kind === 'leaf') return;
    out.push(u);
    u.left.forEach(walk);
    u.right.forEach(walk);
  };
  f.roots.forEach(walk);
  return out;
}

function countHoles(nodes: readonly TreeNode[]): number {
  let n = 0;
  const walk = (node: TreeNode): void => {
    if (node.kind === 'prop') return;
    if (node.kind === 'hole') n += 1;
    node.children.forEach(walk);
  };
  nodes.forEach(walk);
  return n;
}

/**
 * The stored brackets beside the core brackets they became, in the same
 * traversal — which is well defined precisely because the mapping is
 * structural: a wire bracket's two children ARE its two sides.
 */
function lockstep(nodes: readonly TreeNode[], units: readonly Unit[]): [BracketNode, Bracket][] {
  const pairs: [BracketNode, Bracket][] = [];
  const side = (node: TreeNode, side_: readonly Unit[]): void => {
    if (node.kind === 'hole') {
      expect(node.children).toHaveLength(side_.length);
      node.children.forEach((child, i) => unit(child, side_[i]));
      return;
    }
    expect(side_).toHaveLength(1);
    unit(node, side_[0]);
  };
  const unit = (node: TreeNode, u: Unit): void => {
    if (node.kind === 'prop' || u.kind === 'leaf') {
      expect(node.kind).toBe('prop');
      expect(u.kind).toBe('leaf');
      return;
    }
    if (node.kind !== 'bracket') throw new Error('a hole cannot stand as a unit');
    pairs.push([node, u]);
    expect(node.rel).toBe(u.rel);
    side(node.children[0], u.left);
    side(node.children[1], u.right);
  };
  expect(nodes).toHaveLength(units.length);
  nodes.forEach((node, i) => unit(node, units[i]));
  return pairs;
}
