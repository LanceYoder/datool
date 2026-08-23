// Editing commands for the bracketing editor. Each command takes the Tiptap
// Editor plus plain arguments, returns true and dispatches exactly one
// transaction on success, or returns false (dispatching nothing) when the
// operation is invalid.
//
// ProseMirror's content expressions guarantee bracket arity and the single
// root; these commands additionally maintain the attribute-level invariant:
// `prominent` is a valid child index iff the relationship is subordinate,
// and null iff it is coordinate.

import type { Editor } from '@tiptap/core';
import type { Node as PMNode, NodeRange } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { findWrapping } from '@tiptap/pm/transform';
import type { CorpusWord, TaxonomyEntry } from '../types';
import { displayWordText } from './convert';

/**
 * Default prominent child index for a relationship: null for coordinate;
 * for subordinate, the taxonomy's starredLabel index used as a child index
 * (clamped into [0, childCount-1]; callers can move it afterwards).
 */
export function defaultProminent(
  entry: TaxonomyEntry,
  childCount: number,
): number | null {
  if (entry.coordinate) return null;
  const idx = entry.starredLabel ?? 0;
  return Math.min(Math.max(idx, 0), Math.max(childCount - 1, 0));
}

function taxonomyEntry(
  taxonomy: readonly TaxonomyEntry[],
  rel: string,
): TaxonomyEntry | undefined {
  return taxonomy.find((entry) => entry.code === rel);
}

function bracketAt(editor: Editor, pos: number): PMNode | null {
  const { doc } = editor.state;
  if (pos < 0 || pos >= doc.content.size) return null;
  const node = doc.nodeAt(pos);
  return node !== null && node.type.name === 'bracket' ? node : null;
}

/** Replace a bracket's attrs wholesale (merged over the current attrs). */
function setBracketAttrs(
  editor: Editor,
  pos: number,
  node: PMNode,
  changes: Record<string, unknown>,
): boolean {
  const tr = editor.state.tr.setNodeMarkup(pos, undefined, {
    ...node.attrs,
    ...changes,
  });
  editor.view.dispatch(tr);
  return true;
}

interface WrapTarget {
  range: NodeRange;
  childCount: number;
}

/** The covering sibling run for [from, to], when it is a wrappable target. */
function wrapTarget(state: EditorState, from: number, to: number): WrapTarget | null {
  const { doc } = state;
  if (from < 0 || to > doc.content.size || from > to) return null;
  const range = doc.resolve(from).blockRange(doc.resolve(to));
  if (range === null) return null;
  const childCount = range.endIndex - range.startIndex;
  if (childCount < 2) return null;
  return { range, childCount };
}

/** Dry-run of wrapUnits — true when the positions cover a wrappable run. */
export function canWrapUnits(state: EditorState, from: number, to: number): boolean {
  const target = wrapTarget(state, from, to);
  if (target === null) return false;
  const bracketType = state.schema.nodes.bracket;
  if (bracketType === undefined) return false;
  // Attrs don't affect content matching; dummy values suffice for the check.
  return (
    findWrapping(target.range, bracketType, {
      rel: 'Ser',
      prominent: null,
      reversed: false,
      flag: null,
    }) !== null
  );
}

/**
 * Wrap the contiguous sibling units covering doc positions [from, to] in a
 * new bracket with relationship `rel`. The covering set is the deepest run
 * of adjacent siblings spanning both positions. Rejects (returns false) when
 * that set has fewer than 2 units, when `rel` is not in the taxonomy, or when
 * wrapping would invalidate the parent (e.g. wrapping ALL children of a
 * bracket, which would leave it a single child).
 */
export function wrapUnits(
  editor: Editor,
  from: number,
  to: number,
  rel: string,
  taxonomy: readonly TaxonomyEntry[],
): boolean {
  const entry = taxonomyEntry(taxonomy, rel);
  if (entry === undefined) return false;

  const { state } = editor;
  const target = wrapTarget(state, from, to);
  if (target === null) return false;
  const { range, childCount } = target;

  const bracketType = state.schema.nodes.bracket;
  if (bracketType === undefined) return false;

  const attrs = {
    rel,
    prominent: defaultProminent(entry, childCount),
    reversed: false,
    flag: null,
  };
  const wrapping = findWrapping(range, bracketType, attrs);
  if (wrapping === null) return false;

  let tr = state.tr.wrap(range, wrapping);

  // Re-index the parent bracket's star: the wrapped run collapses to one
  // child, so an index inside the run moves to the new packet and indices
  // past it shift left by (childCount - 1). The parent's own start position
  // is unchanged by the wrap (it happens inside it).
  const parent = range.parent;
  if (parent.type.name === 'bracket' && typeof parent.attrs.prominent === 'number') {
    const prom = parent.attrs.prominent;
    let next = prom;
    if (prom >= range.startIndex && prom < range.endIndex) {
      next = range.startIndex;
    } else if (prom >= range.endIndex) {
      next = prom - (childCount - 1);
    }
    if (next !== prom) {
      const parentPos = range.$from.before(range.depth);
      tr = tr.setNodeMarkup(parentPos, undefined, {
        ...parent.attrs,
        prominent: next,
      });
    }
  }

  editor.view.dispatch(tr);
  return true;
}

/**
 * Dissolve the bracket at `pos`, splicing its children into the parent in
 * place. The parent's `prominent` is re-indexed: indices past the splice
 * shift by (childCount - 1); if the lifted bracket itself was prominent, the
 * parent's star moves to the lifted bracket's own prominent child (its first
 * child when it was coordinate). Returns false for the root bracket — its
 * >= 2 children cannot live at the top level (doc content is a single unit).
 */
export function liftBracket(editor: Editor, pos: number): boolean {
  const node = bracketAt(editor, pos);
  if (node === null) return false;

  const { state } = editor;
  const $pos = state.doc.resolve(pos);
  const parent = $pos.parent;
  if (parent.type.name !== 'bracket') return false; // root bracket: disallowed

  const index = $pos.index($pos.depth);
  const spliceCount = node.childCount;

  let tr = state.tr.replaceWith(pos, pos + node.nodeSize, node.content);

  const prom = parent.attrs.prominent;
  if (typeof prom === 'number') {
    let next = prom;
    if (prom > index) {
      next = prom + spliceCount - 1;
    } else if (prom === index) {
      const inner = node.attrs.prominent;
      next = index + (typeof inner === 'number' ? inner : 0);
    }
    if (next !== prom) {
      const parentPos = $pos.before($pos.depth);
      tr = tr.setNodeMarkup(parentPos, undefined, {
        ...parent.attrs,
        prominent: next,
      });
    }
  }

  editor.view.dispatch(tr);
  return true;
}

/**
 * Change the relationship of the bracket at `pos`. Fixes `prominent`:
 * null for a coordinate target; for a subordinate target the existing index
 * is kept (clamped into range) or, coming from coordinate, defaults per the
 * taxonomy's starredLabel. `reversed` and `flag` are kept.
 */
export function setRelationship(
  editor: Editor,
  pos: number,
  rel: string,
  taxonomy: readonly TaxonomyEntry[],
): boolean {
  const entry = taxonomyEntry(taxonomy, rel);
  if (entry === undefined) return false;
  const node = bracketAt(editor, pos);
  if (node === null) return false;

  let prominent: number | null = null;
  if (!entry.coordinate) {
    const current = node.attrs.prominent;
    prominent =
      typeof current === 'number'
        ? Math.min(Math.max(current, 0), node.childCount - 1)
        : defaultProminent(entry, node.childCount);
  }
  return setBracketAttrs(editor, pos, node, { rel, prominent });
}

/**
 * Move the star. Only valid on subordinate brackets (prominent !== null) and
 * for an in-range child index.
 */
export function setProminent(
  editor: Editor,
  pos: number,
  index: number,
): boolean {
  const node = bracketAt(editor, pos);
  if (node === null) return false;
  if (node.attrs.prominent === null) return false; // coordinate: no star
  if (!Number.isInteger(index) || index < 0 || index >= node.childCount) {
    return false;
  }
  return setBracketAttrs(editor, pos, node, { prominent: index });
}

/** Swap which taxonomy label sits at which end of the bracket. */
export function toggleReversed(editor: Editor, pos: number): boolean {
  const node = bracketAt(editor, pos);
  if (node === null) return false;
  return setBracketAttrs(editor, pos, node, {
    reversed: node.attrs.reversed !== true,
  });
}

/** Clear the review flag (flag -> null). */
export function confirmFlag(editor: Editor, pos: number): boolean {
  const node = bracketAt(editor, pos);
  if (node === null) return false;
  return setBracketAttrs(editor, pos, node, { flag: null });
}

/** Mark the bracket for review (flag -> 'review'). */
export function setFlag(
  editor: Editor,
  pos: number,
  flag: 'review' = 'review',
): boolean {
  const node = bracketAt(editor, pos);
  if (node === null) return false;
  return setBracketAttrs(editor, pos, node, { flag });
}

// ---------------------------------------------------------------------------
// Proposition split / merge (implicit propositions are the interpreter's call
// — the editor must let the user divide and re-join propositions freely).

function freshPid(doc: PMNode): string {
  const taken = new Set<string>();
  let max = 0;
  doc.descendants((node) => {
    if (node.type.name === 'proposition') {
      const pid = String(node.attrs.pid);
      taken.add(pid);
      const m = /^p(\d+)$/.exec(pid);
      if (m !== null) max = Math.max(max, Number(m[1]));
    }
    return true;
  });
  let n = max + 1;
  while (taken.has(`p${n}`)) n += 1;
  return `p${n}`;
}

function verseLetter(i: number): string {
  let s = '';
  i += 1;
  while (i > 0) {
    const r = (i - 1) % 26;
    s = String.fromCharCode(97 + r) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

/**
 * Recompute all proposition labels in `tr.doc` (mirrors the server's
 * labeling): verse number + letter when a verse holds several propositions,
 * bare verse number otherwise; sequential numbers when any proposition lacks
 * corpus words to read a verse from.
 */
export function relabelPropositions(
  tr: Transaction,
  words: ReadonlyMap<number, CorpusWord> | null,
): Transaction {
  const props: { pos: number; node: PMNode }[] = [];
  tr.doc.descendants((node, pos) => {
    if (node.type.name === 'proposition') {
      props.push({ pos, node });
      return false;
    }
    return true;
  });

  const verses: (number | null)[] = [];
  for (const { node } of props) {
    const start = node.attrs.srcStart;
    const own = typeof start === 'number' ? words?.get(start)?.verse ?? null : null;
    // A raw proposition (e.g. one split out of a corpus line) belongs to the
    // running verse of the passage.
    verses.push(own ?? verses[verses.length - 1] ?? null);
  }
  let labels: string[];
  if (verses.every((v) => v !== null)) {
    const counts = new Map<number, number>();
    for (const v of verses) counts.set(v as number, (counts.get(v as number) ?? 0) + 1);
    const seen = new Map<number, number>();
    labels = verses.map((v) => {
      const verse = v as number;
      const nth = seen.get(verse) ?? 0;
      seen.set(verse, nth + 1);
      return (counts.get(verse) ?? 0) > 1 ? `${verse}${verseLetter(nth)}` : String(verse);
    });
  } else {
    labels = props.map((_, i) => String(i + 1));
  }

  props.forEach(({ pos, node }, i) => {
    if (node.attrs.label !== labels[i]) {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, label: labels[i] });
    }
  });
  return tr;
}

function corpusText(
  words: ReadonlyMap<number, CorpusWord>,
  start: number,
  end: number,
): string {
  const parts: string[] = [];
  for (let i = start; i <= end; i += 1) {
    const w = words.get(i);
    if (w !== undefined) parts.push(displayWordText(w.text));
  }
  return parts.join(' ');
}

/**
 * Split the proposition at `pos` so its first `firstCount` words stay in it
 * and the rest become a new sibling proposition right after it. Corpus
 * sources divide their word range (requires `words` covering it); raw
 * sources divide their whitespace-separated tokens. Labels are recomputed.
 */
export function splitProposition(
  editor: Editor,
  pos: number,
  firstCount: number,
  words: ReadonlyMap<number, CorpusWord> | null,
): boolean {
  const { state } = editor;
  const node = state.doc.nodeAt(pos);
  if (node === null || node.type.name !== 'proposition') return false;
  const attrs = node.attrs;
  const type = state.schema.nodes.proposition;
  if (type === undefined) return false;
  const pidB = freshPid(state.doc);

  let attrsA: Record<string, unknown>;
  let attrsB: Record<string, unknown>;
  if (typeof attrs.srcStart === 'number' && typeof attrs.srcEnd === 'number') {
    if (words === null) return false;
    const total = attrs.srcEnd - attrs.srcStart + 1;
    if (!Number.isInteger(firstCount) || firstCount < 1 || firstCount >= total) return false;
    const midEnd = attrs.srcStart + firstCount - 1;
    attrsA = { ...attrs, srcEnd: midEnd, text: corpusText(words, attrs.srcStart, midEnd) };
    attrsB = {
      ...attrs,
      pid: pidB,
      srcStart: midEnd + 1,
      text: corpusText(words, midEnd + 1, attrs.srcEnd),
    };
  } else {
    const tokens = String(attrs.text ?? attrs.rawText ?? '').split(/\s+/).filter(Boolean);
    if (!Number.isInteger(firstCount) || firstCount < 1 || firstCount >= tokens.length) {
      return false;
    }
    const aText = tokens.slice(0, firstCount).join(' ');
    const bText = tokens.slice(firstCount).join(' ');
    attrsA = { ...attrs, text: aText, rawText: aText };
    attrsB = { ...attrs, pid: pidB, text: bText, rawText: bText };
  }

  let tr = state.tr.replaceWith(pos, pos + node.nodeSize, [
    type.create(attrsA),
    type.create(attrsB),
  ]);

  const $pos = state.doc.resolve(pos);
  const parent = $pos.parent;
  if (parent.type.name === 'bracket' && typeof parent.attrs.prominent === 'number') {
    const index = $pos.index();
    if (parent.attrs.prominent > index) {
      tr = tr.setNodeMarkup($pos.before(), undefined, {
        ...parent.attrs,
        prominent: parent.attrs.prominent + 1,
      });
    }
  }

  editor.view.dispatch(relabelPropositions(tr, words));
  return true;
}

/**
 * Merge the proposition at `pos` with its next sibling proposition.
 * Contiguous corpus sources merge their ranges; anything else merges into a
 * raw source with the joined text. Refused when the shared parent is a
 * bracket with only these two children (it would be left with one — dissolve
 * it instead). Labels are recomputed.
 */
export function mergeWithNext(
  editor: Editor,
  pos: number,
  words: ReadonlyMap<number, CorpusWord> | null,
): boolean {
  const { state } = editor;
  const node = state.doc.nodeAt(pos);
  if (node === null || node.type.name !== 'proposition') return false;
  const $pos = state.doc.resolve(pos);
  const parent = $pos.parent;
  const index = $pos.index();
  if (index + 1 >= parent.childCount) return false;
  const next = parent.child(index + 1);
  if (next.type.name !== 'proposition') return false;
  if (parent.type.name === 'bracket' && parent.childCount <= 2) return false;

  const a = node.attrs;
  const b = next.attrs;
  let merged: Record<string, unknown>;
  if (
    typeof a.srcStart === 'number' && typeof a.srcEnd === 'number' &&
    typeof b.srcStart === 'number' && typeof b.srcEnd === 'number' &&
    a.srcEnd + 1 === b.srcStart
  ) {
    const text = words !== null
      ? corpusText(words, a.srcStart, b.srcEnd)
      : `${String(a.text)} ${String(b.text)}`;
    merged = { ...a, srcEnd: b.srcEnd, text };
  } else {
    const text = `${String(a.text)} ${String(b.text)}`.trim();
    merged = { ...a, srcStart: null, srcEnd: null, rawText: text, text };
  }

  const type = state.schema.nodes.proposition;
  if (type === undefined) return false;
  let tr = state.tr.replaceWith(
    pos,
    pos + node.nodeSize + next.nodeSize,
    type.create(merged),
  );

  if (parent.type.name === 'bracket' && typeof parent.attrs.prominent === 'number') {
    const prom = parent.attrs.prominent;
    const nextProm = prom === index + 1 ? index : prom > index + 1 ? prom - 1 : prom;
    if (nextProm !== prom) {
      tr = tr.setNodeMarkup($pos.before(), undefined, {
        ...parent.attrs,
        prominent: nextProm,
      });
    }
  }

  editor.view.dispatch(relabelPropositions(tr, words));
  return true;
}

/** Position of the proposition node with the given pid, or null. */
export function findPropositionPos(doc: PMNode, pid: string): number | null {
  let found: number | null = null;
  doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.type.name === 'proposition' && node.attrs.pid === pid) {
      found = pos;
      return false;
    }
    return true;
  });
  return found;
}

export interface BracketHit {
  pos: number;
  node: PMNode;
}

/** All bracket nodes with their positions, in document (pre-)order. */
export function findBrackets(doc: PMNode): BracketHit[] {
  const hits: BracketHit[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'bracket') hits.push({ pos, node });
    return true;
  });
  return hits;
}
