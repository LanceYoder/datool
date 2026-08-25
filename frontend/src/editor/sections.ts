// Color blocks: the analyst's division of a passage into sections.
//
// A block is stored as the pid that BEGINS it. The document always opens
// inside its first block, so only the later starts are recorded — no breaks
// at all means the passage is one undivided block. Nothing here touches the
// tree: sections are a reading of the passage, not of its structure.
//
// Pure functions over pid lists, so the rules are testable without a DOM.

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

/** The palette entry for a block, cycling once the colors run out. */
export function sectionColor(index: number): { background: string; strip: string } {
  const colors = SECTION_COLORS;
  return colors[((index % colors.length) + colors.length) % colors.length] ?? colors[0]!;
}

/**
 * Breaks pruned to what the document can still carry: only pids that exist,
 * never the first proposition, no duplicates, in proposition order. A merge or
 * a delete can strand a break; this is what keeps the stored list honest.
 */
export function pruneBreaks(breaks: readonly string[], pids: readonly string[]): string[] {
  const order = new Map(pids.map((pid, i) => [pid, i]));
  const kept = breaks.filter((pid) => (order.get(pid) ?? 0) > 0);
  const unique = [...new Set(kept)];
  unique.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  return unique;
}

/** One block: its color index and the propositions it holds, in order. */
export interface Section {
  index: number;
  pids: string[];
}

/**
 * The blocks a break list divides `pids` into. Always at least one block —
 * an undivided passage is a single block holding everything.
 */
export function sectionsOf(pids: readonly string[], breaks: readonly string[]): Section[] {
  const starts = new Set(pruneBreaks(breaks, pids));
  const sections: Section[] = [];
  for (const pid of pids) {
    if (sections.length === 0 || starts.has(pid)) {
      sections.push({ index: sections.length, pids: [pid] });
    } else {
      sections[sections.length - 1]!.pids.push(pid);
    }
  }
  return sections;
}

/** Which block each proposition falls in, by pid. */
export function sectionIndexByPid(
  pids: readonly string[],
  breaks: readonly string[],
): Map<string, number> {
  const byPid = new Map<string, number>();
  for (const section of sectionsOf(pids, breaks)) {
    for (const pid of section.pids) byPid.set(pid, section.index);
  }
  return byPid;
}

/** Add a break before `pid` (no-op for the first proposition or a repeat). */
export function addBreak(breaks: readonly string[], pids: readonly string[], pid: string): string[] {
  return pruneBreaks([...breaks, pid], pids);
}

/** Remove the break before `pid`, joining that block to the one above it. */
export function removeBreak(
  breaks: readonly string[],
  pids: readonly string[],
  pid: string,
): string[] {
  return pruneBreaks(
    breaks.filter((b) => b !== pid),
    pids,
  );
}
