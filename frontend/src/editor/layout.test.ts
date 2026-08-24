import { describe, expect, it } from 'vitest';
import type { BracketNode, TreeNode } from '../types';
import {
  COL_W,
  STUB_W,
  computeColumns,
  connectY,
  layoutBrackets,
  layoutDots,
  leafRefs,
  rowBox,
} from './layout';
import type { BracketGeom, DotGeom, RowBox } from './layout';

// Worked example, now as a FOREST of three roots:
//   0: CndE[ FtIn[ p1, Adv[p2, p3] ], Ser[p4, p5] ]
//   1: p6                      (a disconnected proposition)
//   2: Grnd[ p7, p8 ]          (a second connected packet)
// CndE, FtIn and Grnd are subordinate (prominent set); Adv and Ser are
// coordinate (prominent null). Expected columns: Adv 1, Ser 1, Grnd 1,
// FtIn 2, CndE 3 — one shared column grid, so maxColumn is 3 across all roots.

const p = (ref: string): TreeNode => ({ kind: 'prop', ref });

function buildForest(): TreeNode[] {
  const adv: BracketNode = { kind: 'bracket', rel: 'Adv', prominent: null, children: [p('p2'), p('p3')] };
  const ser: BracketNode = { kind: 'bracket', rel: 'Ser', prominent: null, children: [p('p4'), p('p5')] };
  const ftIn: BracketNode = { kind: 'bracket', rel: 'FtIn', prominent: 0, children: [p('p1'), adv] };
  const cndE: BracketNode = { kind: 'bracket', rel: 'CndE', prominent: 1, children: [ftIn, ser] };
  const grnd: BracketNode = { kind: 'bracket', rel: 'Grnd', prominent: 0, children: [p('p7'), p('p8')] };
  return [cndE, p('p6'), grnd];
}

/** The first root on its own — the single-tree case still has to work. */
function buildTree(): BracketNode {
  return buildForest()[0] as BracketNode;
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

const labelsFor = (rel: string): string[] | undefined =>
  ({
    CndE: ['If', 'Then'],
    FtIn: ['Ft', 'In'],
    Adv: ['but'],
    Ser: ['S'],
    Grnd: ['', 'G'],
  })[rel];

function geomByRel(rel: string, forest: readonly TreeNode[] = buildForest()): BracketGeom {
  const layout = layoutBrackets(forest, rows, X0, labelsFor);
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
  it('assigns column 1 to all-prop brackets and 1 + max(child columns) otherwise', () => {
    const forest = buildForest();
    const cndE = forest[0] as BracketNode;
    const ftIn = cndE.children[0] as BracketNode;
    const adv = ftIn.children[1] as BracketNode;
    const ser = cndE.children[1] as BracketNode;
    const grnd = forest[2] as BracketNode;

    const { columns, maxColumn } = computeColumns(forest);
    expect(columns.get(adv)).toBe(1);
    expect(columns.get(ser)).toBe(1);
    expect(columns.get(grnd)).toBe(1); // a shallow root keeps its own depth
    expect(columns.get(ftIn)).toBe(2);
    expect(columns.get(cndE)).toBe(3);
    expect(maxColumn).toBe(3); // deepest across the whole forest
  });

  it('returns maxColumn 0 for a forest of bare propositions', () => {
    const { columns, maxColumn } = computeColumns([p('p1'), p('p2')]);
    expect(columns.size).toBe(0);
    expect(maxColumn).toBe(0);
  });
});

describe('leafRefs', () => {
  it('lists the propositions under a node in order', () => {
    expect(leafRefs(buildTree())).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
    expect(leafRefs(p('p6'))).toEqual(['p6']);
  });
});

describe('connectY', () => {
  it('uses the row y-center for propositions, from boxes or bare centers', () => {
    expect(connectY(p('p3'), rows)).toBe(100);
    expect(connectY(p('p3'), centers)).toBe(100);
  });

  it('uses first/last midpoint for coordinate brackets', () => {
    const tree = buildTree();
    const ser = tree.children[1] as BracketNode;
    const adv = (tree.children[0] as BracketNode).children[1] as BracketNode;
    expect(connectY(ser, rows)).toBe((140 + 180) / 2); // 160
    expect(connectY(adv, rows)).toBe((60 + 100) / 2); // 80
  });

  it('uses the prominent child connection point for subordinate brackets', () => {
    const tree = buildTree();
    const ftIn = tree.children[0] as BracketNode;
    expect(connectY(ftIn, rows)).toBe(20); // prominent 0 → p1's row
    expect(connectY(tree, rows)).toBe(160); // prominent 1 → the Ser packet's midpoint
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

  it('spans each vertical line from first to last child connection point', () => {
    const cndE = geomByRel('CndE');
    expect(cndE.top).toBe(20); // connectY(FtIn), prominent child p1
    expect(cndE.bottom).toBe(160); // connectY(Ser), coordinate midpoint

    const ftIn = geomByRel('FtIn');
    expect(ftIn.top).toBe(20); // p1 row
    expect(ftIn.bottom).toBe(80); // Adv midpoint

    expect(geomByRel('Ser')).toMatchObject({ top: 140, bottom: 180 });
    expect(geomByRel('Grnd')).toMatchObject({ top: 260, bottom: 300 });
  });

  it('draws ticks from each child connection x (child bracket x, or x0 for props)', () => {
    const cndE = geomByRel('CndE');
    expect(cndE.ticks).toHaveLength(2);
    expect(cndE.ticks[0]).toMatchObject({ y: 20, x1: X0 - 2 * COL_W, x2: X0 - 3 * COL_W });
    expect(cndE.ticks[1]).toMatchObject({ y: 160, x1: X0 - 1 * COL_W, x2: X0 - 3 * COL_W });

    const ftIn = geomByRel('FtIn');
    expect(ftIn.ticks[0]).toMatchObject({ y: 20, x1: X0, x2: X0 - 2 * COL_W }); // prop
    expect(ftIn.ticks[1]).toMatchObject({ y: 80, x1: X0 - 1 * COL_W, x2: X0 - 2 * COL_W });
  });

  it('stars the prominent child end on subordinate brackets only', () => {
    expect(geomByRel('CndE').starChildIndex).toBe(1);
    expect(geomByRel('CndE').ticks.map((t) => t.star)).toEqual([false, true]);
    expect(geomByRel('FtIn').starChildIndex).toBe(0);
    expect(geomByRel('FtIn').ticks.map((t) => t.star)).toEqual([true, false]);
    expect(geomByRel('Adv').starChildIndex).toBeNull();
    expect(geomByRel('Ser').starChildIndex).toBeNull();
  });

  it('places subordinate labels at the bracket ends: labels[0] at children[0] end', () => {
    expect(geomByRel('CndE').labels).toEqual([
      { text: 'If', y: 20, placement: 'start' },
      { text: 'Then', y: 160, placement: 'end' },
    ]);
  });

  it('swaps subordinate label ends when the derived reversed flag is set', () => {
    const forest = buildForest();
    (forest[0] as BracketNode).reversed = true;
    expect(geomByRel('CndE', forest).labels).toEqual([
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
      rel === 'CndE' ? ['', 'Then'] : labelsFor(rel),
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

  it('marks review-flagged brackets (color only — no marker geometry)', () => {
    const forest = buildForest();
    ((forest[0] as BracketNode).children[1] as BracketNode).flag = 'review';
    const layout = layoutBrackets(forest, rows, X0, labelsFor);
    const flags = new Map(layout.brackets.map((b) => [b.rel, b.review]));
    expect(flags.get('Ser')).toBe(true);
    expect(flags.get('CndE')).toBe(false);
    expect(flags.get('Grnd')).toBe(false);
  });

  it('lists brackets in document pre-order across the forest and reports maxColumn', () => {
    const layout = layoutBrackets(buildForest(), rows, X0, labelsFor);
    expect(layout.brackets.map((b) => b.rel)).toEqual(['CndE', 'FtIn', 'Adv', 'Ser', 'Grnd']);
    expect(layout.brackets.map((b) => b.preorderIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(layout.brackets.map((b) => b.rootIndex)).toEqual([0, 0, 0, 0, 2]);
    expect(layout.brackets.map((b) => b.root)).toEqual([true, false, false, false, true]);
    expect(layout.maxColumn).toBe(3);
  });

  it('lays a single tree out exactly as before when it is the only root', () => {
    const alone = layoutBrackets([buildTree()], rows, X0, labelsFor);
    expect(alone.brackets.map((b) => b.rel)).toEqual(['CndE', 'FtIn', 'Adv', 'Ser']);
    expect(alone.maxColumn).toBe(3);
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
    const layout = layoutBrackets(buildForest(), centers, X0, labelsFor);
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

  it('emits one dot per proposition and per bracket, in document pre-order', () => {
    expect(dots.map((d) => d.id)).toEqual([
      'bracket:0', // CndE
      'bracket:1', // FtIn
      'prop:p1',
      'bracket:2', // Adv
      'prop:p2',
      'prop:p3',
      'bracket:3', // Ser
      'prop:p4',
      'prop:p5',
      'prop:p6', // the disconnected root
      'bracket:4', // Grnd
      'prop:p7',
      'prop:p8',
    ]);
    // Bracket dot ids index the same pre-order list layoutBrackets emits.
    const brackets = layoutBrackets(buildForest(), rows, X0).brackets;
    expect(dots.filter((d) => d.kind === 'bracket').map((d) => d.id)).toEqual(
      brackets.map((b) => `bracket:${b.preorderIndex}`),
    );
  });

  it('gives a root proposition a stub to the left of its row, with the dot at its far end', () => {
    expect(dotById(dots, 'prop:p6')).toEqual({
      id: 'prop:p6',
      kind: 'prop',
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
    // A nested proposition needs no stub: its tick line runs under the dot.
    expect(dotById(dots, 'prop:p1')).toEqual({
      id: 'prop:p1',
      kind: 'prop',
      x: X0 - STUB_W,
      y: 20,
      root: false,
    });
  });

  it('puts a starred bracket dot at the starred end corner', () => {
    // CndE stars child 1 (the Ser packet, connecting at 160).
    expect(dotById(dots, 'bracket:0')).toEqual({
      id: 'bracket:0',
      kind: 'bracket',
      x: X0 - 3 * COL_W,
      y: 160,
      root: true,
    });
    // FtIn stars child 0 (p1's row).
    expect(dotById(dots, 'bracket:1')).toMatchObject({ y: 20, root: false });
    // Grnd stars child 0 (p7's row) and is a root.
    expect(dotById(dots, 'bracket:4')).toMatchObject({
      x: X0 - COL_W,
      y: 260,
      root: true,
    });
  });

  it('puts a coordinate bracket dot at the spine midpoint', () => {
    expect(dotById(dots, 'bracket:2')).toMatchObject({ y: 80 }); // Adv: (60+100)/2
    expect(dotById(dots, 'bracket:3')).toMatchObject({ y: 160 }); // Ser: (140+180)/2
  });

  it('flags exactly the forest roots with root: true', () => {
    expect(dots.filter((d) => d.root).map((d) => d.id)).toEqual([
      'bracket:0',
      'prop:p6',
      'bracket:4',
    ]);
  });

  it('works from bare row centers too', () => {
    const fromCenters = layoutDots(buildForest(), centers, X0);
    expect(fromCenters).toEqual(dots);
  });

  it('gives every proposition in a fully disconnected forest a root dot with a stub', () => {
    const loose = layoutDots([p('p1'), p('p2'), p('p3')], rows, X0);
    expect(loose).toHaveLength(3);
    expect(loose.every((d) => d.root && d.stubX1 === X0 - STUB_W)).toBe(true);
  });
});
