// Pure helpers for the editor's interaction layer. No DOM, no editor instance —
// everything here is a plain function over data, so it is unit-testable and the
// React layer stays thin.
//
// The editor CORE (commands.ts, layout.ts) is untouched by this module: these
// are only the small lookups the UI needs on top of it — grouping the taxonomy
// for the relationship menu, reading a dot id back apart, and keeping a
// popover on screen.

import type { CorpusWord, TaxonomyEntry, TreeNode } from '../types';

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

/**
 * Keyboard shortcut per relationship code — what the menu shows in parentheses
 * and what typing that key picks while the menu is open.
 *
 * Mnemonics follow the relationship's own name or SYMBOL — the symbol wins
 * where it is the more familiar handle ('/' Comparison for //, '?'
 * Conditional for C?/E), the name elsewhere (c Cause–Effect, g Ground,
 * i Inference, m Means–End, t Temporal, l Locative …). Where two names
 * competed for a letter the more common relationship kept it and the other
 * took its next distinctive letter (v adVersative, r situation–Response).
 * General–Specific is the one arbitrary key ('x'): every letter in its name
 * was already taken.
 */
export const RELATIONSHIP_KEYS: Record<string, string> = {
  Ser: 's',
  Prog: 'p',
  Alt: 'a',
  WEd: 'w',
  Cmp: '/',
  NegPos: 'n',
  GnSp: 'x',
  FtIn: 'f',
  Grnd: 'g',
  Inf: 'i',
  CE: 'c',
  CndE: '?',
  MEd: 'm',
  Tmp: 't',
  Loc: 'l',
  Adv: 'v',
  QA: 'q',
  SR: 'r',
};

/** The shortcut key for a relationship code, or null when it has none. */
export function shortcutFor(code: string): string | null {
  return RELATIONSHIP_KEYS[code] ?? null;
}

/**
 * The relationship a typed key selects, or null. Only codes actually present
 * in `taxonomy` can be picked, so a key for a retired relationship is inert.
 */
export function relationshipForKey(
  key: string,
  taxonomy: readonly TaxonomyEntry[],
): string | null {
  const wanted = key.toLowerCase();
  for (const entry of taxonomy) {
    if (RELATIONSHIP_KEYS[entry.code] === wanted) return entry.code;
  }
  return null;
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
 * brackets and fans out across a coordinate bracket's whole packet — except
 * Progression, which climaxes: its point is its LAST member (the course's
 * worked diagrams underline only the final step of a P). Mirrors the
 * server's main_point.
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
      prom !== null && prom !== undefined
        ? node.children[prom]
        : node.rel === 'Prog'
          ? node.children[node.children.length - 1]
          : undefined;
    if (target !== undefined) {
      walk(target);
    } else {
      for (const child of node.children) walk(child); // coordinate: whole packet
    }
  };
  walk(root);
  return out;
}

/** One run of a row's English line: an optional verse marker, then text. */
export interface EnglishSegment {
  /** Verse number shown before the text — only where a verse BEGINS. */
  marker: number | null;
  text: string;
}

/**
 * The English reference line for one proposition, built from ITS OWN words'
 * contextual renderings (TAGNT `eng`), so the line matches the proposition
 * exactly however the verses were divided. A verse-number marker opens a
 * segment only where that verse's FIRST word sits in this row — a row
 * continuing mid-verse gets bare text. Words without an aligned rendering
 * are skipped; a row with none yields [].
 */
export function rowEnglish(
  srcStart: number,
  srcEnd: number,
  words: ReadonlyMap<number, CorpusWord>,
): EnglishSegment[] {
  const out: EnglishSegment[] = [];
  let current: { marker: number | null; parts: string[] } | null = null;

  const flush = (): void => {
    if (current !== null && current.parts.length > 0) {
      out.push({ marker: current.marker, text: current.parts.join(' ') });
    }
  };

  for (let i = srcStart; i <= srcEnd; i += 1) {
    const w = words.get(i);
    if (w === undefined) continue;
    const prev = words.get(i - 1);
    const verseInitial =
      prev === undefined ||
      prev.book !== w.book ||
      prev.chapter !== w.chapter ||
      prev.verse !== w.verse;
    if (current === null) {
      current = { marker: verseInitial ? w.verse : null, parts: [] };
    } else if (verseInitial) {
      flush();
      current = { marker: w.verse, parts: [] };
    }
    if (w.eng !== null && w.eng !== '') current.parts.push(w.eng);
  }
  flush();
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
