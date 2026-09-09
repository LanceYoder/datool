// Deterministic bracket layout for discourse-analysis forests.
//
// Pure functions only — no DOM. The caller measures each proposition row (its
// y-center, and optionally its top/bottom edges) and supplies the text
// column's left edge (x0); this module turns the CORE FOREST (`../tree/core`)
// into drawable geometry. Shared by the read-only viewer and the editor
// overlay so both always agree.
//
// It consumes the core model DIRECTLY (spec §7.8), which is what makes the
// drawing and the algebra the same tree:
//
//   - a bracket is BINARY, always, so there are exactly two ticks and the
//     n-ary drawing paths are gone. A chain of same-relationship brackets
//     draws as the real nesting it is, not as one flattened spine.
//   - a HANGING SIDE — the core's own per-side flag (§10 A1), whether it holds
//     one lodger or five — produces the short tick and the pickup dot straight
//     from the side. There is no hole node to emulate and no hole numbering.
//     A bracket may hang at BOTH ends (§10 A4): two ticks, two pickup dots, so
//     `Carry` and the dot ids name the SIDE as well as the bracket.
//   - every bracket carries its core id, and the id rides into BracketGeom and
//     DotGeom, so the UI addresses brackets by identity rather than by a
//     position or a pre-order index that the next edit invalidates (§7.3).
//   - `reversed` is DERIVED here, per §1's ruling, from the core's own
//     `reversedOf` — never read off a stored flag.

import type { Bracket, Forest, Side, TaxonomyFacts, Unit } from '../tree/core';
import { hangsAt, leavesOf, reversedFrom } from '../tree/core';

// ---------------------------------------------------------------------------
// The margin's lanes.
//
// A column is not a free choice: it is the sum of what has to stand in it.
// Every bracket writes in two lanes — one to the RIGHT of its spine (an end
// label's box, and the star that follows it) and one to the LEFT (a
// coordinate bracket's single label, hung towards the parent its line reaches
// out to). A column carries the right lane of one spine and the left lane of
// the NEXT spine in, so COL_W is those two lanes plus the air between them.
//
// The primitives are here rather than beside labelBox() below because the
// column width is DERIVED from them: change the box and the columns follow,
// which is the only way the two can never drift apart again.

/**
 * Side of the square every label is written in — one constant for the whole
 * page, and the same on both axes: a row of boxes that differ in size reads as
 * decoration instead of as a row of handles.
 *
 * Sized TIGHT (user ruling): the side is the height the original rectangles
 * had, and the letters nearly fill it. One- and two-letter codes at their
 * 13px setting sit with a couple of real pixels of air; the two THREE-letter
 * codes ("Adv", "Alt") are set compact (.bracket-label.compact, 10px with a
 * hair of negative tracking) so the same square holds them — a rare slightly
 * smaller label beats a page of oversized boxes. The 20px marks center fine.
 *
 * Hardcoded rather than measured at runtime: the label inventory is CLOSED
 * (the `labels` tuples in da/taxonomy.py), so a measurement could only ever
 * arrive back here — and a box whose size depends on what the browser has
 * loaded is a box that changes size as the fonts arrive.
 */
export const LABEL_BOX_SIDE = 18;

/**
 * The air any two marks in the margin keep between them. Small — this is a
 * dense margin — but never zero: a star touching the box beside it reads as
 * one smudged glyph, which is the whole of what went wrong before.
 */
export const LANE_CLEAR = 4;

/**
 * Gap between a bracket's spine and the near edge of its label's box, on
 * whichever side the label hangs.
 */
export const LABEL_BOX_INSET = 5;

/** Gap between a label's box and the star that follows it. */
export const STAR_GAP = 4;

/** Outer radius of the drawn star; the inner radius is this times 0.42. */
export const STAR_R = 7;

/**
 * The lane RIGHT of a spine: the end label's box, then its star. This is the
 * wider of the two lanes, because only this side can carry a star.
 */
export const LABEL_LANE_W =
  LABEL_BOX_INSET + LABEL_BOX_SIDE + STAR_GAP + 2 * STAR_R; // 53

/**
 * The lane LEFT of a spine: a coordinate bracket's single label, and (in the
 * book) the drollery that perches there. No star is ever drawn on this side.
 */
export const MID_LANE_W = LABEL_BOX_INSET + LABEL_BOX_SIDE; // 35

/**
 * Horizontal distance between adjacent bracket columns, in px — NOT a round
 * number chosen by eye, but exactly what one column has to hold:
 *
 *     COL_W = LABEL_LANE_W + LANE_CLEAR + MID_LANE_W
 *           = (5 + 30 + 4 + 14) + 4 + (5 + 30)
 *           = 53 + 4 + 35 = 92
 *
 * At 72 this did not add up — 53 + 35 alone is 88 — and the consequence was
 * visible: a star drawn a gap past its own box landed INSIDE the box of the
 * coordinate bracket one column in. Column width has not been a hard budget
 * since the tree got a scrolling viewport (treeViewportWidth), so the honest
 * number is simply the one the lanes ask for; a tree too wide for the window
 * scrolls, which costs nothing and hides nothing.
 */
export const COL_W = LABEL_LANE_W + LANE_CLEAR + MID_LANE_W; // 92

/**
 * How far left of the text column every PROPOSITION dot sits — a constant, so
 * a proposition's dot never moves as connections nest around it, and small,
 * so the dot hugs its proposition. Root propositions also draw a stub across
 * this distance (nested ones already have their tick line passing under the
 * dot). Always < COL_W, so the dot stays clear of every bracket spine.
 */
export const STUB_W = 17;

/**
 * What the innermost column leaves between its label lane and the words —
 * the SAME air any two columns keep, so the text edge is treated as one more
 * neighbour rather than as an edge to crowd against. Without it a label box
 * or its star runs under the verse labels and is cut in half by the tree
 * viewport (a scroller clips; a fitting tree merely collides).
 *
 * It is a consequence of COL_W, not a fourth number to keep in step:
 * a column-1 spine stands at x0 - COL_W, its lane ends COL_W - LABEL_LANE_W
 * short of x0, and that remainder is this.
 */
export const TEXT_CLEAR = COL_W - LABEL_LANE_W; // 39

/**
 * What the OUTERMOST column leaves between its left lane and the tree's own
 * left edge — the mirror of TEXT_CLEAR, and the reason bracketWidth adds a
 * gutter at all. It has to hold the outermost bracket's mid box (MID_LANE_W)
 * with air to spare, or that box hangs off the front of the tree and is cut
 * by the viewport the moment the tree scrolls.
 */
export const LABEL_GUTTER = 56;

/**
 * Narrowest the text column may be squeezed to. A tree needing more than what
 * is left over is not refused and not cleared: the margin it is drawn in stops
 * growing here and becomes a VIEWPORT the tree scrolls sideways inside, so the
 * words keep a readable column and the outermost spines are one scroll away.
 */
export const MIN_TEXT_W = 420;

/**
 * How far a HANGING tick reaches out from its spine before stopping: enough
 * to read as a line that goes nowhere, never far enough to touch what used to
 * be there.
 */
export const HANG_W = 22;

/**
 * Width the bracket columns of `forest` need, in px, gutter included — the
 * tree's NATURAL width, whatever the window can spare. This is the width the
 * tree is laid out at and the width its scroll container holds; only how much
 * of it is on screen at once depends on the window.
 */
export function bracketWidth(forest: Forest, colW: number = COL_W): number {
  const { maxColumn } = computeColumns(forest);
  return Math.max(maxColumn * colW, STUB_W) + LABEL_GUTTER;
}

/**
 * How much of a tree `natural` px wide can be shown at once in a shell
 * `shellWidth` px across, with the verse-label column pinned to the middle:
 * the whole of it when it fits, and otherwise as much as leaves the text
 * MIN_TEXT_W (never less than the centered half, which is what a window too
 * narrow for even that keeps). The remainder — natural minus this — is what
 * scrolls.
 */
export function treeViewportWidth(
  natural: number,
  shellWidth: number,
  labelWidth: number,
): number {
  const centered = Math.round(shellWidth / 2 - labelWidth / 2);
  const margin = Math.max(natural, centered);
  return Math.min(margin, Math.max(centered, shellWidth - MIN_TEXT_W));
}

/**
 * A hanging side being carried: the BRACKET it hangs from AND WHICH SIDE (§10
 * A4 lets both hang, so the bracket alone no longer names one), and where the
 * pointer has taken it. The layout draws that end AT the pointer, and
 * everything hanging on it follows: the bracket stretches, its own connection
 * point moves, and the tree flexes up from there.
 */
export interface Carry {
  bracketId: number;
  side: Side;
  x: number;
  y: number;
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
 * Whether a bracket is coordinate — read off the model, not the taxonomy: I7
 * makes `star` null exactly when the relationship is coordinate, so the tree
 * itself carries the answer. A bracket with NO rel at all — impossible from a
 * gesture under §10 A5, which mints Ser, but readable from data — has no star
 * either, and draws like a coordinate one: a spine with no letters on it.
 */
export function isCoordinate(bracket: Bracket): boolean {
  return bracket.star === null;
}

/**
 * What the layout needs to know about one relationship: the labels to write,
 * and the two facts `reversed` is derived from. `TaxonomyEntry` satisfies it,
 * so the caller simply hands over its taxonomy lookup.
 */
export interface RelInfo {
  labels?: readonly string[];
  starredLabel?: number | null;
  coordinate?: boolean;
}

export type RelLookup = (rel: string) => RelInfo | undefined;

function factsOf(info: RelInfo | undefined): TaxonomyFacts {
  return {
    coordinate: info?.coordinate ?? false,
    starredLabel: info?.starredLabel ?? undefined,
  };
}

export interface ColumnResult {
  /** Column per bracket, by core id. */
  columns: Map<number, number>;
  /** Deepest column across the whole forest; 0 when it holds no brackets. */
  maxColumn: number;
}

/**
 * column(bracket) = its height above the leaves: a bracket over two leaves
 * gets column 1; otherwise 1 + the deepest of its two SIDES.
 *
 * A HANGING side counts as one level of its own, even though it draws no
 * spine: it holds the place its relationship held, so deleting a relationship
 * moves nothing else on the page — what changed is only what was asked for.
 * The tree re-flows when the room is filled again.
 */
export function computeColumns(forest: Forest): ColumnResult {
  const hit = COLUMN_CACHE.get(forest);
  if (hit !== undefined) return hit;
  const out = walkColumns(forest);
  COLUMN_CACHE.set(forest, out);
  return out;
}

/**
 * One overlay asks for the columns three times — the margin's width, the
 * brackets, the dots — and asks again for EVERY pointer position while a
 * hanging end is carried. A Forest is immutable (core.ts declares its arrays
 * `readonly`, and every op rebuilds rather than mutates), so its columns are a
 * function of its identity: computed once per forest object, and the entry
 * goes when the forest does.
 */
const COLUMN_CACHE = new WeakMap<Forest, ColumnResult>();

function walkColumns(forest: Forest): ColumnResult {
  const columns = new Map<number, number>();
  let maxColumn = 0;

  const unitColumn = (u: Unit): number => {
    if (u.kind === 'leaf') return 0;
    const col = 1 + Math.max(sideColumn(u, 'left'), sideColumn(u, 'right'));
    columns.set(u.id, col);
    if (col > maxColumn) maxColumn = col;
    return col;
  };

  const sideColumn = (b: Bracket, side: Side): number => {
    let deepest = 0;
    for (const u of b[side]) deepest = Math.max(deepest, unitColumn(u));
    return hangsAt(b, side) ? deepest + 1 : deepest;
  };

  for (const root of forest.roots) unitColumn(root);
  return { columns, maxColumn };
}

/**
 * The y at which a unit connects to whatever holds it:
 *  - leaf: its measured row y-center;
 *  - coordinate (or unlabeled) bracket: midpoint of its two sides;
 *  - subordinate bracket: the starred side's connection point.
 */
export function connectY(unit: Unit, rows: RowInput, carry?: Carry): number {
  if (unit.kind === 'leaf') return rowY(rows, unit.pid);
  const top = sideY(unit, 'left', rows, carry);
  const bottom = sideY(unit, 'right', rows, carry);
  if (unit.star === 'left') return top;
  if (unit.star === 'right') return bottom;
  return (top + bottom) / 2;
}

/**
 * Where one SIDE of a bracket connects to its spine: its unit's own point when
 * the side is anchored, the midpoint of its first and last lodgers when it is
 * a room — or wherever the pointer has taken it, when this is the side being
 * carried. Everything above measures from there, so the tree flexes.
 */
export function sideY(
  bracket: Bracket,
  side: Side,
  rows: RowInput,
  carry?: Carry,
): number {
  const units = bracket[side];
  if (carry !== undefined && carry.bracketId === bracket.id && carry.side === side) {
    return carry.y;
  }
  if (units.length === 1) return connectY(units[0]!, rows, carry);
  const first = connectY(units[0]!, rows, carry);
  const last = connectY(units[units.length - 1]!, rows, carry);
  return (first + last) / 2;
}

/** One horizontal tick from a side's connection point to the bracket's line. */
export interface Tick {
  /** Which of the bracket's two sides this tick reaches out to. */
  side: Side;
  y: number;
  /** x of the side's connection point: x(child bracket), x0 for a leaf, or
   *  the short stop of a hanging tick (the pointer, while it is carried). */
  x1: number;
  /** x of this bracket's vertical line. */
  x2: number;
  /** True on the starred side's tick — render a '*' at this end. */
  star: boolean;
  /**
   * True when this side HANGS (a room, §1): the tick leaves the spine and
   * stops, because what it reaches for is not assembled yet.
   */
  hanging: boolean;
}

export interface LabelAnchor {
  text: string;
  y: number;
  /**
   * 'start' = left-side end, 'end' = right-side end (subordinate brackets),
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
  bracket: Bracket;
  /** The core's stable id — how every command and every dot addresses it. */
  bracketId: number;
  /** The bracket's relationship. Never null from a gesture (§10 A5 mints Ser);
   *  null only for a bracket that arrived from data without one. */
  rel: string | null;
  /** Position in document pre-order across the forest. */
  preorderIndex: number;
  /** Index of the forest root this bracket belongs to. */
  rootIndex: number;
  /** True when this bracket IS a forest root. */
  root: boolean;
  column: number;
  /** x of the vertical line: x0 - column * colW. */
  x: number;
  /** The left side's connection point — top of the vertical line. */
  top: number;
  /** The right side's connection point — bottom of the vertical line. */
  bottom: number;
  /** Where whatever holds this bracket connects to it. */
  connectY: number;
  ticks: Tick[];
  labels: LabelAnchor[];
  /** The starred side, or null for a coordinate (or unlabeled) bracket. */
  starSide: Side | null;
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
 * @param forest  the core state
 * @param rows    measured row per proposition id (center, or full box)
 * @param x0      left edge of the text column
 * @param rel     taxonomy lookup per relationship code; when it returns
 *                nothing, the code itself is used as the sole label
 * @param carry   the hanging side being carried, if any
 */
export function layoutBrackets(
  forest: Forest,
  rows: RowInput,
  x0: number,
  rel?: RelLookup,
  colW: number = COL_W,
  carry?: Carry,
): BracketLayout {
  const { columns, maxColumn } = computeColumns(forest);
  const brackets: BracketGeom[] = [];

  /** Where a side's tick starts, out from the spine at `x`. */
  const sideX = (b: Bracket, side: Side, x: number): number => {
    const units = b[side];
    if (hangsAt(b, side)) {
      // A carried end reaches all the way to the pointer; a resting one stops
      // just off its spine.
      return carry !== undefined && carry.bracketId === b.id && carry.side === side
        ? carry.x
        : x + HANG_W;
    }
    const only = units[0]!;
    return only.kind === 'leaf' ? x0 : x0 - (columns.get(only.id) ?? 1) * colW;
  };

  const visit = (unit: Unit, rootIndex: number, isRoot: boolean): void => {
    if (unit.kind === 'leaf') return;
    const b = unit;
    const column = columns.get(b.id) ?? 1;
    const x = x0 - column * colW;
    const top = sideY(b, 'left', rows, carry);
    const bottom = sideY(b, 'right', rows, carry);
    const starSide = b.star;

    const ticks: Tick[] = (['left', 'right'] as const).map((side) => ({
      side,
      y: side === 'left' ? top : bottom,
      x1: sideX(b, side, x),
      x2: x,
      star: side === starSide,
      hanging: hangsAt(b, side),
    }));

    // A bracket with no rel writes no LETTERS: the spine draws and the letters
    // wait. §10 A5 means a GESTURE never makes one (every connect mints Ser);
    // this is the data case. It still gets its label anchor, with empty text —
    // the box is the handle the relationship menu opens from (BracketLayer
    // draws the box as the hit target), so the one bracket that most needs
    // that handle must never be the one bracket without it.
    const info = b.rel === null ? undefined : rel?.(b.rel);
    const rawLabels = b.rel === null ? [''] : (info?.labels ?? [b.rel]);
    const labels: LabelAnchor[] = [];
    if (starSide === null) {
      // Coordinate (and unlabeled): a single label at the line's midpoint.
      const text = rawLabels[0];
      if (text !== undefined && (text !== '' || b.rel === null)) {
        labels.push({ text, y: (top + bottom) / 2, placement: 'mid' });
      }
    } else {
      // labels[0] at the LEFT end unless reversed; empty renders nothing.
      // `reversed` is derived, never stored (§1's follow-on ruling).
      const flipped = reversedFrom(b, factsOf(info));
      const startText = flipped ? rawLabels[1] : rawLabels[0];
      const endText = flipped ? rawLabels[0] : rawLabels[1];
      if (startText !== undefined && startText !== '') {
        labels.push({ text: startText, y: top, placement: 'start' });
      }
      if (endText !== undefined && endText !== '') {
        labels.push({ text: endText, y: bottom, placement: 'end' });
      }
    }

    const refs = leavesOf(b);
    const firstBox = rowBox(rows, refs[0] ?? '');
    const lastBox = rowBox(rows, refs[refs.length - 1] ?? '');

    brackets.push({
      bracket: b,
      bracketId: b.id,
      rel: b.rel,
      preorderIndex: brackets.length,
      rootIndex,
      root: isRoot,
      column,
      x,
      top,
      bottom,
      connectY: connectY(b, rows, carry),
      ticks,
      labels,
      starSide,
      rect: {
        x,
        y: firstBox.top,
        width: x0 - x,
        height: lastBox.bottom - firstBox.top,
      },
    });

    for (const child of b.left) visit(child, rootIndex, false);
    for (const child of b.right) visit(child, rootIndex, false);
  };

  forest.roots.forEach((root, i) => {
    visit(root, i, true);
  });
  return { brackets, maxColumn };
}

// ---------------------------------------------------------------------------
// Dots — the handles the UI hangs interaction off.

export interface DotGeom {
  /**
   * The dot grammar of §7.3, as §10 A4 extends it: 'prop:<pid>',
   * 'bracket:<id>' or 'hang:<id>:<side>' — the side is part of the name now
   * that a bracket may hang at both ends. Stable across edits, because the
   * core's ids are.
   */
  id: string;
  kind: 'prop' | 'bracket' | 'hang';
  /** The core id this dot names — the pid for a leaf, the bracket id
   *  otherwise (for a 'hang' dot, the bracket whose side hangs). */
  ref: string | number;
  /** Which side hangs — 'hang' dots only. */
  side?: Side;
  x: number;
  y: number;
  /**
   * True when this unit is FREE (§2's vocabulary): a forest root, or a lodger
   * in a room. EVERY dot is clickable and can start or receive a connection —
   * connecting a committed unit breaks the bracket that claims it (ruling Q1)
   * — so the flag only says whether the unit hangs from nothing yet.
   */
  root: boolean;
  /** Free propositions only: the stub drawn from stubX1 to stubX2 at y. */
  stubX1?: number;
  stubX2?: number;
}

/**
 * A dot for every unit in the forest, plus one at the end of every hanging
 * side, emitted in document pre-order. Every dot is the same size and every
 * proposition's dot is the same distance from its row — the geometry here
 * never changes with connection state, only the `root` flag does.
 *
 *  - Proposition: the dot sits at x0 - STUB_W on its row, ALWAYS — nesting
 *    never moves it. A free proposition also gets a stub from the dot to x0
 *    (a committed one's tick line already runs underneath its dot).
 *  - Bracket: the dot sits on the spine — at its midpoint when the bracket is
 *    coordinate or unlabeled, else at the starred end's corner.
 *  - Hanging side: the dot sits where its short tick stops, which is the
 *    handle for the group that is still being assembled.
 */
export function layoutDots(
  forest: Forest,
  rows: RowInput,
  x0: number,
  colW: number = COL_W,
  carry?: Carry,
): DotGeom[] {
  const { columns } = computeColumns(forest);
  const dots: DotGeom[] = [];

  const visit = (unit: Unit, free: boolean): void => {
    if (unit.kind === 'leaf') {
      const dot: DotGeom = {
        id: `prop:${unit.pid}`,
        kind: 'prop',
        ref: unit.pid,
        x: x0 - STUB_W,
        y: rowY(rows, unit.pid),
        root: free,
      };
      if (free) {
        dot.stubX1 = x0 - STUB_W;
        dot.stubX2 = x0;
      }
      dots.push(dot);
      return;
    }

    const b = unit;
    const x = x0 - (columns.get(b.id) ?? 1) * colW;
    dots.push({
      id: `bracket:${b.id}`,
      kind: 'bracket',
      ref: b.id,
      x,
      y: connectY(b, rows, carry),
      root: free,
    });

    for (const side of ['left', 'right'] as const) {
      const units = b[side];
      const hanging = hangsAt(b, side);
      if (hanging) {
        // The loose end of the tick that points here is a handle in its own
        // right: right-clicking it deletes the relationship it hangs from, and
        // CONNECTING it with the room's sole lodger settles the side and
        // finishes the bracket (§10 A2). A bracket hanging at both ends draws
        // two of these, which is why the id carries the side.
        const carried = carry !== undefined && carry.bracketId === b.id && carry.side === side;
        dots.push({
          id: `hang:${b.id}:${side}`,
          kind: 'hang',
          ref: b.id,
          side,
          x: carried ? carry.x : x + HANG_W,
          y: sideY(b, side, rows, carry),
          root: true,
        });
      }
      // A room's units are LODGERS — unattached to each other, free to be
      // picked up; a settled side's single unit is committed to this bracket.
      for (const child of units) visit(child, hanging);
    }
  };

  for (const root of forest.roots) visit(root, true);
  return dots;
}

// ---------------------------------------------------------------------------
// The label lane — the box a relationship's label is written in, and the star
// that follows it.
//
// Every label on the page is drawn in the SAME box, whatever it says: the box
// is the affordance ("a relationship is named here, and you may click it"),
// and a row of boxes that all differ in size reads as decoration instead. Only
// the letters inside change.
//
// The geometry is here rather than in the drawing so that the click target,
// the star beside it and the menu anchored on it all move together — and so
// the clearances below can be asserted without a DOM.

/**
 * Rough advance width of one character of the label font at its 13px setting.
 * A deliberate over-estimate: it is what the box is sized against, and a box
 * that is a hair too wide is better than letters touching its edge.
 */
export const LABEL_CHAR_W = 8;

/**
 * Whether a label is a SINGLE MARK standing in for a word — Negative–Positive
 * is written "-" and "+", Inference "∴". Set at the size a letter wants, one
 * of these is a few pixels of hairline sitting on a tick line and disappears
 * into it, so they are drawn bigger and heavier everywhere (styles.css).
 *
 * One character is the test, which is why Comparison's "//" is left alone: a
 * pair of strokes already has the width to be seen, and blown up it shouts.
 */
export function isSymbolLabel(text: string): boolean {
  return [...text].length === 1 && !/[A-Za-z]/.test(text);
}

/**
 * Whether a label is set COMPACT: three or more letters must drop to the
 * smaller face to hold the square (only "Adv" and "Alt" in the taxonomy).
 */
export function isCompactLabel(text: string): boolean {
  return [...text].length >= 3 && /[A-Za-z]/.test(text);
}

/** Advance width of one character at the compact (10px) setting. */
export const COMPACT_CHAR_W = 5.5;

/** Rough width of a label as drawn — marks are set larger, compacts smaller. */
export function labelInkWidth(text: string): number {
  if (isSymbolLabel(text)) return text.length * LABEL_CHAR_W * 1.4;
  if (isCompactLabel(text)) return text.length * COMPACT_CHAR_W;
  return text.length * LABEL_CHAR_W;
}

// The box's SIDE, the inset it hangs at, the gap before its star and the
// star's radius all live at the top of this file, because COL_W is derived
// from them. Everything below is the geometry those numbers produce.

/** Corner radius. Rounded enough to read as a chip, not as a table cell. */
export const LABEL_BOX_RX = 4;

/**
 * How far the box's BOTTOM edge sits above the label's own line.
 *
 * The square is taller than the slot it replaced (30 rather than 18), but it
 * grew UPWARDS only, so the lift's own job is unchanged: clear the tick the
 * label stands on, and clear the bracket's dot where one sits on the spine at
 * that same y — r 5 at rest, 6.5 under the pointer — so the box never has to
 * dodge the dot sideways and the letters keep their lane.
 *
 * What the taller box did change is the reach UP: a box now stands
 * LABEL_BOX_LIFT + LABEL_BOX_SIDE = 38px above its line, and the line above it
 * belongs to another proposition. The tightest row this app sets is the
 * Original skin's two-line proposition at ~49px, so the box still comes to a
 * stop a clear LANE_CLEAR short of it — see MIN_ROW_PITCH in layout.test.ts.
 */
export const LABEL_BOX_LIFT = 8;

/**
 * The box behind one label. `x` is its bracket's spine, `y` the label's own
 * line, and `placement` which side of the spine the label hangs on — 'mid'
 * (a coordinate bracket's single label) hangs to the LEFT, towards the parent
 * its line reaches out to; the end labels sit to the right.
 */
export function labelBox(
  x: number,
  y: number,
  placement: LabelAnchor['placement'],
): Rect {
  const left =
    placement === 'mid' ? x - LABEL_BOX_INSET - LABEL_BOX_SIDE : x + LABEL_BOX_INSET;
  return {
    x: left,
    y: y - LABEL_BOX_LIFT - LABEL_BOX_SIDE,
    width: LABEL_BOX_SIDE,
    height: LABEL_BOX_SIDE,
  };
}

/**
 * Center x of the star at an end: a fixed gap past the box when that end
 * shows a label, and IN the box's place when it shows none — Ground's starred
 * end is a bare star, and it stands where its letters would have.
 *
 * The bare star keeps the box's place rather than taking the STAR_GAP offset
 * because at COL_W it cannot reach anything: it spans x + 13 to x + 27, and
 * the nearest mark in from it is the next spine's mid box at x + 57. The
 * invariants in layout.test.ts hold that claim, so if a column ever narrows
 * again the tests say so before the page does.
 */
export function starCenterX(x: number, labelled: boolean): number {
  const box = labelBox(x, 0, 'start');
  return labelled
    ? box.x + box.width + STAR_GAP + STAR_R
    : box.x + box.width / 2;
}

/**
 * Center y of the star at an end whose line is at `y` — the middle of the box
 * beside it, so the star and the letters share a centre line whether or not
 * that end writes any. (It used to be pinned to the letters' own middle,
 * which only agreed with the box by accident.)
 */
export function starCenterY(y: number): number {
  return y - LABEL_BOX_LIFT - LABEL_BOX_SIDE / 2;
}

/** The square a star occupies, for clearance arithmetic. */
export function starBox(x: number, y: number, labelled: boolean): Rect {
  return {
    x: starCenterX(x, labelled) - STAR_R,
    y: starCenterY(y) - STAR_R,
    width: 2 * STAR_R,
    height: 2 * STAR_R,
  };
}

// ---------------------------------------------------------------------------
// Where the margin already has ink.
//
// The book's margin carries decoration as well as geometry — drolleries, the
// small figures a manuscript perches wherever there is room (Drolleries.tsx).
// Decoration YIELDS: an ornament drawn over a star or through a label is not
// marginalia, it is a mistake. So the layout, which is the only thing that
// knows where every mark ends up, publishes them, and the decoration asks.

/** A drawn line segment, as the margin's spines and ticks come out. */
export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Every mark the tree puts in its margin, sorted by what it is. */
export interface MarginInk {
  /**
   * Solid marks — label boxes, stars, dots. These have area, and anything
   * laid over them is read as touching them.
   */
  marks: Rect[];
  /** Spines and ticks. These are hairlines: only passing THROUGH one shows. */
  lines: Segment[];
}

/** The radius of the visible dot, plus the hover ring it grows to. */
const DOT_MARK_R = 6.5;

/**
 * Everything already drawn in the margin, from a laid-out forest. Pass the
 * dots too when they are to hand — an ornament sitting on a handle is as
 * wrong as one sitting on a label.
 */
export function marginInk(
  brackets: readonly BracketGeom[],
  dots: readonly DotGeom[] = [],
): MarginInk {
  const marks: Rect[] = [];
  const lines: Segment[] = [];

  for (const b of brackets) {
    lines.push({ x1: b.x, y1: b.top, x2: b.x, y2: b.bottom });
    for (const t of b.ticks) {
      lines.push({ x1: t.x1, y1: t.y, x2: t.x2, y2: t.y });
    }
    for (const l of b.labels) {
      marks.push(labelBox(b.x, l.y, l.placement));
    }
    for (const t of b.ticks) {
      if (!t.star) continue;
      const labelled = b.labels.some((l) => l.placement !== 'mid' && l.y === t.y);
      marks.push(starBox(b.x, t.y, labelled));
    }
  }
  for (const d of dots) {
    marks.push({
      x: d.x - DOT_MARK_R,
      y: d.y - DOT_MARK_R,
      width: 2 * DOT_MARK_R,
      height: 2 * DOT_MARK_R,
    });
  }
  return { marks, lines };
}

/**
 * How much empty space an ornament leaves around every mark in the margin.
 * Less than LANE_CLEAR would let a drollery's outline graze a box; much more
 * and there is nowhere in a dense tree left to stand.
 */
export const ORNAMENT_CLEAR = 5;

/** Do two rectangles meet? Touching edges do not count. */
function meets(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/**
 * Whether `box` may be drawn: clear of every solid mark by `clear`, and with
 * no line running through its INSIDE.
 *
 * The two rules differ on purpose. A box or a star is an object, and an
 * ornament has to keep its distance from it. A spine is a rule on the page,
 * and a figure STANDING on one — its feet on the line, its back against the
 * spine — is exactly what a margin looks like; only a line struck through the
 * figure is wrong. So lines are tested against the interior, with no
 * inflation, which lets an ornament perch on a corner without being pushed
 * off it.
 */
export function isClearOfInk(
  box: Rect,
  ink: MarginInk,
  clear: number = ORNAMENT_CLEAR,
): boolean {
  const room: Rect = {
    x: box.x - clear,
    y: box.y - clear,
    width: box.width + 2 * clear,
    height: box.height + 2 * clear,
  };
  for (const mark of ink.marks) {
    if (meets(room, mark)) return false;
  }
  for (const line of ink.lines) {
    const lo = { x: Math.min(line.x1, line.x2), y: Math.min(line.y1, line.y2) };
    const seg: Rect = {
      x: lo.x,
      y: lo.y,
      width: Math.abs(line.x2 - line.x1),
      height: Math.abs(line.y2 - line.y1),
    };
    if (meets(box, seg)) return false;
  }
  return true;
}
