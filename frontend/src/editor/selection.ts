// Unit-selection helpers for the editor UI. Pure functions over ProseMirror
// documents — the React layer stores two clicked unit positions (anchor and
// head) and derives the covered sibling run from them here.

import type { Node as PMNode } from '@tiptap/pm/model';

export interface UnitSelectionInfo {
  /** Doc positions to hand to wrapUnits (covering both clicked units). */
  from: number;
  to: number;
  /** How many sibling units the run covers. */
  count: number;
  /** Proposition ids under the covered units (for row highlighting). */
  pids: string[];
}

function collectPids(node: PMNode, out: string[]): void {
  if (node.type.name === 'proposition') {
    out.push(String(node.attrs.pid));
    return;
  }
  node.forEach((child) => {
    collectPids(child, out);
  });
}

/**
 * The minimal contiguous run of siblings covering the units at `aPos` and
 * `bPos` (each the position immediately before a proposition or bracket
 * node). Null when either position doesn't sit before a unit node.
 */
export function unitRangeInfo(
  doc: PMNode,
  aPos: number,
  bPos: number,
): UnitSelectionInfo | null {
  const size = doc.content.size;
  if (aPos < 0 || aPos >= size || bPos < 0 || bPos >= size) return null;
  const a = doc.nodeAt(aPos);
  const b = doc.nodeAt(bPos);
  if (a === null || b === null) return null;

  const from = Math.min(aPos, bPos);
  const to = Math.max(aPos + a.nodeSize, bPos + b.nodeSize);
  const range = doc.resolve(from).blockRange(doc.resolve(to));
  if (range === null) return null;

  const pids: string[] = [];
  for (let i = range.startIndex; i < range.endIndex; i += 1) {
    collectPids(range.parent.child(i), pids);
  }
  return {
    from,
    to,
    count: range.endIndex - range.startIndex,
    pids,
  };
}
