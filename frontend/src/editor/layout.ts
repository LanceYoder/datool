// Deterministic bracket layout for discourse-analysis trees.
//
// Pure functions only — no DOM. The caller measures a y-center for each
// proposition row and supplies the text column's left edge (x0); this module
// turns the tree into drawable geometry. Shared by the read-only viewer and
// the editor overlay so both always agree.

import type { BracketNode, TreeNode } from '../types';

/** Horizontal distance between adjacent bracket columns, in px. */
export const COL_W = 34;

/** Amber used for brackets flagged for review. */
export const REVIEW_COLOR = '#b45309';

/**
 * Whether a bracket is coordinate. Per the document invariant, `prominent`
 * is null exactly when the relationship is coordinate, so the tree itself
 * carries the answer (no taxonomy lookup needed for geometry).
 */
export function isCoordinate(node: BracketNode): boolean {
  return node.prominent === null || node.prominent === undefined;
}

export interface ColumnResult {
  /** Column per bracket node (keyed by node object identity). */
  columns: Map<BracketNode, number>;
  /** Deepest column in the tree; 0 when the tree is a bare proposition. */
  maxColumn: number;
}

/**
 * column(bracket) = its height above the leaves: brackets whose children are
 * all props get column 1; otherwise 1 + max(child columns).
 */
export function computeColumns(tree: TreeNode): ColumnResult {
  const columns = new Map<BracketNode, number>();
  let maxColumn = 0;

  const visit = (node: TreeNode): number => {
    if (node.kind === 'prop') return 0;
    let deepest = 0;
    for (const child of node.children) {
      deepest = Math.max(deepest, visit(child));
    }
    const col = deepest + 1;
    columns.set(node, col);
    if (col > maxColumn) maxColumn = col;
    return col;
  };

  visit(tree);
  return { columns, maxColumn };
}

/**
 * The y at which a node connects to its parent:
 *  - prop: its measured row y-center;
 *  - coordinate bracket: midpoint of first/last child connection points;
 *  - subordinate bracket: the prominent child's connection point.
 */
export function connectY(node: TreeNode, rowYs: ReadonlyMap<string, number>): number {
  if (node.kind === 'prop') {
    return rowYs.get(node.ref) ?? 0;
  }
  const first = node.children[0];
  const last = node.children[node.children.length - 1];
  if (first === undefined || last === undefined) return 0; // violates invariant; be safe
  if (!isCoordinate(node)) {
    const idx = node.prominent;
    if (idx !== null && idx !== undefined) {
      const target = node.children[idx];
      if (target !== undefined) return connectY(target, rowYs);
    }
  }
  return (connectY(first, rowYs) + connectY(last, rowYs)) / 2;
}

/** One horizontal tick from a child's connection point to the bracket's line. */
export interface Tick {
  childIndex: number;
  y: number;
  /** x of the child's connection point: x(child bracket), or x0 for props. */
  x1: number;
  /** x of this bracket's vertical line. */
  x2: number;
  /** True on the prominent child's tick — render a '*' at this end. */
  star: boolean;
}

export interface LabelAnchor {
  text: string;
  y: number;
  /**
   * 'start' = first-child end, 'end' = last-child end (subordinate brackets),
   * 'mid' = vertical line midpoint (coordinate brackets).
   */
  placement: 'start' | 'end' | 'mid';
}

export interface BracketGeom {
  node: BracketNode;
  rel: string;
  column: number;
  /** x of the vertical line: x0 - column * colW. */
  x: number;
  /** connectY(first child) — top of the vertical line. */
  top: number;
  /** connectY(last child) — bottom of the vertical line. */
  bottom: number;
  /** Where this bracket's parent connects to it. */
  connectY: number;
  ticks: Tick[];
  labels: LabelAnchor[];
  /** Index of the prominent child, or null for coordinate brackets. */
  starChildIndex: number | null;
  /** True when flag === 'review' — render line + labels in REVIEW_COLOR. */
  review: boolean;
}

export interface BracketLayout {
  /** Pre-order (outermost first) so painting order is deterministic. */
  brackets: BracketGeom[];
  maxColumn: number;
}

/**
 * Full geometry for every bracket in the tree.
 *
 * @param rowYs     measured y-center per proposition id
 * @param x0        left edge of the text column
 * @param getLabels taxonomy label lookup per relationship code; when missing,
 *                  the code itself is used as the sole label
 */
export function layoutBrackets(
  tree: TreeNode,
  rowYs: ReadonlyMap<string, number>,
  x0: number,
  getLabels?: (rel: string) => string[] | undefined,
  colW: number = COL_W,
): BracketLayout {
  const { columns, maxColumn } = computeColumns(tree);
  const brackets: BracketGeom[] = [];

  const xOf = (node: TreeNode): number =>
    node.kind === 'prop' ? x0 : x0 - (columns.get(node) ?? 1) * colW;

  const visit = (node: TreeNode): void => {
    if (node.kind === 'prop') return;

    const column = columns.get(node) ?? 1;
    const x = x0 - column * colW;
    const coordinate = isCoordinate(node);
    const childYs = node.children.map((child) => connectY(child, rowYs));
    const top = childYs[0] ?? 0;
    const bottom = childYs[childYs.length - 1] ?? 0;

    const prom = node.prominent;
    const starChildIndex =
      !coordinate && prom !== null && prom !== undefined && node.children[prom] !== undefined
        ? prom
        : null;

    const ticks: Tick[] = node.children.map((child, i) => ({
      childIndex: i,
      y: childYs[i] ?? 0,
      x1: xOf(child),
      x2: x,
      star: i === starChildIndex,
    }));

    const rawLabels = getLabels?.(node.rel) ?? [node.rel];
    const labels: LabelAnchor[] = [];
    if (coordinate) {
      // Coordinate brackets: single label at the vertical line's midpoint.
      const text = rawLabels[0] ?? node.rel;
      if (text !== '') {
        labels.push({ text, y: (top + bottom) / 2, placement: 'mid' });
      }
    } else {
      // labels[0] at children[0]'s end unless reversed; empty renders nothing.
      const startText = node.reversed ? rawLabels[1] : rawLabels[0];
      const endText = node.reversed ? rawLabels[0] : rawLabels[1];
      if (startText !== undefined && startText !== '') {
        labels.push({ text: startText, y: top, placement: 'start' });
      }
      if (endText !== undefined && endText !== '') {
        labels.push({ text: endText, y: bottom, placement: 'end' });
      }
    }

    brackets.push({
      node,
      rel: node.rel,
      column,
      x,
      top,
      bottom,
      connectY: connectY(node, rowYs),
      ticks,
      labels,
      starChildIndex,
      review: node.flag === 'review',
    });

    for (const child of node.children) visit(child);
  };

  visit(tree);
  return { brackets, maxColumn };
}
