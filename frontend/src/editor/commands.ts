// Editing commands for the bracketing editor. Each command takes the Tiptap
// Editor plus plain arguments, and either dispatches exactly ONE transaction
// and reports success, or dispatches nothing and reports failure.
//
// Three rules shape everything below:
//
//  1. Brackets are created BINARY ONLY. Legacy n-ary brackets still load and
//     display, but any op whose meaning assumes two children (flipStar) no-ops
//     on them.
//  2. NOTHING recomputes globally. A command applies its own local operation
//     and nothing else — no relabeling sweep, no re-indexing of unrelated
//     nodes. (Structure above a proposition that an edit invalidates is
//     dissolved explicitly, by unzipToRoot, not silently repaired.)
//  3. `reversed` is DERIVED, never toggled: on a binary subordinate bracket
//     reversed = (prominent !== entry.starredLabel), so the starred end always
//     shows labels[starredLabel] and the other end labels[1 - starredLabel].
//     Coordinate and n-ary brackets are never reversed.
//
// The document is a FOREST: the ProseMirror doc's content is 'unit+', so roots
// may be bare propositions. Connecting/disconnecting roots is how structure
// is built and taken apart.

import type { Editor } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import type { CorpusWord, TaxonomyEntry } from '../types';
import { displayWordText } from './convert';

/**
 * Dispatch a command's single transaction as its own UNDO STEP.
 *
 * prosemirror-history groups transactions that arrive within its newGroupDelay
 * (500ms) into one event — right for typing, wrong here: this editor has no
 * text input at all (see editor.ts), so every transaction is a discrete
 * structural gesture. Without closing the group first, two gestures made in
 * quick succession — confirm a flag, then split a proposition — would undo
 * together, which is the opposite of the "one gesture, one command, one undo
 * step" rule this module is built on.
 */
function dispatch(editor: Editor, tr: Transaction): void {
  editor.view.dispatch(closeHistory(tr));
}

/** U+2032 PRIME — suffixed to the label of a split's second half. */
export const PRIME = '′';

/**
 * Default prominent child index for a relationship: null for coordinate;
 * for subordinate, the taxonomy's starredLabel index used as a child index
 * (clamped into [0, childCount-1]).
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

/**
 * The derived `reversed` (see rule 3). True only when a BINARY SUBORDINATE
 * bracket stars the child that is not the taxonomy's starred end.
 */
export function derivedReversed(
  entry: TaxonomyEntry,
  childCount: number,
  prominent: number | null,
): boolean {
  if (entry.coordinate || childCount !== 2 || prominent === null) return false;
  return prominent !== (entry.starredLabel ?? 0);
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
  dispatch(editor, tr);
  return true;
}

// ---------------------------------------------------------------------------
// Bracket attributes

/**
 * Change the relationship of the bracket at `pos`. `prominent` is fixed up
 * locally: null for a coordinate target; for a subordinate target the existing
 * index is kept (clamped into range) or, coming from coordinate, defaults per
 * the taxonomy's starredLabel. `reversed` is re-derived. `flag` is kept.
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
  return setBracketAttrs(editor, pos, node, {
    rel,
    prominent,
    reversed: derivedReversed(entry, node.childCount, prominent),
  });
}

/**
 * Move the star to the other child of a BINARY SUBORDINATE bracket, and
 * re-derive `reversed` so the label at each end follows the star. Returns
 * false for coordinate brackets, for n-ary (legacy) brackets, and for a
 * relationship the taxonomy doesn't know.
 */
export function flipStar(
  editor: Editor,
  pos: number,
  taxonomy: readonly TaxonomyEntry[],
): boolean {
  const node = bracketAt(editor, pos);
  if (node === null) return false;
  if (node.childCount !== 2) return false; // legacy n-ary: no binary flip
  const prominent = node.attrs.prominent;
  if (typeof prominent !== 'number') return false; // coordinate: no star
  const entry = taxonomyEntry(taxonomy, String(node.attrs.rel));
  if (entry === undefined || entry.coordinate) return false;

  const next = 1 - prominent;
  return setBracketAttrs(editor, pos, node, {
    prominent: next,
    reversed: derivedReversed(entry, 2, next),
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
// Forest structure: connect / disconnect roots

/** Index of the doc child at `pos`, or null when `pos` is not a root unit. */
function rootIndexAt(doc: PMNode, pos: number): number | null {
  if (pos < 0 || pos >= doc.content.size) return null;
  const node = doc.nodeAt(pos);
  if (node === null) return null;
  const $pos = doc.resolve(pos);
  if ($pos.depth !== 0) return null;
  return $pos.index(0);
}

/**
 * Connect two ADJACENT forest roots into one new BINARY bracket, in document
 * order, with relationship `rel` (default 'Ser' — a coordinate series, no
 * star, no flag). `posA`/`posB` are the positions of two top-level doc
 * children in either order.
 *
 * Rejected (returns null, dispatching nothing) when either position is not a
 * root, when they are the same root, when their indices differ by more than 1,
 * or when `rel` is not in the taxonomy.
 *
 * @returns the new bracket's position, or null.
 */
export function connectUnits(
  editor: Editor,
  posA: number,
  posB: number,
  taxonomy: readonly TaxonomyEntry[],
  rel = 'Ser',
): number | null {
  const entry = taxonomyEntry(taxonomy, rel);
  if (entry === undefined) return null;

  const { state } = editor;
  const { doc } = state;
  const indexA = rootIndexAt(doc, posA);
  const indexB = rootIndexAt(doc, posB);
  if (indexA === null || indexB === null) return null;
  if (Math.abs(indexA - indexB) !== 1) return null; // same root or not adjacent

  const from = Math.min(posA, posB);
  const to = Math.max(posA, posB);
  const first = doc.nodeAt(from);
  const second = doc.nodeAt(to);
  if (first === null || second === null) return null;

  const bracketType = state.schema.nodes.bracket;
  if (bracketType === undefined) return null;

  const prominent = defaultProminent(entry, 2);
  const bracket = bracketType.create(
    {
      rel,
      prominent,
      reversed: derivedReversed(entry, 2, prominent),
      flag: null,
    },
    [first, second],
  );

  dispatch(editor, state.tr.replaceWith(from, to + second.nodeSize, bracket));
  return from;
}

/**
 * Dissolve a ROOT bracket: its children become adjacent roots in its place
 * (the doc's 'unit+' content allows it). Nothing else in the document moves.
 * Returns false for a nested bracket (disconnect its root ancestors first —
 * see unzipToRoot) and for a non-bracket position.
 */
export function disconnectRoot(editor: Editor, pos: number): boolean {
  const node = bracketAt(editor, pos);
  if (node === null) return false;
  const { state } = editor;
  if (state.doc.resolve(pos).depth !== 0) return false; // nested: not a root

  dispatch(editor, state.tr.replaceWith(pos, pos + node.nodeSize, node.content));
  return true;
}

/**
 * Dissolve, inside `tr`, every bracket between the proposition `pid` and the
 * forest floor, outermost first, until the proposition is itself a root. Each
 * round re-locates the proposition (the previous replace moved it).
 */
function unzipInTransaction(tr: Transaction, pid: string): boolean {
  for (;;) {
    const pos = findPropositionPos(tr.doc, pid);
    if (pos === null) return false;
    const $pos = tr.doc.resolve(pos);
    if ($pos.depth === 0) return true; // already a root
    const rootPos = $pos.before(1);
    const root = tr.doc.nodeAt(rootPos);
    if (root === null) return false;
    tr.replaceWith(rootPos, rootPos + root.nodeSize, root.content);
  }
}

/**
 * Disconnect the chain of brackets above the proposition `pid` until it is a
 * root of the forest. Every bracket that contained it is dissolved (its other
 * children become roots too); nothing else is touched.
 *
 * Exported for tests and for the commands that need it (splitting a
 * proposition, or merging two that live in different trees, invalidates every
 * connection above them, so those connections are removed rather than
 * silently reinterpreted).
 */
export function unzipToRoot(editor: Editor, pid: string): boolean {
  const tr = editor.state.tr;
  if (!unzipInTransaction(tr, pid)) return false;
  if (tr.docChanged) dispatch(editor, tr);
  return true;
}

// ---------------------------------------------------------------------------
// Proposition split / merge (implicit propositions are the interpreter's call
// — the editor must let the user divide and re-join propositions freely).

/** An unused proposition id of the form p<n>, given the ids already in `doc`. */
export function freshPid(doc: PMNode): string {
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

/** Display text for an inclusive corpus word range (apparatus sigla stripped). */
export function corpusText(
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
 * Split the proposition at `pos` into two ROOT propositions: the first keeps
 * the pid and label, the second gets a fresh pid and the same label with a
 * prime (′) appended. `firstCount` is the number of words in the FIRST half
 * (a UI wanting "split after the word I clicked" passes clickedOrdinal + 1);
 * it must be >= 1 and < the proposition's word count.
 *
 * A proposition that is not already a root is unzipped first: the chain of
 * connections above it described the undivided proposition and cannot survive
 * its splitting, so those brackets are dissolved. Nothing else is relabeled or
 * re-indexed, and the whole operation is ONE undo step.
 *
 * Corpus sources divide their word range (needs `words` covering it); raw
 * sources divide their whitespace-separated tokens.
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
  const type = state.schema.nodes.proposition;
  if (type === undefined) return false;

  const attrs = node.attrs;
  const pid = String(attrs.pid);
  const label = String(attrs.label ?? '');
  const pidB = freshPid(state.doc);

  // Validate and compute both halves BEFORE touching the document, so a
  // rejected split dispatches nothing at all.
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
      label: label + PRIME,
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
    attrsB = { ...attrs, pid: pidB, label: label + PRIME, text: bText, rawText: bText };
  }

  const tr = state.tr;
  if (!unzipInTransaction(tr, pid)) return false;
  const rootPos = findPropositionPos(tr.doc, pid);
  if (rootPos === null) return false;
  const root = tr.doc.nodeAt(rootPos);
  if (root === null) return false;

  tr.replaceWith(rootPos, rootPos + root.nodeSize, [
    type.create(attrsA),
    type.create(attrsB),
  ]);
  dispatch(editor, tr);
  return true;
}

/** Every proposition node in document order. */
function propositionsInOrder(doc: PMNode): { pos: number; node: PMNode }[] {
  const out: { pos: number; node: PMNode }[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'proposition') {
      out.push({ pos, node });
      return false;
    }
    return true;
  });
  return out;
}

/**
 * Merge the proposition `pid` with the NEXT proposition in document order,
 * wherever in the forest that one lives. Both are unzipped to roots first (so
 * they end up adjacent roots — nothing sits between two consecutive
 * propositions once their brackets are gone), then joined into a single root
 * proposition keeping the FIRST one's pid and label.
 *
 * Contiguous corpus ranges re-join into one range (text rebuilt from `words`,
 * apparatus sigla stripped); anything else degrades to a raw source with the
 * two display texts joined. One undo step. Returns false when `pid` is the
 * last proposition, or is not in the document.
 */
export function mergeBelow(
  editor: Editor,
  pid: string,
  words: ReadonlyMap<number, CorpusWord> | null,
): boolean {
  const { state } = editor;
  const type = state.schema.nodes.proposition;
  if (type === undefined) return false;

  const props = propositionsInOrder(state.doc);
  const index = props.findIndex((p) => String(p.node.attrs.pid) === pid);
  if (index === -1) return false;
  const nextEntry = props[index + 1];
  if (nextEntry === undefined) return false; // last proposition
  const nextPid = String(nextEntry.node.attrs.pid);

  const a = props[index]!.node.attrs;
  const b = nextEntry.node.attrs;
  let merged: Record<string, unknown>;
  if (
    typeof a.srcStart === 'number' && typeof a.srcEnd === 'number' &&
    typeof b.srcStart === 'number' && typeof b.srcEnd === 'number' &&
    a.srcEnd + 1 === b.srcStart
  ) {
    const text = words !== null
      ? corpusText(words, a.srcStart, b.srcEnd)
      : `${String(a.text)} ${String(b.text)}`.trim();
    merged = { ...a, srcEnd: b.srcEnd, text };
  } else {
    const text = `${String(a.text)} ${String(b.text)}`.trim();
    merged = { ...a, srcStart: null, srcEnd: null, rawText: text, text };
  }

  const tr = state.tr;
  if (!unzipInTransaction(tr, pid)) return false;
  if (!unzipInTransaction(tr, nextPid)) return false;

  const posA = findPropositionPos(tr.doc, pid);
  const posB = findPropositionPos(tr.doc, nextPid);
  if (posA === null || posB === null) return false;
  const nodeA = tr.doc.nodeAt(posA);
  const nodeB = tr.doc.nodeAt(posB);
  if (nodeA === null || nodeB === null) return false;
  // Both are roots now, and consecutive propositions with nothing between.
  if (posA + nodeA.nodeSize !== posB) return false;

  tr.replaceWith(posA, posB + nodeB.nodeSize, type.create(merged));
  dispatch(editor, tr);
  return true;
}

// ---------------------------------------------------------------------------
// Lookups

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

/**
 * All bracket nodes with their positions, in document (pre-)order — the same
 * order layoutBrackets emits its BracketGeoms and layoutDots numbers its
 * 'bracket:<preorderIndex>' ids, so the two zip index-for-index.
 */
export function findBrackets(doc: PMNode): BracketHit[] {
  const hits: BracketHit[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'bracket') hits.push({ pos, node });
    return true;
  });
  return hits;
}
