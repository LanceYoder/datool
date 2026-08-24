// Pure helpers for the editor's interaction layer. No DOM, no editor instance —
// everything here is a plain function over data, so it is unit-testable and the
// React layer stays thin.
//
// The editor CORE (commands.ts, layout.ts) is untouched by this module: these
// are only the small lookups the UI needs on top of it — grouping the taxonomy
// for the relationship menu, reading a dot id back apart, working out which
// bracket a non-connectable dot belongs to, and keeping a popover on screen.

import type { TaxonomyEntry, TreeNode } from '../types';

/** Display names for the taxonomy's four families. */
export const FAMILY_NAMES: Record<string, string> = {
  coordinate: 'Coordinate',
  restatement: 'Restatement',
  distinct: 'Distinct statement',
  contrary: 'Contrary statement',
};

export interface RelationshipGroup {
  family: string;
  /** Display name (FAMILY_NAMES, falling back to the raw family key). */
  name: string;
  entries: TaxonomyEntry[];
}

/**
 * The taxonomy grouped by family, families in first-appearance order and
 * entries in taxonomy order — the order the relationship menu lists them in.
 */
export function groupByFamily(taxonomy: readonly TaxonomyEntry[]): RelationshipGroup[] {
  const order: string[] = [];
  const byFamily = new Map<string, TaxonomyEntry[]>();
  for (const entry of taxonomy) {
    const existing = byFamily.get(entry.family);
    if (existing === undefined) {
      byFamily.set(entry.family, [entry]);
      order.push(entry.family);
    } else {
      existing.push(entry);
    }
  }
  return order.map((family) => ({
    family,
    name: FAMILY_NAMES[family] ?? family,
    entries: byFamily.get(family) ?? [],
  }));
}

/** What a DotGeom id points at (see layoutDots). */
export type DotRef = { kind: 'prop'; pid: string } | { kind: 'bracket'; index: number };

/** Read a dot id ('prop:<pid>' | 'bracket:<preorderIndex>') back apart. */
export function parseDotId(id: string): DotRef | null {
  if (id.startsWith('prop:')) {
    const pid = id.slice('prop:'.length);
    return pid === '' ? null : { kind: 'prop', pid };
  }
  if (id.startsWith('bracket:')) {
    const raw = id.slice('bracket:'.length);
    const index = Number(raw);
    if (raw === '' || !Number.isInteger(index) || index < 0) return null;
    return { kind: 'bracket', index };
  }
  return null;
}

/**
 * The bracket each dot belongs to, as a pre-order index into findBrackets /
 * layoutBrackets — the bracket a click on a NON-CONNECTABLE dot selects.
 *
 *  - a proposition inside a bracket -> that bracket;
 *  - a bracket -> itself;
 *  - a root proposition -> absent (its dot is connectable, so a click selects
 *    the dot rather than any bracket).
 *
 * The traversal is layoutDots' traversal, so the indices agree with the ids it
 * emits (the tests pin that agreement).
 */
export function dotOwners(forest: readonly TreeNode[]): Map<string, number> {
  const owners = new Map<string, number>();
  let bracketIndex = 0;

  const visit = (node: TreeNode, parentIndex: number | null): void => {
    if (node.kind === 'prop') {
      if (parentIndex !== null) owners.set(`prop:${node.ref}`, parentIndex);
      return;
    }
    const index = bracketIndex;
    bracketIndex += 1;
    owners.set(`bracket:${index}`, index);
    for (const child of node.children) visit(child, index);
  };

  for (const root of forest) visit(root, null);
  return owners;
}

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/**
 * Keep a popover inside its container: the desired top-left is clamped so the
 * whole box (plus `margin`) fits in `bounds`, never going past the top-left
 * corner even when the box is bigger than the container.
 */
export function clampPopover(
  desired: Point,
  size: Size,
  bounds: Size,
  margin = 4,
): Point {
  const maxX = Math.max(margin, bounds.width - size.width - margin);
  const maxY = Math.max(margin, bounds.height - size.height - margin);
  return {
    x: Math.max(margin, Math.min(desired.x, maxX)),
    y: Math.max(margin, Math.min(desired.y, maxY)),
  };
}

/**
 * Whether a word offers "Split after": every word but the last one (there is
 * nothing to split off after the last). `firstCount` for splitProposition is
 * then `ordinal + 1`.
 */
export function canSplitAfter(ordinal: number, wordCount: number): boolean {
  return Number.isInteger(ordinal) && ordinal >= 0 && ordinal < wordCount - 1;
}
