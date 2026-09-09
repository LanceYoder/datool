import { describe, expect, it } from 'vitest';
import type { TaxonomyEntry } from '../../types';
import type { Bracket, Forest, Leaf, Star, Unit } from '../../tree/core';
import {
  connect,
  deleteBracket,
  formatForest,
  leaf,
  loadForest,
  mergeLeaves,
  settleSide,
  settleTargetFor,
  splitLeaf,
} from '../../tree/core';
import { layoutDots } from '../layout';
import type { RowBox } from '../layout';
import {
  RELATIONSHIP_KEYS,
  canSplitAfter,
  clampPopover,
  dotAddr,
  dotSpanPids,
  groupByFamily,
  mainPointRefs,
  newlyAnchored,
  parseDotId,
  pickupGesture,
  relationshipForKey,
  rowEnglish,
  shortcutFor,
} from '../interaction';
import { WORD_MAP } from './fixtures';
import { TAXONOMY } from './fixtures';

// The same forest layout.test.ts uses, as the CORE model:
//   0: 1 CndE[ 2 FtIn[ p1, 3 Adv[p2, p3] ], 4 Ser[p4, p5] ]
//   1: p6                      (a disconnected proposition)
//   2: 5 Grnd[ p7, p8 ]
const p = (pid: string): Leaf => leaf(pid);

function br(
  id: number,
  rel: string | null,
  star: Star | null,
  left: Unit | Unit[],
  right: Unit | Unit[],
): Bracket {
  return {
    kind: 'bracket',
    id,
    rel,
    star,
    leftHanging: Array.isArray(left),
    rightHanging: Array.isArray(right),
    left: Array.isArray(left) ? left : [left],
    right: Array.isArray(right) ? right : [right],
  };
}

const forestOf = (...roots: Unit[]): Forest => loadForest(roots);

function buildForest(): Forest {
  const adv = br(3, 'Adv', null, p('p2'), p('p3'));
  const ser = br(4, 'Ser', null, p('p4'), p('p5'));
  const ftIn = br(2, 'FtIn', 'left', p('p1'), adv);
  const cndE = br(1, 'CndE', 'right', ftIn, ser);
  const grnd = br(5, 'Grnd', 'left', p('p7'), p('p8'));
  return forestOf(cndE, p('p6'), grnd);
}

const rows = new Map<string, RowBox>(
  ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'].map((ref, i) => {
    const y = 20 + i * 40;
    return [ref, { y, top: y - 15, bottom: y + 15 }];
  }),
);

describe('groupByFamily', () => {
  it('groups the whole taxonomy by family, in first-appearance order', () => {
    const groups = groupByFamily(TAXONOMY);
    expect(groups.map((g) => g.family)).toEqual([
      'coordinate',
      'restatement',
      'distinct',
      'contrary',
    ]);
    expect(groups.map((g) => g.name)).toEqual([
      'Coordinate',
      'Restatement',
      'Distinct statement',
      'Contrary statement',
    ]);
    // Every relationship appears exactly once, in taxonomy order.
    expect(groups.flatMap((g) => g.entries.map((e) => e.code))).toEqual(
      TAXONOMY.map((e) => e.code),
    );
    expect(groups.flatMap((g) => g.entries)).toHaveLength(18);
  });

  it('falls back to the raw family key for an unknown family', () => {
    const odd: TaxonomyEntry = {
      code: 'X',
      name: 'Experimental',
      family: 'experimental',
      symbol: 'X',
      labels: ['X'],
      description: 'An experiment.',
      starredLabel: null,
      coordinate: true,
    };
    const groups = groupByFamily([odd]);
    expect(groups).toEqual([{ family: 'experimental', name: 'experimental', entries: [odd] }]);
  });

  it('returns nothing for an empty taxonomy', () => {
    expect(groupByFamily([])).toEqual([]);
  });
});

describe('parseDotId', () => {
  it('reads the dot grammar of §7.3: prop, bracket and hang', () => {
    expect(parseDotId('prop:p12')).toEqual({ kind: 'prop', pid: 'p12' });
    expect(parseDotId('bracket:0')).toEqual({ kind: 'bracket', id: 0 });
    expect(parseDotId('bracket:7')).toEqual({ kind: 'bracket', id: 7 });
    // §10 A4: a bracket may hang at both ends, so the dot names the SIDE too.
    expect(parseDotId('hang:7:left')).toEqual({ kind: 'hang', id: 7, side: 'left' });
    expect(parseDotId('hang:7:right')).toEqual({ kind: 'hang', id: 7, side: 'right' });
    // A bare 'hang:<id>' — the pre-A4 spelling — still reads, as the left side.
    expect(parseDotId('hang:7')).toEqual({ kind: 'hang', id: 7, side: 'left' });
  });

  it('rejects malformed ids', () => {
    expect(parseDotId('prop:')).toBeNull();
    expect(parseDotId('bracket:')).toBeNull();
    expect(parseDotId('bracket:-1')).toBeNull();
    expect(parseDotId('bracket:1.5')).toBeNull();
    expect(parseDotId('bracket:x')).toBeNull();
    expect(parseDotId('hang:')).toBeNull();
    expect(parseDotId('hang:x')).toBeNull();
    expect(parseDotId('hang:7:middle')).toBeNull();
    expect(parseDotId('hole:0')).toBeNull(); // the old grammar is gone
    expect(parseDotId('p1')).toBeNull();
    expect(parseDotId('')).toBeNull();
  });

  it('round-trips every id layoutDots emits, hanging sides included', () => {
    const withRoom = forestOf(br(9, 'Grnd', 'left', [p('p1'), p('p2')], p('p3')));
    for (const forest of [buildForest(), withRoom]) {
      for (const dot of layoutDots(forest, rows, 200)) {
        expect(parseDotId(dot.id)).not.toBeNull();
      }
    }
  });
});

describe('dotAddr', () => {
  it('gives the core address a dot names', () => {
    expect(dotAddr({ kind: 'prop', pid: 'p1' })).toEqual({ kind: 'leaf', pid: 'p1' });
    expect(dotAddr({ kind: 'bracket', id: 4 })).toEqual({ kind: 'bracket', id: 4 });
  });

  it('gives a room’s pickup dot NONE: a waiting group is not a unit', () => {
    // §1: a hanging side's units are lodgers, unattached to each other. The
    // ops address units, so the group as a whole has no address to connect.
    expect(dotAddr({ kind: 'hang', id: 4, side: 'left' })).toBeNull();
  });
});

// §10 A2's own gesture, and §10 A6's rule about what a refusal may cost.
describe('pickupGesture', () => {
  // Grnd[ ⟨p1⟩, p4 ] — a ONE-LODGER room (§10 A1), the shape A2 settles.
  const room = (): Forest => forestOf(br(9, 'Grnd', 'right', [p('p1')], p('p4')));
  const hang = { kind: 'hang', id: 9, side: 'left' } as const;

  it('is not a pickup gesture at all when neither dot is a pickup dot', () => {
    expect(pickupGesture({ kind: 'prop', pid: 'p1' }, { kind: 'prop', pid: 'p4' }, null))
      .toEqual({ kind: 'none' });
  });

  it('settles the side when the other dot names the room’s SOLE lodger', () => {
    const lodger = settleTargetFor(room(), 9, 'left');
    expect(pickupGesture(hang, { kind: 'prop', pid: 'p1' }, lodger))
      .toEqual({ kind: 'settle', id: 9, side: 'left', keepArmed: false });
    // Either order: the pickup dot may be the armed dot or the target.
    expect(pickupGesture({ kind: 'prop', pid: 'p1' }, hang, lodger))
      .toEqual({ kind: 'settle', id: 9, side: 'left', keepArmed: false });
  });

  it('REFUSES anything else — and the refusal KEEPS the armed dot (§10 A6)', () => {
    // "A refused gesture SHAKES and that is all." Clearing the carried dot
    // would be a second effect, and would make aiming a pickup dot at the
    // wrong lodger cost the pickup as well. Every refusal below keeps it.
    const lodger = settleTargetFor(room(), 9, 'left');
    expect(pickupGesture(hang, { kind: 'prop', pid: 'p4' }, lodger))
      .toEqual({ kind: 'refuse', keepArmed: true });
    // Two pickup dots.
    expect(pickupGesture(hang, { kind: 'hang', id: 9, side: 'right' }, lodger))
      .toEqual({ kind: 'refuse', keepArmed: true });
    // A room still holding a GROUP: the core answers with no lodger at all,
    // because there is still assembling to do (§10 A2).
    const group = forestOf(br(9, 'Grnd', 'right', [p('p1'), p('p2')], p('p4')));
    expect(pickupGesture(hang, { kind: 'prop', pid: 'p1' }, settleTargetFor(group, 9, 'left')))
      .toEqual({ kind: 'refuse', keepArmed: true });
  });
});

// §5.2's first signal. Q5 abolished lifting — a dot names EXACTLY its unit —
// which is only legible if the span it names can be seen before it is armed.
describe('dotSpanPids', () => {
  it('gives a proposition dot its own one row, and nothing else', () => {
    expect(dotSpanPids(buildForest(), { kind: 'prop', pid: 'p3' })).toEqual(['p3']);
  });

  it('gives a bracket dot the WHOLE span its bracket covers', () => {
    const forest = buildForest(); // CndE[ FtIn[p1, Adv[p2,p3]], Ser[p4,p5] ], p6, Grnd[p7,p8]
    expect(dotSpanPids(forest, { kind: 'bracket', id: 3 })).toEqual(['p2', 'p3']);
    expect(dotSpanPids(forest, { kind: 'bracket', id: 2 })).toEqual(['p1', 'p2', 'p3']);
    expect(dotSpanPids(forest, { kind: 'bracket', id: 1 })).toEqual([
      'p1', 'p2', 'p3', 'p4', 'p5',
    ]);
    // The last leaf of a packet is still just that leaf: no lifting (Q5).
    expect(dotSpanPids(forest, { kind: 'prop', pid: 'p5' })).toEqual(['p5']);
  });

  it('gives a room’s pickup dot the LODGERS it is still assembling', () => {
    // Grnd[ ⟨p1 Ser[p2,p3]⟩, p4 ]: the room's span is its lodgers', not the
    // bracket's — the handle is about the group, not the relationship.
    const inner = br(8, 'Ser', null, p('p2'), p('p3'));
    const forest = forestOf(br(9, 'Grnd', 'right', [p('p1'), inner], p('p4')));
    expect(dotSpanPids(forest, { kind: 'hang', id: 9, side: 'left' })).toEqual([
      'p1', 'p2', 'p3',
    ]);
    expect(dotSpanPids(forest, { kind: 'hang', id: 9, side: 'right' })).toEqual([]);
    expect(dotSpanPids(forest, { kind: 'bracket', id: 9 })).toEqual([
      'p1', 'p2', 'p3', 'p4',
    ]);
  });

  it('highlights nothing for a dot whose unit is gone, or a bracket that hangs nowhere', () => {
    const forest = buildForest();
    expect(dotSpanPids(forest, { kind: 'prop', pid: 'nope' })).toEqual([]);
    expect(dotSpanPids(forest, { kind: 'bracket', id: 99 })).toEqual([]);
    expect(dotSpanPids(forest, { kind: 'hang', id: 99, side: 'left' })).toEqual([]);
    // Adv hangs nowhere, so neither of its sides names a group.
    expect(dotSpanPids(forest, { kind: 'hang', id: 3, side: 'left' })).toEqual([]);
  });

  it('names a contiguous run of the forest’s leaf order, always (I4)', () => {
    const forest = buildForest();
    const order = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
    for (const dot of layoutDots(forest, rows, 200)) {
      const ref = parseDotId(dot.id);
      expect(ref).not.toBeNull();
      const pids = dotSpanPids(forest, ref!);
      expect(pids.length).toBeGreaterThan(0);
      const at = order.indexOf(pids[0]!);
      expect(order.slice(at, at + pids.length)).toEqual(pids);
    }
  });
});

// §5.2's third signal: completion is an event, not an absence. No op sets out
// to anchor a side, so the two states are the only witness.
describe('newlyAnchored', () => {
  /** Grnd[ ⟨a b⟩, c ] — one room, waiting to be assembled. */
  const waiting = (): Forest =>
    forestOf(br(1, 'Grnd', 'right', [p('a'), p('b')], p('c')));

  it('says NOTHING for a join inside a room: §10 A1 anchors nothing', () => {
    const before = waiting();
    const after = connect(before, { kind: 'leaf', pid: 'a' }, { kind: 'leaf', pid: 'b' });
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    // The room is down to one lodger and is STILL a room — v3's E1 celebration
    // was exactly the auto-completion the analyst overruled.
    expect(formatForest(after.state)).toBe('[Grnd[⟨Ser[a, b]⟩, c]]');
    expect(newlyAnchored(before, after.state)).toEqual([]);
  });

  it('reports the bracket the SETTLE gesture made whole (§10 A2)', () => {
    const before = forestOf(br(1, 'Grnd', 'right', [p('a')], p('c')));
    const after = settleSide(before, 1, 'left');
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(formatForest(after.state)).toBe('[Grnd[a, c]]');
    expect(newlyAnchored(before, after.state)).toEqual([1]);
  });

  it('says nothing when a gesture leaves the room a room', () => {
    // A third lodger: the join takes two of them and the side still hangs.
    const before = forestOf(br(1, 'Grnd', 'right', [p('a'), p('b'), p('c')], p('d')));
    const after = connect(before, { kind: 'leaf', pid: 'a' }, { kind: 'leaf', pid: 'b' });
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(newlyAnchored(before, after.state)).toEqual([]);
  });

  it('says nothing when a gesture OPENS a room instead — the signal is completion', () => {
    const before = forestOf(br(1, 'Grnd', 'right', p('a'), p('b')));
    const after = splitLeaf(before, 'b', 'b2'); // Q4: the side hangs, awaiting reassembly
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(formatForest(after.state)).toBe('[Grnd[a, ⟨b b2⟩]]');
    expect(newlyAnchored(before, after.state)).toEqual([]);
  });

  it('does not congratulate a bracket that DIED, however few units it left', () => {
    const before = waiting();
    const after = deleteBracket(before, 1);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(newlyAnchored(before, after.state)).toEqual([]);
  });

  it('says nothing for a merge that fuses a room\'s last two lodgers either (A1)', () => {
    const before = waiting(); // Grnd[ ⟨a b⟩, c ]
    const after = mergeLeaves(before, 'a');
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(formatForest(after.state)).toBe('[Grnd[⟨a⟩, c]]');
    expect(newlyAnchored(before, after.state)).toEqual([]);
  });

  it('is empty — and cheap — when nothing was hanging to begin with', () => {
    const before = buildForest();
    expect(newlyAnchored(before, before)).toEqual([]);
    expect(newlyAnchored(before, forestOf(p('p1')))).toEqual([]);
  });
});

describe('mainPointRefs', () => {
  it('star-walks a complete single tree: starred sides, whole coordinate packets', () => {
    // Root CndE stars its right side (the coordinate Ser packet), so the walk
    // fans out over Ser's two propositions.
    const tree = buildForest().roots[0]!;
    expect(mainPointRefs(forestOf(tree))).toEqual(['p4', 'p5']);
  });

  it('follows a chain of starred sides to a single proposition', () => {
    const inner = br(2, 'Grnd', 'left', p('x'), p('y'));
    const root = br(1, 'CndE', 'right', p('w'), inner);
    expect(mainPointRefs(forestOf(root))).toEqual(['x']);
  });

  it('is empty while the analysis is incomplete (many roots, or a bare proposition)', () => {
    expect(mainPointRefs(buildForest())).toEqual([]); // three roots
    expect(mainPointRefs(forestOf(p('p1')))).toEqual([]); // one root, but no tree
    expect(mainPointRefs({ roots: [], nextId: 1 })).toEqual([]);
  });

  it('is empty while ANY SIDE HANGS — §7.11’s replacement for "any hole"', () => {
    // One tree over every proposition, but an edit is half-made inside it:
    // what the tree supports is not decided yet, so nothing is the main point.
    const room = br(2, 'Ser', null, [p('a'), p('b')], p('c'));
    expect(mainPointRefs(forestOf(br(1, 'Grnd', 'right', p('w'), room)))).toEqual([]);
    // A one-lodger room is still a room, so still no main point (§10 A1).
    const assembled = br(2, 'Ser', null, [br(3, 'Ser', null, p('a'), p('b'))], p('c'));
    expect(mainPointRefs(forestOf(br(1, 'Grnd', 'right', p('w'), assembled)))).toEqual([]);
    // Settle it — the analyst's own gesture — and the walk runs again.
    const settled = br(2, 'Ser', null, br(3, 'Ser', null, p('a'), p('b')), p('c'));
    expect(mainPointRefs(forestOf(br(1, 'Grnd', 'right', p('w'), settled)))).toEqual([
      'a', 'b', 'c',
    ]);
  });

  it('keeps walking through a coordinate fan — Progression included', () => {
    // Every coordinate fans and the walk continues inside each member (the
    // Mark 4:10–12 diagram highlights BOTH members of its final P). Mirrors
    // the server's main_point.
    const grnd = br(2, 'Grnd', 'left', p('a'), p('b'));
    const prog = br(3, 'Prog', null, p('c'), p('d'));
    expect(mainPointRefs(forestOf(br(1, 'Ser', null, grnd, prog)))).toEqual(['a', 'c', 'd']);
  });
});

describe('rowEnglish', () => {
  // Fixture words: 124771–124783 verse 6 (124776 has eng: null), then a gap,
  // then 124789–124791 verse 7; eng is 'e<index>' elsewhere.

  it("joins the row's own words' contextual English, marking the verse start", () => {
    expect(rowEnglish(124771, 124773, WORD_MAP)).toEqual([
      {
        marker: 6,
        tokens: [
          { text: 'e124771', index: 124771 },
          { text: 'e124772', index: 124772 },
          { text: 'e124773', index: 124773 },
        ],
      },
    ]);
  });

  it('gives a mid-verse row bare text — no verse marker', () => {
    expect(rowEnglish(124777, 124779, WORD_MAP)).toEqual([
      {
        marker: null,
        tokens: [
          { text: 'e124777', index: 124777 },
          { text: 'e124778', index: 124778 },
          { text: 'e124779', index: 124779 },
        ],
      },
    ]);
  });

  it('starts a marked segment where a new verse begins inside the row', () => {
    expect(rowEnglish(124782, 124791, WORD_MAP)).toEqual([
      {
        marker: null,
        tokens: [
          { text: 'e124782', index: 124782 },
          { text: 'e124783', index: 124783 },
        ],
      },
      {
        marker: 7,
        tokens: [
          { text: 'e124789', index: 124789 },
          { text: 'e124790', index: 124790 },
          { text: 'e124791', index: 124791 },
        ],
      },
    ]);
  });

  it('skips words with no aligned rendering and empty rows', () => {
    expect(rowEnglish(124775, 124777, WORD_MAP)).toEqual([
      {
        marker: null,
        tokens: [
          { text: 'e124775', index: 124775 },
          { text: 'e124777', index: 124777 }, // 124776 is null
        ],
      },
    ]);
    expect(rowEnglish(124776, 124776, WORD_MAP)).toEqual([]);
    expect(rowEnglish(200000, 200002, WORD_MAP)).toEqual([]); // outside the map
  });
});

describe('clampPopover', () => {
  const size = { width: 100, height: 50 };
  const bounds = { width: 400, height: 300 };

  it('leaves a box that already fits where it is', () => {
    expect(clampPopover({ x: 40, y: 60 }, size, bounds)).toEqual({ x: 40, y: 60 });
  });

  it('pulls a box back inside the right and bottom edges', () => {
    expect(clampPopover({ x: 380, y: 290 }, size, bounds)).toEqual({ x: 296, y: 246 });
  });

  it('never places a box past the top-left margin', () => {
    expect(clampPopover({ x: -50, y: -10 }, size, bounds)).toEqual({ x: 4, y: 4 });
  });

  it('falls back to the margin when the box is bigger than the container', () => {
    expect(clampPopover({ x: 10, y: 10 }, { width: 500, height: 400 }, bounds)).toEqual({
      x: 4,
      y: 4,
    });
  });
});

describe('canSplitAfter', () => {
  it('offers a split after every word but the last', () => {
    expect(canSplitAfter(0, 3)).toBe(true);
    expect(canSplitAfter(1, 3)).toBe(true);
    expect(canSplitAfter(2, 3)).toBe(false);
  });

  it('rejects out-of-range and one-word rows', () => {
    expect(canSplitAfter(-1, 3)).toBe(false);
    expect(canSplitAfter(0, 1)).toBe(false);
    expect(canSplitAfter(0, 0)).toBe(false);
    expect(canSplitAfter(1.5, 5)).toBe(false);
  });
});

describe('relationship shortcuts', () => {
  it('gives every relationship in the taxonomy its own key', () => {
    const keys = TAXONOMY.map((entry) => shortcutFor(entry.code));
    expect(keys.every((key) => key !== null)).toBe(true);
    expect(new Set(keys).size).toBe(TAXONOMY.length);
  });

  it('has no shortcut for a code outside the taxonomy', () => {
    expect(shortcutFor('Nope')).toBeNull();
  });

  it('reads a typed key back to its relationship, either case', () => {
    expect(relationshipForKey('g', TAXONOMY)).toBe('Grnd');
    expect(relationshipForKey('G', TAXONOMY)).toBe('Grnd');
    expect(relationshipForKey('s', TAXONOMY)).toBe('Ser');
    // Punctuation keys carry the relationships whose SYMBOL is the handle.
    expect(relationshipForKey('/', TAXONOMY)).toBe('Cmp');
    expect(relationshipForKey('?', TAXONOMY)).toBe('CndE');
    expect(relationshipForKey('c', TAXONOMY)).toBe('CE');
    expect(relationshipForKey('&', TAXONOMY)).toBeNull();
  });

  it('ignores a key whose relationship the taxonomy does not carry', () => {
    const withoutGround = TAXONOMY.filter((entry) => entry.code !== 'Grnd');
    expect(RELATIONSHIP_KEYS.Grnd).toBe('g');
    expect(relationshipForKey('g', withoutGround)).toBeNull();
  });
});
