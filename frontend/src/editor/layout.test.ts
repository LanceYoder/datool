import { describe, expect, it } from 'vitest';
import type { BracketNode, TreeNode } from '../types';
import { COL_W, computeColumns, connectY, layoutBrackets } from './layout';
import type { BracketGeom } from './layout';

// Worked example: 1 John 1:6 — five propositions
//   CndE[ FtIn[ p1, Adv[p2, p3] ], Ser[p4, p5] ]
// CndE and FtIn are subordinate (prominent set); Adv and Ser are coordinate
// (prominent null). Expected columns: Adv 1, Ser 1, FtIn 2, CndE 3.

const p = (ref: string): TreeNode => ({ kind: 'prop', ref });

function buildTree(): BracketNode {
  const adv: BracketNode = { kind: 'bracket', rel: 'Adv', prominent: null, children: [p('p2'), p('p3')] };
  const ser: BracketNode = { kind: 'bracket', rel: 'Ser', prominent: null, children: [p('p4'), p('p5')] };
  const ftIn: BracketNode = { kind: 'bracket', rel: 'FtIn', prominent: 0, children: [p('p1'), adv] };
  const cndE: BracketNode = { kind: 'bracket', rel: 'CndE', prominent: 1, children: [ftIn, ser] };
  return cndE;
}

const rowYs = new Map<string, number>([
  ['p1', 20],
  ['p2', 60],
  ['p3', 100],
  ['p4', 140],
  ['p5', 180],
]);

const X0 = 200;

const labelsFor = (rel: string): string[] | undefined =>
  ({
    CndE: ['If', 'Then'],
    FtIn: ['Ft', 'In'],
    Adv: ['but'],
    Ser: ['S'],
  })[rel];

function geomByRel(rel: string, tree: TreeNode = buildTree()): BracketGeom {
  const layout = layoutBrackets(tree, rowYs, X0, labelsFor);
  const geom = layout.brackets.find((b) => b.rel === rel);
  if (geom === undefined) throw new Error(`no bracket geom for ${rel}`);
  return geom;
}

describe('computeColumns', () => {
  it('assigns column 1 to all-prop brackets and 1 + max(child columns) otherwise', () => {
    const tree = buildTree();
    const ftIn = tree.children[0] as BracketNode;
    const adv = ftIn.children[1] as BracketNode;
    const ser = tree.children[1] as BracketNode;

    const { columns, maxColumn } = computeColumns(tree);
    expect(columns.get(adv)).toBe(1);
    expect(columns.get(ser)).toBe(1);
    expect(columns.get(ftIn)).toBe(2);
    expect(columns.get(tree)).toBe(3);
    expect(maxColumn).toBe(3);
  });

  it('returns maxColumn 0 for a bare proposition tree', () => {
    const { columns, maxColumn } = computeColumns(p('p1'));
    expect(columns.size).toBe(0);
    expect(maxColumn).toBe(0);
  });
});

describe('connectY', () => {
  it('uses the row y-center for propositions', () => {
    expect(connectY(p('p3'), rowYs)).toBe(100);
  });

  it('uses first/last midpoint for coordinate brackets', () => {
    const tree = buildTree();
    const ser = tree.children[1] as BracketNode;
    const adv = (tree.children[0] as BracketNode).children[1] as BracketNode;
    expect(connectY(ser, rowYs)).toBe((140 + 180) / 2); // 160
    expect(connectY(adv, rowYs)).toBe((60 + 100) / 2); // 80
  });

  it('uses the prominent child connection point for subordinate brackets', () => {
    const tree = buildTree();
    const ftIn = tree.children[0] as BracketNode;
    // FtIn prominent = 0 → connects at p1's row
    expect(connectY(ftIn, rowYs)).toBe(20);
    // CndE prominent = 1 → connects at the Ser packet's midpoint (160), not
    // at any single row: the packet side.
    expect(connectY(tree, rowYs)).toBe(160);
  });
});

describe('layoutBrackets geometry', () => {
  it('places vertical lines at x0 - column * COL_W', () => {
    expect(geomByRel('CndE').x).toBe(X0 - 3 * COL_W);
    expect(geomByRel('FtIn').x).toBe(X0 - 2 * COL_W);
    expect(geomByRel('Adv').x).toBe(X0 - 1 * COL_W);
    expect(geomByRel('Ser').x).toBe(X0 - 1 * COL_W);
  });

  it('spans each vertical line from first to last child connection point', () => {
    const cndE = geomByRel('CndE');
    expect(cndE.top).toBe(20); // connectY(FtIn), prominent child p1
    expect(cndE.bottom).toBe(160); // connectY(Ser), coordinate midpoint

    const ftIn = geomByRel('FtIn');
    expect(ftIn.top).toBe(20); // p1 row
    expect(ftIn.bottom).toBe(80); // Adv midpoint

    const ser = geomByRel('Ser');
    expect(ser.top).toBe(140);
    expect(ser.bottom).toBe(180);
  });

  it('draws ticks from each child connection x (child bracket x, or x0 for props)', () => {
    const cndE = geomByRel('CndE');
    expect(cndE.ticks).toHaveLength(2);
    // Child 0 is the FtIn bracket at column 2.
    expect(cndE.ticks[0]).toMatchObject({ y: 20, x1: X0 - 2 * COL_W, x2: X0 - 3 * COL_W });
    // Child 1 is the Ser bracket at column 1, connecting at its midpoint.
    expect(cndE.ticks[1]).toMatchObject({ y: 160, x1: X0 - 1 * COL_W, x2: X0 - 3 * COL_W });

    const ftIn = geomByRel('FtIn');
    // Child 0 is prop p1: tick starts at the text edge x0.
    expect(ftIn.ticks[0]).toMatchObject({ y: 20, x1: X0, x2: X0 - 2 * COL_W });
    // Child 1 is the Adv bracket.
    expect(ftIn.ticks[1]).toMatchObject({ y: 80, x1: X0 - 1 * COL_W, x2: X0 - 2 * COL_W });
  });

  it('stars the prominent child end on subordinate brackets only', () => {
    const cndE = geomByRel('CndE');
    expect(cndE.starChildIndex).toBe(1); // the Ser packet side
    expect(cndE.ticks.map((t) => t.star)).toEqual([false, true]);

    const ftIn = geomByRel('FtIn');
    expect(ftIn.starChildIndex).toBe(0);
    expect(ftIn.ticks.map((t) => t.star)).toEqual([true, false]);

    expect(geomByRel('Adv').starChildIndex).toBeNull();
    expect(geomByRel('Ser').starChildIndex).toBeNull();
  });

  it('places subordinate labels at the bracket ends: labels[0] at children[0] end', () => {
    const cndE = geomByRel('CndE');
    expect(cndE.labels).toEqual([
      { text: 'If', y: 20, placement: 'start' },
      { text: 'Then', y: 160, placement: 'end' },
    ]);
  });

  it('swaps subordinate label ends when reversed', () => {
    const tree = buildTree();
    tree.reversed = true;
    const cndE = geomByRel('CndE', tree);
    expect(cndE.labels).toEqual([
      { text: 'Then', y: 20, placement: 'start' },
      { text: 'If', y: 160, placement: 'end' },
    ]);
  });

  it('places the single coordinate label at the vertical line midpoint', () => {
    expect(geomByRel('Ser').labels).toEqual([{ text: 'S', y: 160, placement: 'mid' }]);
    expect(geomByRel('Adv').labels).toEqual([{ text: 'but', y: 80, placement: 'mid' }]);
  });

  it('renders nothing for empty labels', () => {
    const tree = buildTree();
    const layout = layoutBrackets(tree, rowYs, X0, (rel) =>
      rel === 'CndE' ? ['', 'Then'] : labelsFor(rel),
    );
    const cndE = layout.brackets.find((b) => b.rel === 'CndE');
    expect(cndE?.labels).toEqual([{ text: 'Then', y: 160, placement: 'end' }]);
  });

  it('falls back to the relationship code when no labels are supplied', () => {
    const layout = layoutBrackets(buildTree(), rowYs, X0);
    const ser = layout.brackets.find((b) => b.rel === 'Ser');
    expect(ser?.labels).toEqual([{ text: 'Ser', y: 160, placement: 'mid' }]);
  });

  it('marks review-flagged brackets', () => {
    const tree = buildTree();
    (tree.children[1] as BracketNode).flag = 'review';
    const layout = layoutBrackets(tree, rowYs, X0, labelsFor);
    const flags = new Map(layout.brackets.map((b) => [b.rel, b.review]));
    expect(flags.get('Ser')).toBe(true);
    expect(flags.get('CndE')).toBe(false);
    expect(flags.get('FtIn')).toBe(false);
    expect(flags.get('Adv')).toBe(false);
  });

  it('lists brackets in pre-order and reports maxColumn', () => {
    const layout = layoutBrackets(buildTree(), rowYs, X0, labelsFor);
    expect(layout.brackets.map((b) => b.rel)).toEqual(['CndE', 'FtIn', 'Adv', 'Ser']);
    expect(layout.maxColumn).toBe(3);
  });
});
