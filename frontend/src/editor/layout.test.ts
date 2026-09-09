import { describe, expect, it } from 'vitest';
import type { Bracket, Forest, Leaf, Star, Unit } from '../tree/core';
import { leaf, leavesOf, loadForest } from '../tree/core';
import {
  COL_W,
  HANG_W,
  LABEL_BOX_INSET,
  LABEL_BOX_LIFT,
  LABEL_BOX_SIDE,
  LABEL_GUTTER,
  LABEL_LANE_W,
  LANE_CLEAR,
  MID_LANE_W,
  MIN_TEXT_W,
  ORNAMENT_CLEAR,
  STAR_GAP,
  STAR_R,
  STUB_W,
  TEXT_CLEAR,
  bracketWidth,
  computeColumns,
  connectY,
  isClearOfInk,
  labelBox,
  labelInkWidth,
  layoutBrackets,
  layoutDots,
  marginInk,
  rowBox,
  starBox,
  starCenterX,
  starCenterY,
  treeViewportWidth,
} from './layout';
import type { BracketGeom, DotGeom, Rect, RelInfo, RowBox } from './layout';
import { DROLLERY_H, DROLLERY_INSET, DROLLERY_W, drolleryPerches } from './Drolleries';

// The layout consumes the CORE model now (spec §7.8), so the fixtures are core
// forests: brackets are BINARY with two SIDES, an ARRAY on a side is that side's
// ROOM — hanging, at any count (§10 A1) — and the star is 'left' | 'right' |
// null rather than a child index. Ids are written out here rather than minted,
// because the dot grammar ('bracket:<id>', 'hang:<id>:<side>') is what the
// assertions read.

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

// Worked example, a FOREST of three roots (ids in pre-order):
//   0: 1 CndE[ 2 FtIn[ p1, 3 Adv[p2, p3] ], 4 Ser[p4, p5] ]
//   1: p6                      (a disconnected proposition)
//   2: 5 Grnd[ p7, p8 ]        (a second connected packet)
// CndE, FtIn and Grnd are subordinate (starred); Adv and Ser are coordinate
// (star null). Expected columns: Adv 1, Ser 1, Grnd 1, FtIn 2, CndE 3 — one
// shared column grid, so maxColumn is 3 across all roots.

const CND_E = 1;
const FT_IN = 2;
const ADV = 3;
const SER = 4;
const GRND = 5;

function buildForest(cndEStar: Star = 'right'): Forest {
  const adv = br(ADV, 'Adv', null, p('p2'), p('p3'));
  const ser = br(SER, 'Ser', null, p('p4'), p('p5'));
  const ftIn = br(FT_IN, 'FtIn', 'left', p('p1'), adv);
  const cndE = br(CND_E, 'CndE', cndEStar, ftIn, ser);
  const grnd = br(GRND, 'Grnd', 'left', p('p7'), p('p8'));
  return forestOf(cndE, p('p6'), grnd);
}

/** The first root on its own — the single-tree case still has to work. */
function buildTree(): Bracket {
  return buildForest().roots[0] as Bracket;
}

const ROW_H = 30;

/** Measured rows: 30px tall, centers 40px apart. */
const rows = new Map<string, RowBox>(
  ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'].map((ref, i) => {
    const y = 20 + i * 40;
    return [ref, { y, top: y - ROW_H / 2, bottom: y + ROW_H / 2 }];
  }),
);

/** The same rows as bare centers — the shorthand form of the input. */
const centers = new Map<string, number>([...rows].map(([ref, box]) => [ref, box.y]));

const X0 = 200;

/**
 * The taxonomy, as the layout asks it: the labels, and the two facts the
 * DERIVED `reversed` comes from (§1's follow-on ruling). Every subordinate
 * here stars its own default end, so nothing is reversed unless a test moves
 * the star — which is exactly how reversal happens in the app.
 */
const relFor = (rel: string): RelInfo | undefined =>
  ({
    CndE: { labels: ['If', 'Then'], starredLabel: 1, coordinate: false },
    FtIn: { labels: ['Ft', 'In'], starredLabel: 0, coordinate: false },
    Adv: { labels: ['but'], starredLabel: null, coordinate: true },
    Ser: { labels: ['S'], starredLabel: null, coordinate: true },
    Grnd: { labels: ['', 'G'], starredLabel: 0, coordinate: false },
  })[rel];

function geomByRel(rel: string, forest: Forest = buildForest()): BracketGeom {
  const layout = layoutBrackets(forest, rows, X0, relFor);
  const geom = layout.brackets.find((b) => b.rel === rel);
  if (geom === undefined) throw new Error(`no bracket geom for ${rel}`);
  return geom;
}

function dotById(dots: readonly DotGeom[], id: string): DotGeom {
  const dot = dots.find((d) => d.id === id);
  if (dot === undefined) throw new Error(`no dot '${id}'`);
  return dot;
}

describe('computeColumns', () => {
  it('assigns column 1 to leaf-over-leaf brackets and 1 + max(side) otherwise', () => {
    const { columns, maxColumn } = computeColumns(buildForest());
    expect(columns.get(ADV)).toBe(1);
    expect(columns.get(SER)).toBe(1);
    expect(columns.get(GRND)).toBe(1); // a shallow root keeps its own depth
    expect(columns.get(FT_IN)).toBe(2);
    expect(columns.get(CND_E)).toBe(3);
    expect(maxColumn).toBe(3); // deepest across the whole forest
  });

  it('returns maxColumn 0 for a forest of bare propositions', () => {
    const { columns, maxColumn } = computeColumns(forestOf(p('p1'), p('p2')));
    expect(columns.size).toBe(0);
    expect(maxColumn).toBe(0);
  });
});

describe('leavesOf', () => {
  it('lists the propositions under a unit in order', () => {
    expect(leavesOf(buildTree())).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
    expect(leavesOf(p('p6'))).toEqual(['p6']);
  });
});

describe('connectY', () => {
  it('uses the row y-center for propositions, from boxes or bare centers', () => {
    expect(connectY(p('p3'), rows)).toBe(100);
    expect(connectY(p('p3'), centers)).toBe(100);
  });

  it('uses the two sides’ midpoint for coordinate brackets', () => {
    const tree = buildTree();
    const ser = tree.right[0] as Bracket;
    const adv = (tree.left[0] as Bracket).right[0] as Bracket;
    expect(connectY(ser, rows)).toBe((140 + 180) / 2); // 160
    expect(connectY(adv, rows)).toBe((60 + 100) / 2); // 80
  });

  it('uses the starred side’s connection point for subordinate brackets', () => {
    const tree = buildTree();
    const ftIn = tree.left[0] as Bracket;
    expect(connectY(ftIn, rows)).toBe(20); // star 'left' → p1's row
    expect(connectY(tree, rows)).toBe(160); // star 'right' → the Ser packet
  });
});

describe('layoutBrackets geometry', () => {
  it('places vertical lines at x0 - column * COL_W across every root', () => {
    expect(geomByRel('CndE').x).toBe(X0 - 3 * COL_W);
    expect(geomByRel('FtIn').x).toBe(X0 - 2 * COL_W);
    expect(geomByRel('Adv').x).toBe(X0 - 1 * COL_W);
    expect(geomByRel('Ser').x).toBe(X0 - 1 * COL_W);
    expect(geomByRel('Grnd').x).toBe(X0 - 1 * COL_W);
  });

  it('spans each vertical line from the left side’s point to the right side’s', () => {
    const cndE = geomByRel('CndE');
    expect(cndE.top).toBe(20); // connectY(FtIn), starred side p1
    expect(cndE.bottom).toBe(160); // connectY(Ser), coordinate midpoint

    const ftIn = geomByRel('FtIn');
    expect(ftIn.top).toBe(20); // p1 row
    expect(ftIn.bottom).toBe(80); // Adv midpoint

    expect(geomByRel('Ser')).toMatchObject({ top: 140, bottom: 180 });
    expect(geomByRel('Grnd')).toMatchObject({ top: 260, bottom: 300 });
  });

  it('draws ticks from each side’s connection x (child bracket x, or x0 for leaves)', () => {
    const cndE = geomByRel('CndE');
    expect(cndE.ticks).toHaveLength(2);
    expect(cndE.ticks[0]).toMatchObject({
      side: 'left', y: 20, x1: X0 - 2 * COL_W, x2: X0 - 3 * COL_W,
    });
    expect(cndE.ticks[1]).toMatchObject({
      side: 'right', y: 160, x1: X0 - 1 * COL_W, x2: X0 - 3 * COL_W,
    });

    const ftIn = geomByRel('FtIn');
    expect(ftIn.ticks[0]).toMatchObject({ y: 20, x1: X0, x2: X0 - 2 * COL_W }); // leaf
    expect(ftIn.ticks[1]).toMatchObject({ y: 80, x1: X0 - 1 * COL_W, x2: X0 - 2 * COL_W });
  });

  it('stars the starred side on subordinate brackets only', () => {
    expect(geomByRel('CndE').starSide).toBe('right');
    expect(geomByRel('CndE').ticks.map((t) => t.star)).toEqual([false, true]);
    expect(geomByRel('FtIn').starSide).toBe('left');
    expect(geomByRel('FtIn').ticks.map((t) => t.star)).toEqual([true, false]);
    expect(geomByRel('Adv').starSide).toBeNull();
    expect(geomByRel('Ser').starSide).toBeNull();
  });

  it('places subordinate labels at the bracket ends: labels[0] at the left end', () => {
    expect(geomByRel('CndE').labels).toEqual([
      { text: 'If', y: 20, placement: 'start' },
      { text: 'Then', y: 160, placement: 'end' },
    ]);
  });

  it('swaps subordinate label ends when the DERIVED reversed comes out true', () => {
    // Nothing is stored: moving the star to the end that is not the taxonomy's
    // default (CndE stars labels[1]) is what reverses the labels, and the core's
    // own `reversedOf` is what says so.
    expect(geomByRel('CndE', buildForest('left')).labels).toEqual([
      { text: 'Then', y: 20, placement: 'start' },
      { text: 'If', y: 160, placement: 'end' },
    ]);
  });

  it('places the single coordinate label at the vertical line midpoint', () => {
    expect(geomByRel('Ser').labels).toEqual([{ text: 'S', y: 160, placement: 'mid' }]);
    expect(geomByRel('Adv').labels).toEqual([{ text: 'but', y: 80, placement: 'mid' }]);
  });

  it('renders nothing for empty labels', () => {
    expect(geomByRel('Grnd').labels).toEqual([{ text: 'G', y: 300, placement: 'end' }]);
    const layout = layoutBrackets(buildForest(), rows, X0, (rel) =>
      rel === 'CndE' ? { labels: ['', 'Then'], starredLabel: 1, coordinate: false } : relFor(rel),
    );
    expect(layout.brackets.find((b) => b.rel === 'CndE')?.labels).toEqual([
      { text: 'Then', y: 160, placement: 'end' },
    ]);
  });

  it('falls back to the relationship code when no labels are supplied', () => {
    const layout = layoutBrackets(buildForest(), rows, X0);
    expect(layout.brackets.find((b) => b.rel === 'Ser')?.labels).toEqual([
      { text: 'Ser', y: 160, placement: 'mid' },
    ]);
  });

  it('writes no LETTERS on a bracket the menu has not labeled yet (ruling Q6)', () => {
    // Every connect mints `rel: null`: the join is real and has no name, so the
    // spine draws and the letters wait. It must not fall back to a code.
    const fresh = forestOf(br(9, null, null, p('p1'), p('p2')));
    const [geom] = layoutBrackets(fresh, rows, X0, relFor).brackets;
    expect(geom?.rel).toBeNull();
    expect(geom?.starSide).toBeNull();
    expect(geom?.ticks.map((t) => t.y)).toEqual([20, 60]);
    // ...but it DOES get its label box, empty. Q6 requires a choice, and the
    // relationship menu opens from a label box and nowhere else: an unlabeled
    // bracket with no anchor is a bracket that can never be named, and (since
    // the wire cannot spell it) freezes the draft with it.
    expect(geom?.labels).toEqual([{ text: '', y: 40, placement: 'mid' }]);
  });

  it('keeps the empty box exactly where a coordinate label would go', () => {
    // Same anchor as the named case, so naming the bracket moves nothing: the
    // letters simply appear in the box that was already standing there.
    const fresh = forestOf(br(9, null, null, p('p1'), p('p2')));
    const named = forestOf(br(9, 'Ser', null, p('p1'), p('p2')));
    const [before] = layoutBrackets(fresh, rows, X0, relFor).brackets;
    const [after] = layoutBrackets(named, rows, X0, relFor).brackets;
    expect(before?.labels[0]?.placement).toBe(after?.labels[0]?.placement);
    expect(before?.labels[0]?.y).toBe(after?.labels[0]?.y);
  });

  it('lists brackets in document pre-order across the forest and reports maxColumn', () => {
    const layout = layoutBrackets(buildForest(), rows, X0, relFor);
    expect(layout.brackets.map((b) => b.rel)).toEqual(['CndE', 'FtIn', 'Adv', 'Ser', 'Grnd']);
    expect(layout.brackets.map((b) => b.bracketId)).toEqual([CND_E, FT_IN, ADV, SER, GRND]);
    expect(layout.brackets.map((b) => b.preorderIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(layout.brackets.map((b) => b.rootIndex)).toEqual([0, 0, 0, 0, 2]);
    expect(layout.brackets.map((b) => b.root)).toEqual([true, false, false, false, true]);
    expect(layout.maxColumn).toBe(3);
  });

  it('lays a single tree out exactly as before when it is the only root', () => {
    const alone = layoutBrackets(forestOf(buildTree()), rows, X0, relFor);
    expect(alone.brackets.map((b) => b.rel)).toEqual(['CndE', 'FtIn', 'Adv', 'Ser']);
    expect(alone.maxColumn).toBe(3);
  });

  it('draws a same-relationship chain as the real NESTING it is (§7.8)', () => {
    // The n-ary drawing paths are gone: three Sers in a row are three spines in
    // three columns, not one flattened spine with three ticks.
    const chain = forestOf(
      br(1, 'Ser', null, br(2, 'Ser', null, br(3, 'Ser', null, p('p1'), p('p2')), p('p3')), p('p4')),
    );
    const layout = layoutBrackets(chain, rows, X0, relFor);
    expect(layout.brackets.map((b) => b.column)).toEqual([3, 2, 1]);
    expect(layout.brackets.every((b) => b.ticks.length === 2)).toBe(true);
  });
});

describe('layoutBrackets hit rectangles', () => {
  it('spans from the spine to x0, and from its first row top to its last row bottom', () => {
    // CndE covers p1..p5: 5 .. 195.
    expect(geomByRel('CndE').rect).toEqual({
      x: X0 - 3 * COL_W,
      y: 5,
      width: 3 * COL_W,
      height: 190,
    });
    // FtIn covers p1..p3: 5 .. 115.
    expect(geomByRel('FtIn').rect).toEqual({
      x: X0 - 2 * COL_W,
      y: 5,
      width: 2 * COL_W,
      height: 110,
    });
  });

  it('nests inner rects strictly inside their ancestors so the innermost wins a click', () => {
    const outer = geomByRel('CndE').rect;
    const inner = geomByRel('Adv').rect;
    expect(inner.x).toBeGreaterThan(outer.x);
    expect(inner.x + inner.width).toBe(outer.x + outer.width); // both reach x0
    expect(inner.y).toBeGreaterThanOrEqual(outer.y);
    expect(inner.y + inner.height).toBeLessThanOrEqual(outer.y + outer.height);
  });

  it('gives every root its own rect, unaffected by the other roots', () => {
    expect(geomByRel('Grnd').rect).toEqual({
      x: X0 - COL_W,
      y: 245, // p7 top
      width: COL_W,
      height: 70, // through p8's bottom
    });
  });

  it('collapses to the span between row centers when only centers are measured', () => {
    const layout = layoutBrackets(buildForest(), centers, X0, relFor);
    const ser = layout.brackets.find((b) => b.rel === 'Ser');
    expect(ser?.rect).toEqual({ x: X0 - COL_W, y: 140, width: COL_W, height: 40 });
  });
});

describe('rowBox', () => {
  it('expands a bare center into a zero-height box and falls back to zero', () => {
    expect(rowBox(centers, 'p2')).toEqual({ y: 60, top: 60, bottom: 60 });
    expect(rowBox(rows, 'p2')).toEqual({ y: 60, top: 45, bottom: 75 });
    expect(rowBox(rows, 'missing')).toEqual({ y: 0, top: 0, bottom: 0 });
  });
});

describe('layoutDots', () => {
  const dots = layoutDots(buildForest(), rows, X0);

  it('emits one dot per unit, in document pre-order, keyed by CORE ID', () => {
    expect(dots.map((d) => d.id)).toEqual([
      `bracket:${CND_E}`,
      `bracket:${FT_IN}`,
      'prop:p1',
      `bracket:${ADV}`,
      'prop:p2',
      'prop:p3',
      `bracket:${SER}`,
      'prop:p4',
      'prop:p5',
      'prop:p6', // the disconnected root
      `bracket:${GRND}`,
      'prop:p7',
      'prop:p8',
    ]);
    // Bracket dots name the same brackets layoutBrackets emits geometry for.
    const brackets = layoutBrackets(buildForest(), rows, X0).brackets;
    expect(dots.filter((d) => d.kind === 'bracket').map((d) => d.id)).toEqual(
      brackets.map((b) => `bracket:${b.bracketId}`),
    );
  });

  it('gives a root proposition a stub to the left of its row, with the dot at its far end', () => {
    expect(dotById(dots, 'prop:p6')).toEqual({
      id: 'prop:p6',
      kind: 'prop',
      ref: 'p6',
      x: X0 - STUB_W,
      y: 220,
      root: true,
      stubX1: X0 - STUB_W,
      stubX2: X0,
    });
  });

  it('keeps EVERY proposition dot at the same fixed distance from the text column', () => {
    // Nesting depth varies from 0 (p6) to 3 (p2, p3) — the dot x never does.
    for (const ref of ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']) {
      expect(dotById(dots, `prop:${ref}`).x).toBe(X0 - STUB_W);
    }
    // A committed proposition needs no stub: its tick line runs under the dot.
    expect(dotById(dots, 'prop:p1')).toEqual({
      id: 'prop:p1',
      kind: 'prop',
      ref: 'p1',
      x: X0 - STUB_W,
      y: 20,
      root: false,
    });
  });

  it('puts a starred bracket dot at the starred end corner', () => {
    // CndE stars its right side (the Ser packet, connecting at 160).
    expect(dotById(dots, `bracket:${CND_E}`)).toEqual({
      id: `bracket:${CND_E}`,
      kind: 'bracket',
      ref: CND_E,
      x: X0 - 3 * COL_W,
      y: 160,
      root: true,
    });
    // FtIn stars its left side (p1's row).
    expect(dotById(dots, `bracket:${FT_IN}`)).toMatchObject({ y: 20, root: false });
    // Grnd stars its left side (p7's row) and is a root.
    expect(dotById(dots, `bracket:${GRND}`)).toMatchObject({
      x: X0 - COL_W,
      y: 260,
      root: true,
    });
  });

  it('puts a coordinate bracket dot at the spine midpoint', () => {
    expect(dotById(dots, `bracket:${ADV}`)).toMatchObject({ y: 80 }); // (60+100)/2
    expect(dotById(dots, `bracket:${SER}`)).toMatchObject({ y: 160 }); // (140+180)/2
  });

  it('flags exactly the FREE units with root: true', () => {
    expect(dots.filter((d) => d.root).map((d) => d.id)).toEqual([
      `bracket:${CND_E}`,
      'prop:p6',
      `bracket:${GRND}`,
    ]);
  });

  it('works from bare row centers too', () => {
    const fromCenters = layoutDots(buildForest(), centers, X0);
    expect(fromCenters).toEqual(dots);
  });

  it('gives every proposition in a fully disconnected forest a root dot with a stub', () => {
    const loose = layoutDots(forestOf(p('p1'), p('p2'), p('p3')), rows, X0);
    expect(loose).toHaveLength(3);
    expect(loose.every((d) => d.root && d.stubX1 === X0 - STUB_W)).toBe(true);
  });
});

describe('a hanging side: the group still being assembled', () => {
  const rows = new Map([
    ['a', 10],
    ['b', 30],
    ['c', 50],
  ]);
  // Grnd[ ⟨a b⟩, c ] — the relationship that joined a and b is gone, so the
  // Grnd's left side holds two LODGERS and hangs.
  const ROOM = 7;
  const grnd = (): Forest => forestOf(br(ROOM, 'Grnd', 'left', [p('a'), p('b')], p('c')));

  it('holds the column its relationship held, so nothing else moves', () => {
    // Grnd[⟨a b⟩, c] came from Grnd[ Ser[a,b], c ]: the room stands in Ser's
    // column, so deleting Ser moved nothing on the page.
    const { columns, maxColumn } = computeColumns(grnd());
    expect(maxColumn).toBe(2);
    expect(columns.get(ROOM)).toBe(2);
    // The room itself draws no spine, so it is in no column map of its own.
    expect(columns.size).toBe(1);
  });

  it('draws no bracket for the room, and leaves the tick that points at it hanging', () => {
    const { brackets } = layoutBrackets(grnd(), rows, 500);
    expect(brackets).toHaveLength(1); // the room draws nothing
    const [toRoom, toC] = brackets[0]!.ticks;
    expect(toRoom?.hanging).toBe(true);
    expect(toC?.hanging).toBe(false);
    // The hanging tick stops short instead of reaching the text column.
    expect(toRoom!.x1).toBeLessThan(500 - COL_W + HANG_W + 1);
    expect(toC!.x1).toBe(500);
  });

  it('gives every LODGER a loose dot, ready to be picked up', () => {
    const dots = layoutDots(grnd(), rows, 500);
    const byId = new Map(dots.map((d) => [d.id, d]));
    expect(byId.get('prop:a')?.root).toBe(true);
    expect(byId.get('prop:b')?.root).toBe(true);
    expect(byId.get('prop:c')?.root).toBe(false); // committed to the Grnd
    expect(byId.get('prop:a')?.stubX1).toBeDefined();
  });

  it('puts a pickup dot where the hanging tick stops, named by ITS BRACKET', () => {
    const dots = layoutDots(grnd(), rows, 500);
    const end = dots.find((d) => d.kind === 'hang');
    expect(end).toBeDefined();
    // §10 A4 lets a bracket hang at BOTH ends, so the dot names the SIDE too.
    expect(end!.id).toBe(`hang:${ROOM}:left`);
    expect(end!.ref).toBe(ROOM);
    expect(end!.side).toBe('left');
    expect(end!.root).toBe(true); // hanging from nothing yet
    // It sits at the end of the tick that points at it, not on the spine.
    const { brackets } = layoutBrackets(grnd(), rows, 500);
    const hanging = brackets[0]!.ticks.find((t) => t.hanging)!;
    expect(end!.x).toBe(hanging.x1);
    expect(end!.y).toBe(hanging.y);
  });

  it('gives a group hanging from nothing no pickup dot at all', () => {
    // Once its bracket is gone the lodgers are simply roots: they carry their
    // own dots, and there is no tick left to hold a handle.
    const dots = layoutDots(forestOf(p('a'), p('b')), rows, 500);
    expect(dots.find((d) => d.kind === 'hang')).toBeUndefined();
    expect(dots.map((d) => d.id)).toEqual(['prop:a', 'prop:b']);
  });
});

describe('the two shapes §10 added: ⟨x⟩ and hanging at both ends', () => {
  const rows = new Map([
    ['a', 10],
    ['b', 30],
    ['c', 50],
    ['d', 70],
  ]);

  it('draws a ONE-LODGER room as a tick, a pickup dot, and the lodger (A1)', () => {
    // FtIn[⟨Ser[a,b]⟩, c]: the analyst assembled the group and has not
    // finished the bracket. It must draw exactly as a room of two does.
    const f = forestOf(br(7, 'FtIn', 'right', [br(8, 'Ser', null, p('a'), p('b'))], p('c')));
    const { brackets } = layoutBrackets(f, rows, 500);
    const ft = brackets.find((b) => b.bracketId === 7)!;
    const [toRoom, toC] = ft.ticks;
    expect(toRoom!.hanging).toBe(true);
    expect(toC!.hanging).toBe(false);
    // The tick stops just off the spine, exactly as a two-lodger room's does.
    expect(toRoom!.x1).toBe(ft.x + HANG_W);
    // …and the Ser inside it still draws its own spine and dot.
    expect(brackets.map((b) => b.bracketId)).toEqual([7, 8]);
    const dots = layoutDots(f, rows, 500);
    expect(dots.map((d) => d.id)).toContain('hang:7:left');
    expect(dots.map((d) => d.id)).toContain('bracket:8');
    // The lone lodger is FREE: it is a lodger, not a committed member.
    expect(dots.find((d) => d.id === 'bracket:8')?.root).toBe(true);
    expect(dots.find((d) => d.id === 'prop:c')?.root).toBe(false);
  });

  it('draws a bracket hanging at BOTH ends: two ticks, two pickup dots (A4)', () => {
    const f = forestOf(br(7, 'Grnd', 'left', [p('a'), p('b')], [p('c'), p('d')]));
    const { brackets } = layoutBrackets(f, rows, 500);
    expect(brackets).toHaveLength(1);
    const geom = brackets[0]!;
    expect(geom.ticks.map((t) => t.hanging)).toEqual([true, true]);
    // Both ticks stop off the spine; neither reaches the text column.
    for (const t of geom.ticks) expect(t.x1).toBe(geom.x + HANG_W);
    // The spine runs between the two rooms' own middles.
    expect(geom.top).toBe(20);
    expect(geom.bottom).toBe(60);
    const dots = layoutDots(f, rows, 500);
    expect(dots.filter((d) => d.kind === 'hang').map((d) => d.id)).toEqual([
      'hang:7:left',
      'hang:7:right',
    ]);
    // Every one of the four lodgers is free, and none of them is a member.
    for (const pid of ['a', 'b', 'c', 'd']) {
      expect(dots.find((d) => d.id === `prop:${pid}`)?.root).toBe(true);
    }
  });

  it('carries ONE side of a two-hanging bracket, leaving the other where it was', () => {
    const f = forestOf(br(7, 'Grnd', 'left', [p('a'), p('b')], [p('c'), p('d')]));
    const carry = { bracketId: 7, side: 'right' as const, x: 120, y: 300 };
    const geom = layoutBrackets(f, rows, 500, undefined, COL_W, carry).brackets[0]!;
    expect(geom.top).toBe(20); // the left room stayed put
    expect(geom.bottom).toBe(300); // the right one is at the pointer
    const dots = layoutDots(f, rows, 500, COL_W, carry);
    expect(dots.find((d) => d.id === 'hang:7:right')).toMatchObject({ x: 120, y: 300 });
    expect(dots.find((d) => d.id === 'hang:7:left')?.y).toBe(20);
  });

  it('keeps the deleted bracket\'s column, at both ends (nothing else moves)', () => {
    // Grnd[Ser[a,b], Ser[c,d]] is column 2. Delete BOTH inner Sers and the
    // Grnd stays in column 2: each room holds the place its relationship held.
    const whole = forestOf(
      br(7, 'Grnd', 'left', br(8, 'Ser', null, p('a'), p('b')), br(9, 'Ser', null, p('c'), p('d'))),
    );
    const gutted = forestOf(br(7, 'Grnd', 'left', [p('a'), p('b')], [p('c'), p('d')]));
    expect(computeColumns(whole).columns.get(7)).toBe(2);
    expect(computeColumns(gutted).columns.get(7)).toBe(2);
    expect(computeColumns(gutted).maxColumn).toBe(2);
    expect(bracketWidth(whole)).toBe(bracketWidth(gutted));
  });
});

describe('a carried end flexes the tree', () => {
  const rows = new Map([
    ['a', 10],
    ['b', 30],
    ['c', 50],
  ]);
  const ROOM = 7;
  const grnd = (): Forest => forestOf(br(ROOM, 'Grnd', 'left', [p('a'), p('b')], p('c')));
  const carry = { bracketId: ROOM, side: 'left' as const, x: 120, y: 300 };

  it('stretches the bracket to wherever the end is carried', () => {
    const resting = layoutBrackets(grnd(), rows, 500).brackets[0]!;
    expect(resting.top).toBe(20); // the room's own middle: (10 + 30) / 2
    expect(resting.bottom).toBe(50);

    const carried = layoutBrackets(grnd(), rows, 500, undefined, COL_W, carry).brackets[0]!;
    expect(carried.top).toBe(300); // the spine now reaches the pointer
    expect(carried.bottom).toBe(50);
    // Its tick reaches all the way out to the pointer, not to its resting stop.
    const tick = carried.ticks.find((t) => t.hanging)!;
    expect(tick.x1).toBe(120);
    expect(tick.y).toBe(300);
  });

  it('moves the connection point above it, so the tree flexes in turn', () => {
    // Grnd stars its LEFT side — the room — so where the room goes, Grnd's own
    // connection point goes, and whatever holds Grnd follows.
    const resting = layoutBrackets(grnd(), rows, 500).brackets[0]!;
    const carried = layoutBrackets(grnd(), rows, 500, undefined, COL_W, carry).brackets[0]!;
    expect(resting.connectY).toBe(20);
    expect(carried.connectY).toBe(300);
  });

  it('carries the loose end’s dot with it', () => {
    const dots = layoutDots(grnd(), rows, 500, COL_W, carry);
    const end = dots.find((d) => d.kind === 'hang')!;
    expect([end.x, end.y]).toEqual([120, 300]);
  });

  it('leaves a bracket that is not the carried one exactly where it was', () => {
    // Carry names ONE bracket's hanging side; nothing else may move.
    const two = forestOf(
      br(ROOM, 'Grnd', 'left', [p('a'), p('b')], p('c')),
      br(8, 'Ser', null, p('d'), p('e')),
    );
    const withRows = new Map([...rows, ['d', 70], ['e', 90]]);
    const resting = layoutBrackets(two, withRows, 500).brackets[1]!;
    const carried = layoutBrackets(two, withRows, 500, undefined, COL_W, carry).brackets[1]!;
    expect(carried).toEqual(resting);
  });
});

// ---------------------------------------------------------------------------
// A tree wider than the window.
//
// It used to be cleared: a document that arrived with a tree the window could
// not draw lost every connection, and the analyzer's proposal was stored
// without its connections in the first place. Neither happens now. The tree is
// always laid out at its full natural width, and the margin it is drawn in
// becomes a VIEWPORT the tree scrolls sideways inside — the text column never
// moves, whatever the tree does.

/** A right-leaning spine `depth` brackets deep: maxColumn === depth. */
function deepForest(depth: number): Forest {
  let node: Unit = p('d0');
  for (let i = 1; i <= depth; i += 1) {
    node = br(i, 'Ser', null, node, p(`d${i}`));
  }
  return forestOf(node);
}

/** Rows for a deep forest's leaves, 40px apart. */
function deepRows(depth: number): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 0; i <= depth; i += 1) out.set(`d${i}`, 20 + i * 40);
  return out;
}

const DEEP = 20;
const SHELL_W = 1200;

describe('a tree wider than the window', () => {
  it('keeps every connection: the layout draws them all, at full width', () => {
    const forest = deepForest(DEEP);
    const natural = bracketWidth(forest);
    // Wider than any part of this window could show it...
    expect(natural).toBe(DEEP * COL_W + LABEL_GUTTER);
    expect(natural).toBeGreaterThan(SHELL_W - MIN_TEXT_W);

    // ...and every one of its brackets is still laid out.
    const layout = layoutBrackets(forest, deepRows(DEEP), natural);
    expect(layout.brackets).toHaveLength(DEEP);
    expect(layout.maxColumn).toBe(DEEP);
    // Nothing is squeezed: the columns keep their full spacing, and the
    // outermost spine stands a gutter in from the tree's left edge.
    const xs = layout.brackets.map((b) => b.x).sort((a, b) => a - b);
    expect(xs[0]).toBe(LABEL_GUTTER);
    expect(xs[xs.length - 1]).toBe(natural - COL_W);
  });

  it('shows what the window can and leaves the rest to scroll', () => {
    const natural = bracketWidth(deepForest(DEEP)); // 1896
    const viewport = treeViewportWidth(natural, SHELL_W, 72);
    // The text keeps its readable column; the tree's viewport takes the rest.
    expect(viewport).toBe(SHELL_W - MIN_TEXT_W);
    expect(SHELL_W - viewport).toBe(MIN_TEXT_W);
    // What is left over is what the reader scrolls to reach — derived, not
    // written down, so that widening a column moves the scroll and not a test.
    expect(natural - viewport).toBe(DEEP * COL_W + LABEL_GUTTER - (SHELL_W - MIN_TEXT_W));
  });

  it('is read from its RIGHT edge: the columns grow leftward from the text', () => {
    const forest = deepForest(DEEP);
    const natural = bracketWidth(forest);
    const layout = layoutBrackets(forest, deepRows(DEEP), natural);
    const byColumn = new Map(layout.brackets.map((b) => [b.column, b.x]));
    // Column 1 — the innermost relationship, the one nearest the words it
    // joins — sits hard against the text; the outermost spine is furthest
    // left. So the scroll container opens at scrollLeft = max: the far-left
    // spine is what scrolls INTO view, not what is shown first.
    expect(byColumn.get(1)).toBe(natural - COL_W);
    expect(byColumn.get(DEEP)).toBe(natural - DEEP * COL_W);
    expect(byColumn.get(1)!).toBeGreaterThan(byColumn.get(DEEP)!);
  });
});

describe('treeViewportWidth', () => {
  it('gives a tree that fits its whole width — nothing scrolls, nothing moves', () => {
    // The worked example is three columns deep: well inside the centered half,
    // so the viewport is that half exactly, as it always was.
    const natural = bracketWidth(buildForest());
    expect(natural).toBe(3 * COL_W + LABEL_GUTTER);
    const centered = Math.round(SHELL_W / 2 - 72 / 2);
    expect(treeViewportWidth(natural, SHELL_W, 72)).toBe(centered);
    // And a tree deeper than the centered half but still within the window
    // keeps opening the margin, exactly as before: it does not start to
    // scroll until the text is down to its minimum.
    const wide = SHELL_W - MIN_TEXT_W - 8;
    expect(treeViewportWidth(wide, SHELL_W, 72)).toBe(wide);
  });

  it('stops at the text’s minimum column and hands the rest to the scroller', () => {
    expect(treeViewportWidth(5000, SHELL_W, 72)).toBe(SHELL_W - MIN_TEXT_W);
  });

  it('keeps the centered half on a window too narrow to give the text its own', () => {
    // Below ~768px the centered half is already wider than what MIN_TEXT_W
    // would leave; the layout's own anchor wins and the tree scrolls sooner.
    const narrow = 700;
    const centered = Math.round(narrow / 2 - 72 / 2);
    expect(centered).toBeGreaterThan(narrow - MIN_TEXT_W);
    expect(treeViewportWidth(5000, narrow, 72)).toBe(centered);
    expect(treeViewportWidth(100, narrow, 72)).toBe(centered);
  });
});

// ---------------------------------------------------------------------------
// The label box — the one hitbox every relationship label is written in.
//
// It is a single hardcoded size, so what has to be proved here is that the
// size is the RIGHT one: wide enough for the widest thing the taxonomy can
// write in it, and small enough that two of them fit in every column with the
// lines, the dots and the stars still clear.

/**
 * Every label the taxonomy can put on a page: the `labels` tuples in
 * da/taxonomy.py, with the empty ends dropped (an empty label draws nothing —
 * Ground's starred end is a bare star). A CLOSED set, which is what lets the
 * box be a constant instead of a measurement.
 */
const TAXONOMY_LABELS = [
  'S', 'P', 'Alt', // coordinate
  'W', 'Ed', '//', '-', '+', 'Gn', 'Sp', 'Ft', 'In', // support by restatement
  'G', '∴', 'C', 'E', 'C?', 'M', 'T', 'L', // support by distinct statement
  'Adv', 'Q', 'A', 'S', 'R', // support by contrary statement
];

/** How far apart two rectangles are horizontally; negative when they overlap. */
function xGap(a: Rect, b: Rect): number {
  return Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width));
}

/** Whether two rectangles' vertical spans meet at all. */
function yOverlap(a: Rect, b: Rect): boolean {
  return a.y < b.y + b.height && b.y < a.y + a.height;
}

/** One thing drawn in a column's lanes: what it is, and where. */
interface Placed {
  what: 'box' | 'star';
  column: number;
  rect: Rect;
}

/** Every label box in a layout, tagged with the column it was drawn in. */
function boxesOf(brackets: readonly BracketGeom[]): { column: number; box: Rect }[] {
  return brackets.flatMap((b) =>
    b.labels.map((l) => ({ column: b.column, box: labelBox(b.x, l.y, l.placement) })),
  );
}

/**
 * Every box AND every star a layout draws, tagged with its column. A star is
 * as much a thing in the lane as a box is — leaving them out of the overlap
 * arithmetic is exactly how a star came to be drawn inside the box of the
 * bracket one column in.
 */
function placedOf(brackets: readonly BracketGeom[]): Placed[] {
  const out: Placed[] = [];
  for (const b of brackets) {
    for (const l of b.labels) {
      out.push({ what: 'box', column: b.column, rect: labelBox(b.x, l.y, l.placement) });
    }
    for (const t of b.ticks) {
      if (!t.star) continue;
      const labelled = b.labels.some((l) => l.placement !== 'mid' && l.y === t.y);
      out.push({ what: 'star', column: b.column, rect: starBox(b.x, t.y, labelled) });
    }
  }
  return out;
}

/**
 * The tightest proposition row this app sets, measured in the browser: the
 * Original skin's two-line row (a verse label above the Greek) comes out at
 * 49.2px, and every other skin and setting is taller. A label box reaches
 * LABEL_BOX_LIFT + LABEL_BOX_SIDE above its own line, so this is the number
 * that says whether the square may grow again.
 */
const MIN_ROW_PITCH = 48;

/**
 * A right-leaning spine `depth` deep, subordinate twice and coordinate once,
 * over and over. Each level's start label lands on the level below it — a
 * coordinate bracket connects from its own midpoint, which is where that
 * bracket writes its single label — so the two lanes of a column are both
 * occupied AT THE SAME y, which is the case the marks have to survive.
 *
 * The period is three rather than two so that the fixture produces BOTH
 * neighbourings: a subordinate beside a coordinate (an end label's star
 * against the next column's mid box — the "★S" case), and a subordinate
 * beside a subordinate (star against star). At period two the second pair
 * never occurs, and a star-vs-star sweep would have had nothing to check.
 */
function deepMixedForest(depth: number): Forest {
  let node: Unit = p('d0');
  for (let i = 1; i <= depth; i += 1) {
    const coordinate = i % 3 === 0;
    node = br(i, coordinate ? 'Ser' : 'FtIn', coordinate ? null : 'left', node, p(`d${i}`));
  }
  return forestOf(node);
}

describe('the label box', () => {
  it('is a SQUARE — the same measure on both axes', () => {
    const box = labelBox(0, 100, 'start');
    expect(box.width).toBe(box.height);
    expect(box.width).toBe(LABEL_BOX_SIDE);
  });

  it('is one size, and every label in the taxonomy fits it (user ruling: TIGHT)', () => {
    // The side is the original rectangle's height and the letters nearly
    // fill it (user ruling, 2026-08-29): at least a hair of estimated air —
    // LABEL_CHAR_W/COMPACT_CHAR_W deliberately over-estimate, so 1px here
    // is a couple of real pixels on screen.
    for (const text of TAXONOMY_LABELS) {
      expect(LABEL_BOX_SIDE - labelInkWidth(text)).toBeGreaterThanOrEqual(1);
    }
    // The widest at its own setting is a two-letter 13px code; the
    // three-letter codes drop to the compact face precisely so they fit the
    // same square (isCompactLabel), and the 20px marks still take less.
    const widest = Math.max(...TAXONOMY_LABELS.map(labelInkWidth));
    expect(widest).toBeGreaterThan(labelInkWidth('∴'));
    // ...and the box is sized to THAT, not comfortably past it: the letters
    // are meant to look boxed, not framed.
    expect(LABEL_BOX_SIDE - widest).toBeLessThanOrEqual(8);
  });

  it('stands clear of the spine it belongs to, on whichever side it hangs', () => {
    const { brackets } = layoutBrackets(buildForest(), rows, X0, relFor);
    for (const b of brackets) {
      for (const l of b.labels) {
        const box = labelBox(b.x, l.y, l.placement);
        const clearance =
          l.placement === 'mid' ? b.x - (box.x + box.width) : box.x - b.x;
        expect(clearance).toBeGreaterThanOrEqual(2);
        // A mid label hangs left of its spine, towards the parent its line
        // reaches out to; the end labels sit to the right of it.
        expect(box.x < b.x).toBe(l.placement === 'mid');
      }
    }
  });

  it('stands clear of the line it is written above, and of the dot on it', () => {
    const box = labelBox(0, 100, 'start');
    // Its bottom edge, not its baseline: the box is what must not touch the
    // tick line the label names. The square grew UPWARDS, so this is the one
    // clearance the taller box did not change.
    expect(100 - (box.y + box.height)).toBe(LABEL_BOX_LIFT);
    expect(LABEL_BOX_LIFT).toBeGreaterThanOrEqual(2);
    // A bracket's dot sits ON the spine at the same y as its starred end's
    // label (r 5, and 6.5 while the pointer is on it). The box clears it
    // VERTICALLY, so it never has to dodge sideways for it.
    expect(LABEL_BOX_LIFT).toBeGreaterThan(6.5);
  });

  it('does not reach into the row above it, tall as it now is', () => {
    // A box stands LIFT + SIDE above its own line, and the line above it is
    // another proposition's. At the tightest row this app sets, the square
    // still stops a clear lane short of it.
    expect(LABEL_BOX_LIFT + LABEL_BOX_SIDE + LANE_CLEAR).toBeLessThanOrEqual(
      MIN_ROW_PITCH,
    );
    // And that is a real constraint, not a formality: a square much bigger
    // than this one would be in the row above.
    expect(LABEL_BOX_LIFT + LABEL_BOX_SIDE).toBeGreaterThan(MIN_ROW_PITCH / 2);
  });

  it('is the same box wherever it is drawn — that is the whole point', () => {
    const { brackets } = layoutBrackets(buildForest(), rows, X0, relFor);
    const sizes = new Set(
      boxesOf(brackets).map(({ box }) => `${box.width}x${box.height}`),
    );
    expect([...sizes]).toEqual([`${LABEL_BOX_SIDE}x${LABEL_BOX_SIDE}`]);
  });
});

// ---------------------------------------------------------------------------
// The column, and what has to fit in it.
//
// COL_W is not a number chosen by eye any more: it is the sum of the two lanes
// a column carries plus the air between them. These are the sums.

describe('the column width', () => {
  it('is exactly the lanes it has to hold, and is derived from them', () => {
    expect(LABEL_LANE_W).toBe(LABEL_BOX_INSET + LABEL_BOX_SIDE + STAR_GAP + 2 * STAR_R);
    expect(MID_LANE_W).toBe(LABEL_BOX_INSET + LABEL_BOX_SIDE);
    expect(COL_W).toBe(LABEL_LANE_W + LANE_CLEAR + MID_LANE_W);
    // The arithmetic that used to fail: a labelled star reaches LABEL_LANE_W
    // out from its spine, and the next spine in hangs its own box MID_LANE_W
    // back over the same column. Both have to fit, with air.
    expect(LABEL_LANE_W + MID_LANE_W).toBeLessThanOrEqual(COL_W - LANE_CLEAR);
  });

  it('leaves the innermost column the same air before the words as before a neighbour', () => {
    expect(TEXT_CLEAR).toBe(COL_W - LABEL_LANE_W);
    expect(TEXT_CLEAR).toBe(LANE_CLEAR + MID_LANE_W);
    expect(TEXT_CLEAR).toBeGreaterThanOrEqual(LABEL_BOX_INSET + LABEL_BOX_SIDE);
  });

  it('reserves room at the OUTER edge for the outermost bracket’s own label', () => {
    // bracketWidth puts the outermost spine LABEL_GUTTER in from the tree's
    // left edge; a coordinate bracket there hangs its box back over that
    // gutter, and a drollery perches in the same lane. Both have to land
    // inside the tree, or the viewport cuts them the moment it scrolls.
    expect(LABEL_GUTTER).toBeGreaterThanOrEqual(MID_LANE_W + LANE_CLEAR);
    expect(LABEL_GUTTER).toBeGreaterThanOrEqual(
      DROLLERY_INSET + DROLLERY_W + ORNAMENT_CLEAR,
    );
  });

  it('keeps the innermost lane clear of the proposition dot AND of the text', () => {
    const forest = deepMixedForest(6);
    const natural = bracketWidth(forest);
    const { brackets } = layoutBrackets(forest, deepRows(6), natural, relFor);
    // Nothing a column-1 bracket draws may reach the words. This is the
    // assertion that a clipped box would have failed.
    for (const { rect } of placedOf(brackets)) {
      expect(rect.x + rect.width).toBeLessThanOrEqual(natural - LANE_CLEAR);
      // ...nor off the front of the tree, at the other end.
      expect(rect.x).toBeGreaterThanOrEqual(0);
    }
    // The proposition dot stands at x0 - STUB_W with a 6.5 hover ring; the
    // innermost star stops short of it too.
    const innermost = natural - COL_W;
    expect(starCenterX(innermost, true) + STAR_R).toBeLessThanOrEqual(
      natural - STUB_W - 6.5,
    );
  });
});

// ---------------------------------------------------------------------------
// Nothing overlaps anything.
//
// The pairwise sweep is over boxes AND stars, in both directions: box-vs-box,
// star-vs-box and star-vs-star. The middle one is what let "★S" happen — a
// star drawn a gap past its own box landed inside the coordinate label of the
// column in from it, because only the boxes were ever compared.

describe('the margin never draws two things on top of each other', () => {
  const depth = 12;
  const forest = deepMixedForest(depth);
  const natural = bracketWidth(forest);
  const { brackets } = layoutBrackets(forest, deepRows(depth), natural, relFor);
  const placed = placedOf(brackets);

  it('has a fixture that really does stack two columns on one line', () => {
    let stacked = 0;
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = placed[i]!;
        const b = placed[j]!;
        if (Math.abs(a.column - b.column) !== 1) continue;
        if (yOverlap(a.rect, b.rect)) stacked += 1;
      }
    }
    expect(stacked).toBeGreaterThan(0);
  });

  it.each([
    ['box', 'box'],
    ['star', 'box'],
    ['star', 'star'],
  ] as const)('keeps every %s clear of every %s across columns', (one, two) => {
    let checked = 0;
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = placed[i]!;
        const b = placed[j]!;
        const pair = [a.what, b.what].sort().join('/');
        if (pair !== [one, two].slice().sort().join('/')) continue;
        if (!yOverlap(a.rect, b.rect)) continue;
        checked += 1;
        expect(xGap(a.rect, b.rect)).toBeGreaterThanOrEqual(LANE_CLEAR);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('draws no two marks over each other ANYWHERE in the tree', () => {
    // The same sweep with no column filter at all — the sanity net.
    const clash: string[] = [];
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = placed[i]!;
        const b = placed[j]!;
        if (!yOverlap(a.rect, b.rect)) continue;
        if (xGap(a.rect, b.rect) < 0) {
          clash.push(`${a.what}@${a.rect.x},${a.rect.y} × ${b.what}@${b.rect.x},${b.rect.y}`);
        }
      }
    }
    expect(clash).toEqual([]);
  });
});

describe('the star', () => {
  it('keeps a clear gap past the box, never over its letters', () => {
    const box = labelBox(0, 100, 'start');
    const star = starCenterX(0, true);
    expect(star - STAR_R - (box.x + box.width)).toBe(STAR_GAP);
    expect(STAR_GAP).toBeGreaterThanOrEqual(2);
  });

  it('shares the box’s centre line, so the two read as one row', () => {
    const box = labelBox(0, 100, 'start');
    expect(starCenterY(100)).toBe(box.y + box.height / 2);
  });

  it('stands IN the box’s place at an end that shows no letters', () => {
    // Ground renders `* → G`: its starred end is a bare star, and it stands
    // where its letters would have, not out in the middle of the tick.
    const box = labelBox(0, 100, 'start');
    expect(starCenterX(0, false)).toBe(box.x + box.width / 2);
    expect(starCenterX(0, false)).toBeLessThan(starCenterX(0, true));
  });

  it('can stand in the box’s place because nothing else can reach there', () => {
    // The bare star keeps box-center placement rather than taking the
    // STAR_GAP offset, and this is why it may: at COL_W the nearest mark any
    // other bracket can put in that lane is the next spine's mid box, and it
    // starts well past where a bare star ends.
    const bare = starBox(0, 100, false);
    expect(bare.x + bare.width).toBeLessThan(COL_W - MID_LANE_W - LANE_CLEAR);
    // Nor can it reach the label lane of its own column...
    expect(bare.x).toBeGreaterThanOrEqual(LABEL_BOX_INSET);
    expect(bare.x + bare.width).toBeLessThanOrEqual(LABEL_BOX_INSET + LABEL_BOX_SIDE);
  });

  it('never coincides with another bracket’s box, bare or labelled', () => {
    // Both kinds of star in one tree: with FtIn's starred end writing nothing
    // its star is bare, while the Sers still write their coordinate labels.
    const forest = deepMixedForest(10);
    const natural = bracketWidth(forest);
    const bare = layoutBrackets(forest, deepRows(10), natural, (rel) =>
      rel === 'FtIn' ? { labels: ['', 'In'], starredLabel: 0, coordinate: false } : relFor(rel),
    );
    const placed = placedOf(bare.brackets);
    expect(placed.some((q) => q.what === 'star')).toBe(true);
    for (const a of placed) {
      if (a.what !== 'star') continue;
      for (const b of placed) {
        if (b.what !== 'box') continue;
        if (!yOverlap(a.rect, b.rect)) continue;
        expect(xGap(a.rect, b.rect)).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The margin's decoration yields.

describe('drolleries', () => {
  const depth = 12;
  const forest = deepMixedForest(depth);
  const natural = bracketWidth(forest);
  const rowsFor = deepRows(depth);
  const { brackets } = layoutBrackets(forest, rowsFor, natural, relFor);
  const dots = layoutDots(forest, rowsFor, natural);
  const ink = marginInk(brackets, dots);
  const perches = drolleryPerches(brackets, ink);

  it('still puts creatures in the margin — yielding is not refusing', () => {
    expect(perches.length).toBeGreaterThan(0);
  });

  it('stands clear of every label box, star and dot', () => {
    for (const perch of perches) {
      const box = { x: perch.x, y: perch.y, width: DROLLERY_W, height: DROLLERY_H };
      for (const mark of ink.marks) {
        expect(xGap(box, mark) >= ORNAMENT_CLEAR || !yOverlap(box, mark)).toBe(true);
      }
    }
  });

  it('has no spine or tick struck through it', () => {
    for (const perch of perches) {
      const box = { x: perch.x, y: perch.y, width: DROLLERY_W, height: DROLLERY_H };
      expect(isClearOfInk(box, ink)).toBe(true);
    }
  });

  it('perches in the lane left of its spine, inside the tree', () => {
    for (const perch of perches) {
      expect(perch.x).toBeGreaterThanOrEqual(0);
      expect(perch.x + DROLLERY_W).toBeLessThanOrEqual(natural);
    }
  });

  it('refuses a perch the tree has already written in', () => {
    // A tree whose every corner is busy gets no creatures at all, rather than
    // creatures over its letters. Feed the placer ink that covers the margin.
    const everywhere = marginInk(brackets, dots);
    everywhere.marks.push({ x: 0, y: -1e4, width: natural, height: 2e4 });
    expect(drolleryPerches(brackets, everywhere)).toEqual([]);
  });

  it('is stable: the same tree gets the same creatures in the same places', () => {
    expect(drolleryPerches(brackets, ink)).toEqual(perches);
  });
});
