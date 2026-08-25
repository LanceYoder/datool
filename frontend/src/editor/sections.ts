// Color blocks: the analyst's division of a passage into sections.
//
// A block is stored as the pid that BEGINS it, TOGETHER WITH ITS COLOR — a
// block keeps its color for as long as it exists, however many blocks are
// added or removed around it. The document always opens inside its first
// block, which is not stored and always wears the first palette color; only
// the later starts are recorded, so no breaks at all means the passage is
// one undivided block. Nothing here touches the tree: sections are a reading
// of the passage, not of its structure.
//
// Pure functions over pid lists, so the rules are testable without a DOM.

import type { SectionBreak } from '../types';

/**
 * Block colors, in the order they are handed out. Backgrounds are muted and
 * dusty — they sit UNDER Greek and English and must never compete with the
 * words; the strip color is the same hue with enough saturation to read as a
 * label down the edge of the page.
 */
export const SECTION_COLORS: readonly { background: string; strip: string }[] = [
  { background: '#efe0e0', strip: '#c08a8a' }, // dusty rose
  { background: '#dfe7de', strip: '#89a88b' }, // sage
  { background: '#dde4ec', strip: '#8199b4' }, // dusty blue
  { background: '#f0e8d9', strip: '#c0a97e' }, // sand
  { background: '#e6e0ec', strip: '#9a8cb0' }, // mauve
  { background: '#f0e2d7', strip: '#c2947a' }, // clay
  { background: '#dae5e5', strip: '#83a5a3' }, // slate teal
  { background: '#e7e8d9', strip: '#a3a87e' }, // olive
];

/** The palette entry for a stored color number, cycling past the palette. */
export function sectionColor(color: number): { background: string; strip: string } {
  const colors = SECTION_COLORS;
  return colors[((color % colors.length) + colors.length) % colors.length] ?? colors[0]!;
}

/**
 * Bring a stored break list to the {start, color} shape. Documents written
 * before colors were stored carried plain pid strings, whose colors were
 * derived from position — that derivation is frozen here (index + 1: the
 * unstored first block is color 0).
 */
export function normalizeBreaks(raw: unknown): SectionBreak[] {
  if (!Array.isArray(raw)) return [];
  const out: SectionBreak[] = [];
  for (const entry of raw) {
    if (typeof entry === 'string') {
      out.push({ start: entry, color: out.length + 1 });
    } else if (
      entry !== null &&
      typeof entry === 'object' &&
      typeof (entry as SectionBreak).start === 'string' &&
      typeof (entry as SectionBreak).color === 'number'
    ) {
      out.push({ start: (entry as SectionBreak).start, color: (entry as SectionBreak).color });
    }
  }
  return out;
}

/**
 * Breaks pruned to what the document can still carry: only pids that exist,
 * never the first proposition, no duplicates, in proposition order. A merge
 * can strand a break; this is what keeps the stored list honest.
 */
export function pruneBreaks(
  breaks: readonly SectionBreak[],
  pids: readonly string[],
): SectionBreak[] {
  const order = new Map(pids.map((pid, i) => [pid, i]));
  const seen = new Set<string>();
  const kept = breaks.filter((b) => {
    if ((order.get(b.start) ?? 0) <= 0 || seen.has(b.start)) return false;
    seen.add(b.start);
    return true;
  });
  return kept.sort((a, b) => (order.get(a.start) ?? 0) - (order.get(b.start) ?? 0));
}

/** One block: its stored color and the propositions it holds, in order. */
export interface Section {
  color: number;
  pids: string[];
}

/**
 * The blocks a break list divides `pids` into. Always at least one block —
 * an undivided passage is a single block holding everything, in the first
 * palette color.
 */
export function sectionsOf(
  pids: readonly string[],
  breaks: readonly SectionBreak[],
): Section[] {
  const byStart = new Map(pruneBreaks(breaks, pids).map((b) => [b.start, b.color]));
  const sections: Section[] = [];
  for (const pid of pids) {
    const color = byStart.get(pid);
    if (sections.length === 0 || color !== undefined) {
      sections.push({ color: color ?? 0, pids: [pid] });
    } else {
      sections[sections.length - 1]!.pids.push(pid);
    }
  }
  return sections;
}

/** Which block color each proposition wears, by pid. */
export function sectionColorByPid(
  pids: readonly string[],
  breaks: readonly SectionBreak[],
): Map<string, number> {
  const byPid = new Map<string, number>();
  for (const section of sectionsOf(pids, breaks)) {
    for (const pid of section.pids) byPid.set(pid, section.color);
  }
  return byPid;
}

/**
 * The color for a NEW block: the first palette color no current block wears
 * (the unstored first block always wears 0), else cycling on past the
 * palette. Existing blocks never change color — a freed color simply becomes
 * available again.
 */
function nextColor(pids: readonly string[], breaks: readonly SectionBreak[]): number {
  const used = new Set(sectionsOf(pids, breaks).map((s) => s.color));
  let color = 0;
  while (used.has(color)) color += 1;
  return color;
}

/** Add a break before `pid` (no-op for the first proposition or a repeat). */
export function addBreak(
  breaks: readonly SectionBreak[],
  pids: readonly string[],
  pid: string,
): SectionBreak[] {
  const pruned = pruneBreaks(breaks, pids);
  const order = new Map(pids.map((p, i) => [p, i]));
  if ((order.get(pid) ?? 0) <= 0 || pruned.some((b) => b.start === pid)) {
    return pruned;
  }
  return pruneBreaks([...pruned, { start: pid, color: nextColor(pids, pruned) }], pids);
}

/** Remove the break before `pid`, joining that block to the one above it —
 * which keeps its own color, as does every block below. */
export function removeBreak(
  breaks: readonly SectionBreak[],
  pids: readonly string[],
  pid: string,
): SectionBreak[] {
  return pruneBreaks(
    breaks.filter((b) => b.start !== pid),
    pids,
  );
}
