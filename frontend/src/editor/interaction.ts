// Pure helpers for the editor's interaction layer. No DOM, no editor instance —
// everything here is a plain function over data, so it is unit-testable and the
// React layer stays thin.
//
// The editor CORE (commands.ts, layout.ts) is untouched by this module: these
// are only the small lookups the UI needs on top of it — grouping the taxonomy
// for the relationship menu, reading a dot id back apart, and keeping a
// popover on screen.

import type { TaxonomyEntry, TreeNode, VerseText } from '../types';

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
 * The pids of the analysis's MAIN POINT — where the star walk from the top of
 * the tree lands — but only when the analysis is COMPLETE: exactly one forest
 * root, and that root a bracket (every proposition connected into one tree).
 * Otherwise empty.
 *
 * The walk follows the prominent (starred) child through subordinate
 * brackets and fans out across a coordinate bracket's whole packet.
 */
export function mainPointRefs(forest: readonly TreeNode[]): string[] {
  const root = forest.length === 1 ? forest[0] : undefined;
  if (root === undefined || root.kind !== 'bracket') return [];
  const out: string[] = [];
  const walk = (node: TreeNode): void => {
    if (node.kind === 'prop') {
      out.push(node.ref);
      return;
    }
    const prom = node.prominent;
    const target =
      prom !== null && prom !== undefined ? node.children[prom] : undefined;
    if (target !== undefined) {
      walk(target);
    } else {
      for (const child of node.children) walk(child); // coordinate: whole packet
    }
  };
  walk(root);
  return out;
}

/** A proposition's identity and corpus extent, for verse attachment. */
export interface PropExtent {
  pid: string;
  srcStart: number | null;
  srcEnd: number | null;
}

/**
 * Which proposition ROW each English verse renders above: the row holding the
 * verse's first word — clamped to the document's opening when the analyzed
 * range starts mid-verse, and pushed to the next corpus row when the exact
 * word fell into a gap (a degraded merge). Raw propositions never attract
 * verses. Returns pid -> verses, verses in corpus order.
 */
export function attachVerses(
  props: readonly PropExtent[],
  verses: readonly VerseText[],
): Map<string, VerseText[]> {
  const corpus = props.filter(
    (p): p is PropExtent & { srcStart: number; srcEnd: number } =>
      typeof p.srcStart === 'number' && typeof p.srcEnd === 'number',
  );
  const out = new Map<string, VerseText[]>();
  if (corpus.length === 0) return out;
  const minStart = Math.min(...corpus.map((p) => p.srcStart));

  for (const verse of verses) {
    const at = Math.max(verse.start, minStart);
    const holder =
      corpus.find((p) => p.srcStart <= at && at <= p.srcEnd) ??
      corpus.find((p) => p.srcStart > at);
    if (holder === undefined) continue;
    const list = out.get(holder.pid);
    if (list === undefined) {
      out.set(holder.pid, [verse]);
    } else {
      list.push(verse);
    }
  }
  return out;
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
