// Deterministic bracket layout for discourse-analysis forests.
//
// Pure functions only — no DOM. The caller measures each proposition row (its
// y-center, and optionally its top/bottom edges) and supplies the text
// column's left edge (x0); this module turns the FOREST into drawable
// geometry. Shared by the read-only viewer and the editor overlay so both
// always agree.
//
// A document is a forest of ordered roots: geometry is computed per root
// exactly as it always was for a single tree, and the results are concatenated
// in root order (so brackets come out in document pre-order, matching
// findBrackets on the ProseMirror doc).

import type { BracketNode, TreeNode } from '../types';

/**
 * Horizontal distance between adjacent bracket columns, in px. Wide enough
 * that a bracket's corner dot, its end label, and its star each get their own
 * lane along the tick, with clear space before the proposition's dot.
 */
export const COL_W = 72;

/**
 * How far left of the text column every PROPOSITION dot sits — a constant, so
 * a proposition's dot never moves as connections nest around it, and small,
 * so the dot hugs its proposition. Root propositions also draw a stub across
 * this distance (nested ones already have their tick line passing under the
 * dot). Always < COL_W, so the dot stays clear of every bracket spine.
 */
export const STUB_W = 17;

/**
 * Space between the bracket columns and the verse-label gutter — the margin's
 * own padding, so the innermost spine never touches the labels.
 */
export const LABEL_GUTTER = 56;

/**
 * Narrowest the text column may be squeezed to before a tree counts as too
 * wide to draw. A tree needing more than what is left over runs its brackets
 * off one edge of the window and the words off the other.
 */
export const MIN_TEXT_W = 420;

/** Width the bracket columns of `forest` need, in px, gutter included. */
export function bracketWidth(forest: readonly TreeNode[], colW: number = COL_W): number {
  const { maxColumn } = computeColumns(forest);
  return Math.max(maxColumn * colW, STUB_W) + LABEL_GUTTER;
}

/**
 * Whether a forest can be drawn in `availableWidth` px while leaving the text
 * a readable column. The editor asks this of the document it loads, and the
 * new-analysis page asks it of what the analyzer proposes — a tree that
 * cannot be drawn is never worth keeping.
 */
export function fitsWidth(forest: readonly TreeNode[], availableWidth: number): boolean {
  return bracketWidth(forest) <= availableWidth - MIN_TEXT_W;
}

/** A measured proposition row: its center y plus its top and bottom edges. */
export interface RowBox {
  /** Row center y — the connection point for ticks and dots. */
  y: number;
  /** Row top edge y. */
  top: number;
  /** Row bottom edge y. */
  bottom: number;
}

/**
 * Measured rows, keyed by proposition id. A bare number is shorthand for a
 * zero-height row centered at that y — enough for spines, ticks, labels and
 * dots; hit rectangles then collapse to the span between row centers.
 */
export type RowInput = ReadonlyMap<string, number | RowBox>;

const ZERO: RowBox = { y: 0, top: 0, bottom: 0 };

/** The measured box for a proposition id (zero-height fallback). */
export function rowBox(rows: RowInput, ref: string): RowBox {
  const entry = rows.get(ref);
  if (entry === undefined) return ZERO;
  return typeof entry === 'number' ? { y: entry, top: entry, bottom: entry } : entry;
}

/** The measured center y for a proposition id (0 when unmeasured). */
export function rowY(rows: RowInput, ref: string): number {
  const entry = rows.get(ref);
  if (entry === undefined) return 0;
  return typeof entry === 'number' ? entry : entry.y;
}

/**
 * Whether a bracket is coordinate. Per the document invariant, `prominent`
 * is null exactly when the relationship is coordinate, so the tree itself
 * carries the answer (no taxonomy lookup needed for geometry).
 */
export function isCoordinate(node: BracketNode): boolean {
  return node.prominent === null || node.prominent === undefined;
}

/** Proposition refs under `node`, in order. */
export function leafRefs(node: TreeNode, out: string[] = []): string[] {
  if (node.kind === 'prop') {
    out.push(node.ref);
    return out;
  }
  for (const child of node.children) leafRefs(child, out);
  return out;
}

export interface ColumnResult {
  /** Column per bracket node (keyed by node object identity). */
  columns: Map<BracketNode, number>;
  /** Deepest column across the whole forest; 0 when it holds no brackets. */
  maxColumn: number;
}

/**
 * column(bracket) = its height above the leaves: brackets whose children are
 * all props get column 1; otherwise 1 + max(child columns). Computed per root;
 * maxColumn is the deepest across all roots (roots share one column grid, so
 * their spines line up).
 */
export function computeColumns(forest: readonly TreeNode[]): ColumnResult {
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

  for (const root of forest) visit(root);
  return { columns, maxColumn };
}

/**
 * The y at which a node connects to its parent:
 *  - prop: its measured row y-center;
 *  - coordinate bracket: midpoint of first/last child connection points;
 *  - subordinate bracket: the prominent child's connection point.
 */
export function connectY(node: TreeNode, rows: RowInput): number {
  if (node.kind === 'prop') {
    return rowY(rows, node.ref);
  }
  const first = node.children[0];
  const last = node.children[node.children.length - 1];
  if (first === undefined || last === undefined) return 0; // violates invariant; be safe
  if (!isCoordinate(node)) {
    const idx = node.prominent;
    if (idx !== null && idx !== undefined) {
      const target = node.children[idx];
      if (target !== undefined) return connectY(target, rows);
    }
  }
  return (connectY(first, rows) + connectY(last, rows)) / 2;
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

/** Axis-aligned rectangle, in the same coordinate space as the geometry. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BracketGeom {
  node: BracketNode;
  rel: string;
  /** Position in document pre-order across the forest (matches findBrackets). */
  preorderIndex: number;
  /** Index of the forest root this bracket belongs to. */
  rootIndex: number;
  /** True when this bracket IS a forest root (its parent is the document). */
  root: boolean;
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
  /**
   * Full hit rectangle: from the spine x rightwards to x0, spanning from the
   * top of its first proposition row to the bottom of its last. Nested
   * brackets are strictly inside their ancestors' rects, so painting them
   * later (they come later in pre-order) lets the innermost win a click.
   */
  rect: Rect;
}

export interface BracketLayout {
  /** Pre-order (outermost first) so painting order is deterministic. */
  brackets: BracketGeom[];
  maxColumn: number;
}

/**
 * Full geometry for every bracket in the forest.
 *
 * @param forest    the document's ordered roots
 * @param rows      measured row per proposition id (center, or full box)
 * @param x0        left edge of the text column
 * @param getLabels taxonomy label lookup per relationship code; when missing,
 *                  the code itself is used as the sole label
 */
export function layoutBrackets(
  forest: readonly TreeNode[],
  rows: RowInput,
  x0: number,
  getLabels?: (rel: string) => string[] | undefined,
  colW: number = COL_W,
): BracketLayout {
  const { columns, maxColumn } = computeColumns(forest);
  const brackets: BracketGeom[] = [];

  const xOf = (node: TreeNode): number =>
    node.kind === 'prop' ? x0 : x0 - (columns.get(node) ?? 1) * colW;

  const visit = (node: TreeNode, rootIndex: number, isRoot: boolean): void => {
    if (node.kind === 'prop') return;

    const column = columns.get(node) ?? 1;
    const x = x0 - column * colW;
    const coordinate = isCoordinate(node);
    const childYs = node.children.map((child) => connectY(child, rows));
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
      const startText = node.reversed === true ? rawLabels[1] : rawLabels[0];
      const endText = node.reversed === true ? rawLabels[0] : rawLabels[1];
      if (startText !== undefined && startText !== '') {
        labels.push({ text: startText, y: top, placement: 'start' });
      }
      if (endText !== undefined && endText !== '') {
        labels.push({ text: endText, y: bottom, placement: 'end' });
      }
    }

    const refs = leafRefs(node);
    const firstBox = rowBox(rows, refs[0] ?? '');
    const lastBox = rowBox(rows, refs[refs.length - 1] ?? '');

    brackets.push({
      node,
      rel: node.rel,
      preorderIndex: brackets.length,
      rootIndex,
      root: isRoot,
      column,
      x,
      top,
      bottom,
      connectY: connectY(node, rows),
      ticks,
      labels,
      starChildIndex,
      rect: {
        x,
        y: firstBox.top,
        width: x0 - x,
        height: lastBox.bottom - firstBox.top,
      },
    });

    for (const child of node.children) visit(child, rootIndex, false);
  };

  forest.forEach((root, i) => {
    visit(root, i, true);
  });
  return { brackets, maxColumn };
}

// ---------------------------------------------------------------------------
// Dots — the handles the UI hangs interaction off.

export interface DotGeom {
  /** Stable across a layout pass: 'prop:<pid>' or 'bracket:<preorderIndex>'. */
  id: string;
  kind: 'prop' | 'bracket';
  x: number;
  y: number;
  /**
   * True when this unit is a root of the forest. EVERY dot is clickable and
   * can start or receive a connection (connecting a nested unit dissolves the
   * brackets above it first — see connectUnits); the flag only says whether
   * the unit is currently disconnected.
   */
  root: boolean;
  /** Root propositions only: the stub drawn from stubX1 to stubX2 at y. */
  stubX1?: number;
  stubX2?: number;
}

/**
 * A dot for every proposition and every bracket in the forest, emitted in
 * document pre-order (bracket dots numbered to match layoutBrackets and
 * findBrackets). Every dot is the same size and every proposition's dot is
 * the same distance from its row — the geometry here never changes with
 * connection state, only the `root` flag does.
 *
 *  - Proposition: the dot sits at x0 - STUB_W on its row, ALWAYS — nesting
 *    never moves it. A root proposition also gets a stub from the dot to x0
 *    (a nested one's tick line already runs underneath its dot).
 *  - Bracket: the dot sits on the spine — at its midpoint when the bracket is
 *    coordinate or otherwise unstarred, else at the starred end's corner.
 */
export function layoutDots(
  forest: readonly TreeNode[],
  rows: RowInput,
  x0: number,
  colW: number = COL_W,
): DotGeom[] {
  const { columns } = computeColumns(forest);
  const dots: DotGeom[] = [];
  let bracketIndex = 0;

  const visit = (node: TreeNode, parent: BracketNode | null): void => {
    if (node.kind === 'prop') {
      const y = rowY(rows, node.ref);
      const dot: DotGeom = {
        id: `prop:${node.ref}`,
        kind: 'prop',
        x: x0 - STUB_W,
        y,
        root: parent === null,
      };
      if (parent === null) {
        dot.stubX1 = x0 - STUB_W;
        dot.stubX2 = x0;
      }
      dots.push(dot);
      return;
    }

    const index = bracketIndex;
    bracketIndex += 1;
    const x = x0 - (columns.get(node) ?? 1) * colW;
    const childYs = node.children.map((child) => connectY(child, rows));
    const top = childYs[0] ?? 0;
    const bottom = childYs[childYs.length - 1] ?? 0;
    const prom = node.prominent;
    const starred =
      !isCoordinate(node) && prom !== null && prom !== undefined
        ? childYs[prom]
        : undefined;

    dots.push({
      id: `bracket:${index}`,
      kind: 'bracket',
      x,
      y: starred ?? (top + bottom) / 2,
      root: parent === null,
    });

    for (const child of node.children) visit(child, node);
  };

  for (const root of forest) visit(root, null);
  return dots;
}
