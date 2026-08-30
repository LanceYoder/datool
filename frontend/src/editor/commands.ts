// Editing commands for the bracketing editor. Each command takes the Tiptap
// Editor plus plain arguments, and either dispatches exactly ONE transaction
// and reports success, or dispatches nothing and reports failure.
//
// Three rules shape everything below:
//
//  1. Brackets are created BINARY ONLY. Legacy n-ary brackets still load and
//     display, but any op whose meaning assumes two children (flipStar) no-ops
//     on them.
//  2. STRUCTURE never recomputes globally. A command applies its own local
//     operation — no re-classification, no re-indexing of unrelated nodes.
//     (Structure above a proposition that an edit invalidates is dissolved
//     explicitly, by unzipToRoot, not silently repaired.) The one re-derived
//     piece of DISPLAY state is the verse numbering: split and merge re-label
//     corpus propositions from their words' verses (11a, 11b, … — see
//     relabelCorpusInTransaction), because the corpus always knows where the
//     verses fall.
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
import type { ResolvedPos } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import type { CorpusWord, SectionBreak, TaxonomyEntry } from '../types';
import { displayWordText } from './convert';
import { addBreak, removeBreak } from './sections';

/**
 * Dispatch a command's single transaction as its own UNDO STEP.
 *
 * prosemirror-history groups transactions that arrive within its newGroupDelay
 * (500ms) into one event — right for typing, wrong here: this editor has no
 * text input at all (see editor.ts), so every transaction is a discrete
 * structural gesture. Without closing the group first, two gestures made in
 * quick succession — change a relationship, then split a proposition — would
 * undo together, which is the opposite of the "one gesture, one command, one
 * undo step" rule this module is built on.
 */
/**
 * Run a document change without letting the page move under the reader.
 *
 * Replacing a range rebuilds the React node views inside it, and for a moment
 * the document is SHORTER than the position it is scrolled to — measured at
 * 2399px falling to 2105px on a single disconnect. The browser clamps the
 * scroll to what is left, and when the rows come back there is nothing to
 * scroll back to: the clamp is permanent. Connect two units near the top of a
 * long analysis and the page snaps to the top of the page.
 *
 * So the position is taken before the change and put back after — at once,
 * and again on the next two frames, because the rows do not all return in the
 * same tick that removed them.
 */
export function keepPageScroll(run: () => void): void {
  if (typeof window === 'undefined') {
    run();
    return;
  }
  const x = window.scrollX;
  const y = window.scrollY;
  run();
  const restore = () => {
    if (window.scrollX !== x || window.scrollY !== y) window.scrollTo(x, y);
  };
  restore();
  if (typeof window.requestAnimationFrame !== 'function') return;
  window.requestAnimationFrame(() => {
    restore();
    window.requestAnimationFrame(restore);
  });
}

function dispatch(editor: Editor, tr: Transaction): void {
  keepPageScroll(() => {
    editor.view.dispatch(closeHistory(tr));
  });
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

// ---------------------------------------------------------------------------
// Forest structure: connect / disconnect roots


/**
 * A stable way to re-find a unit while a transaction reshapes the document.
 * Propositions carry their pid; a bracket is named by its leftmost leaf's pid
 * plus how many levels the bracket sits above that leaf — both invariant under
 * the only mutation the connect path performs (dissolving brackets ABOVE the
 * unit), where raw positions and pre-order indices are not.
 */
type UnitHandle =
  | { kind: 'prop'; pid: string }
  | { kind: 'bracket'; leafPid: string; up: number };

/** The unit (proposition, bracket or hole) at `pos`, or null. */
function unitNodeAt(doc: PMNode, pos: number): PMNode | null {
  if (pos < 0 || pos > doc.content.size) return null;
  const node = doc.nodeAt(pos);
  if (node === null) return null;
  const name = node.type.name;
  return name === 'proposition' || name === 'bracket' || name === 'hole' ? node : null;
}

/** Current position of the unit a handle names, or null when it is gone. */
function locateUnit(doc: PMNode, handle: UnitHandle): number | null {
  if (handle.kind === 'prop') return findPropositionPos(doc, handle.pid);
  const leafPos = findPropositionPos(doc, handle.leafPid);
  if (leafPos === null) return null;
  const $leaf = doc.resolve(leafPos);
  const depth = $leaf.depth - handle.up + 1;
  if (depth < 1 || depth > $leaf.depth) return null;
  if ($leaf.node(depth).type.name !== 'bracket') return null;
  return $leaf.before(depth);
}

/**
 * Dissolve, inside `tr`, every bracket ABOVE the unit `handle` names,
 * outermost first, until the unit is itself a forest root. Each round
 * re-locates the unit (the previous replace moved it). Returns the unit's
 * final position, or null when it cannot be found.
 */
function unzipUnitInTransaction(tr: Transaction, handle: UnitHandle): number | null {
  for (;;) {
    const pos = locateUnit(tr.doc, handle);
    if (pos === null) return null;
    const $pos = tr.doc.resolve(pos);
    if ($pos.depth === 0) return pos; // a root already
    const rootPos = $pos.before(1);
    const root = tr.doc.nodeAt(rootPos);
    if (root === null) return null;
    tr.replaceWith(rootPos, rootPos + root.nodeSize, root.content);
  }
}

/**
 * Connect two units into one new BINARY bracket, in document order, with
 * relationship `rel` (default 'Ser' — a coordinate series, no star, no flag).
 * `posA`/`posB` are the units' positions in either order.
 *
 * The units need not be roots: a NESTED unit is first unzipped — every
 * bracket above it is dissolved, inside the same transaction — because those
 * connections described the unit's old place and cannot survive its moving.
 * That is what lets a user re-connect an already-connected unit by its dot.
 * After unzipping, the two units must be ADJACENT roots; otherwise nothing at
 * all is dispatched.
 *
 * Rejected (returns null, dispatching nothing) when either position is not a
 * unit, when one unit contains the other, when they do not come out adjacent,
 * or when `rel` is not in the taxonomy. One undo step.
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
  if (posA === posB) return null;
  const nodeA = unitNodeAt(doc, posA);
  const nodeB = unitNodeAt(doc, posB);
  if (nodeA === null || nodeB === null) return null;
  // Overlapping ranges: one unit contains the other — nothing to connect.
  if (posA < posB + nodeB.nodeSize && posB < posA + nodeA.nodeSize) return null;

  const bracketType = state.schema.nodes.bracket;
  const holeType = state.schema.nodes.hole;
  if (bracketType === undefined || holeType === undefined) return null;

  const $a = doc.resolve(posA);
  const $b = doc.resolve(posB);
  const shared = $a.sharedDepth(posB);
  const container = $a.node(shared);

  // Rebuild the common ancestor's children with the path to each unit
  // DISSOLVED — every bracket between a unit and the ancestor goes, and
  // nothing above the ancestor is touched.
  const items: PMNode[] = [];
  let dissolved = false;
  container.forEach((child, _offset, index) => {
    const $unit = index === $a.index(shared) ? $a : index === $b.index(shared) ? $b : null;
    if ($unit === null || shared === $unit.depth) {
      items.push(child);   // a bystander, or the unit itself
      return;
    }
    dissolved = true;
    items.push(...loosen(child, shared + 1, $unit));
  });

  const indexA = items.indexOf(nodeA);
  const indexB = items.indexOf(nodeB);
  if (indexA === -1 || indexB === -1) return null;
  if (Math.abs(indexA - indexB) !== 1) return null; // not adjacent: nothing to do

  const low = Math.min(indexA, indexB);
  const prominent = defaultProminent(entry, 2);
  const bracket = bracketType.create(
    { rel, prominent, reversed: derivedReversed(entry, 2, prominent), flag: null },
    [items[low]!, items[low + 1]!],
  );
  const merged = [...items.slice(0, low), bracket, ...items.slice(low + 2)];

  const tr = state.tr;
  if (shared === 0) {
    // The forest itself: the roots simply take their new arrangement.
    tr.replaceWith(0, doc.content.size, merged);
  } else if (!dissolved && merged.length > 1) {
    // Both units were already this bracket's own children: it keeps them.
    tr.replaceWith($a.start(shared), $a.end(shared), merged);
  } else if (shared === 1) {
    // What held them was a forest root: the pieces need no hole to wait in,
    // because a root IS unattached. They take their places in the forest.
    tr.replaceWith($a.before(shared), $a.after(shared), merged);
  } else {
    // Whatever held them is gone, and its slot is inside a bracket that
    // survives: the pieces wait there, in a hole — unless the new bracket is
    // all that is left, and takes the slot itself.
    const replacement =
      merged.length === 1 ? merged[0]! : holeType.create(null, merged);
    tr.replaceWith($a.before(shared), $a.after(shared), replacement);
  }
  // Read the position off the transaction's own document: dispatching applies
  // exactly this transaction, so what holds there holds after.
  const at = findBracketPos(tr.doc, bracket);
  dispatch(editor, tr);
  return at;
}

/**
 * The children of `node` with the branch leading to `$unit` dissolved: every
 * bracket between the two disappears, its children taking its place, and the
 * unit comes out loose among them.
 */
function loosen(node: PMNode, depth: number, $unit: ResolvedPos): PMNode[] {
  const out: PMNode[] = [];
  if (depth === $unit.depth) {
    // This node is the unit's own parent: dissolving it frees every child.
    node.forEach((child) => out.push(child));
    return out;
  }
  node.forEach((child, _offset, index) => {
    if (index === $unit.index(depth)) out.push(...loosen(child, depth + 1, $unit));
    else out.push(child);
  });
  return out;
}

/** Where a freshly built node ended up, by identity. */
function findBracketPos(doc: PMNode, target: PMNode): number | null {
  let found: number | null = null;
  doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node === target) {
      found = pos;
      return false;
    }
    return true;
  });
  return found;
}

/**
 * Dissolve a ROOT bracket: its children become adjacent roots in its place
 * (the doc's 'unit+' content allows it). Nothing else in the document moves.
 * Returns false for a nested bracket (disconnect its root ancestors first —
 * see unzipToRoot) and for a non-bracket position.
 */
/**
 * Remove ONE relationship, wherever it sits, and leave everything above it
 * standing. The bracket's units are left unattached in a HOLE in its slot —
 * the tick above them hangs — until they are connected again; a root bracket
 * needs no hole, since its children become roots, which are unattached
 * already.
 *
 * This is what lets an analyst re-work three clauses without losing the shape
 * of the whole: the tree is briefly incomplete, and only the relation asked
 * for is gone.
 */
export function deleteRelationship(editor: Editor, pos: number): boolean {
  const { state } = editor;
  const node = bracketAt(editor, pos);
  if (node === null) return false;
  const holeType = state.schema.nodes.hole;
  if (holeType === undefined) return false;

  const $pos = state.doc.resolve(pos);
  const children: PMNode[] = [];
  node.forEach((child) => {
    // A hole inside a hole is one hole: what waits, waits together.
    if (child.type.name === 'hole') child.forEach((inner) => children.push(inner));
    else children.push(child);
  });

  const tr = state.tr;
  if ($pos.depth === 0) {
    tr.replaceWith(pos, pos + node.nodeSize, children);
  } else {
    tr.replaceWith(pos, pos + node.nodeSize, holeType.create(null, children));
  }
  dispatch(editor, tr);
  return true;
}

export function disconnectRoot(editor: Editor, pos: number): boolean {
  const node = bracketAt(editor, pos);
  if (node === null) return false;
  const { state } = editor;
  if (state.doc.resolve(pos).depth !== 0) return false; // nested: not a root

  dispatch(editor, state.tr.replaceWith(pos, pos + node.nodeSize, node.content));
  return true;
}

/**
 * Remove EVERY connection in the document: each bracket is dissolved until
 * the forest is nothing but its propositions, in document order. The
 * propositions themselves — their text, their splits, their labels — are
 * untouched, and the whole clearing is ONE undo step — or none at all, when
 * `undoable` is false.
 *
 * Returns false when there was nothing to clear.
 */
export function clearConnections(editor: Editor, undoable = true): boolean {
  const { state } = editor;
  const props: PMNode[] = [];
  state.doc.forEach(function collect(node) {
    if (node.type.name === 'proposition') {
      props.push(node);
      return;
    }
    node.forEach(collect);
  });
  // Nothing to do when every proposition is already a root of its own.
  if (props.length === state.doc.childCount) return false;
  const tr = state.tr.replaceWith(0, state.doc.content.size, props);
  // `undoable: false` keeps the clearing out of the history entirely — for the
  // automatic one, where a tree the window cannot draw must not be one
  // keystroke away from coming back.
  if (!undoable) tr.setMeta('addToHistory', false);
  dispatch(editor, tr);
  return true;
}

/**
 * Dissolve, inside `tr`, every bracket between the proposition `pid` and the
 * forest floor, outermost first, until the proposition is itself a root.
 */
function unzipInTransaction(tr: Transaction, pid: string): boolean {
  return unzipUnitInTransaction(tr, { kind: 'prop', pid }) !== null;
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

/** 0 → 'a', 25 → 'z', 26 → 'aa', … (bijective base 26, matching the server). */
function verseLetter(i: number): string {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    n -= 1;
    s = String.fromCharCode(97 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

/**
 * Re-derive the label of every CORPUS-sourced proposition in `tr` from its
 * word range — the corpus always knows where the verses fall:
 *
 *  - within one verse: the verse number, with bijective letters appended in
 *    document order when several propositions sit in that verse (11a, 11b, …
 *    — a verse holding only one proposition is unlettered);
 *  - spanning verses: the span ("10–12", or "1:28–2:3" across chapters).
 *
 * Raw propositions (and corpus ones whose words are not loaded) keep their
 * labels. Split and merge call this inside their own transaction, so the
 * renumbering rides the same undo step.
 */
function relabelCorpusInTransaction(
  tr: Transaction,
  words: ReadonlyMap<number, CorpusWord>,
): void {
  interface Entry {
    pos: number;
    node: PMNode;
    label: string;
    groupKey: string | null;
  }
  const entries: Entry[] = [];
  const groupCounts = new Map<string, number>();

  tr.doc.descendants((node, pos) => {
    if (node.type.name !== 'proposition') return true;
    const { srcStart, srcEnd } = node.attrs;
    if (typeof srcStart !== 'number' || typeof srcEnd !== 'number') return false;
    const first = words.get(srcStart);
    const last = words.get(srcEnd);
    if (first === undefined || last === undefined) return false;

    let label: string;
    let groupKey: string | null = null;
    if (first.book === last.book && first.chapter === last.chapter && first.verse === last.verse) {
      label = String(first.verse);
      groupKey = `${first.book}:${first.chapter}:${first.verse}`;
    } else if (first.book === last.book && first.chapter === last.chapter) {
      label = `${first.verse}–${last.verse}`;
    } else {
      label = `${first.chapter}:${first.verse}–${last.chapter}:${last.verse}`;
    }
    entries.push({ pos, node, label, groupKey });
    if (groupKey !== null) {
      groupCounts.set(groupKey, (groupCounts.get(groupKey) ?? 0) + 1);
    }
    return false;
  });

  const seen = new Map<string, number>();
  for (const entry of entries) {
    let label = entry.label;
    if (entry.groupKey !== null) {
      const i = seen.get(entry.groupKey) ?? 0;
      seen.set(entry.groupKey, i + 1);
      if ((groupCounts.get(entry.groupKey) ?? 0) > 1) label += verseLetter(i);
    }
    // setNodeMarkup only changes attrs, so the collected positions stay valid.
    if (label !== String(entry.node.attrs.label)) {
      tr.setNodeMarkup(entry.pos, undefined, { ...entry.node.attrs, label });
    }
  }
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
 * Split the proposition at `pos` into two ROOT propositions. The first keeps
 * the pid; corpus labels are then RE-DERIVED from the words' verses across
 * the document (11a, 11b, … — relabelCorpusInTransaction), while a raw
 * source's second half takes the first's label with a prime (′) appended.
 * `firstCount` is the number of words in the FIRST half (a UI wanting "split
 * after the word I clicked" passes clickedOrdinal + 1); it must be >= 1 and
 * < the proposition's word count.
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
      // A color block begins ONCE: the head keeps the break, the tail is
      // simply the next proposition inside the same block.
      blockColor: null,
    };
  } else {
    const tokens = String(attrs.text ?? attrs.rawText ?? '').split(/\s+/).filter(Boolean);
    if (!Number.isInteger(firstCount) || firstCount < 1 || firstCount >= tokens.length) {
      return false;
    }
    const aText = tokens.slice(0, firstCount).join(' ');
    const bText = tokens.slice(firstCount).join(' ');
    attrsA = { ...attrs, text: aText, rawText: aText };
    attrsB = {
      ...attrs,
      pid: pidB,
      label: label + PRIME,
      text: bText,
      rawText: bText,
      blockColor: null,
    };
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
  if (words !== null) relabelCorpusInTransaction(tr, words);
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
 * proposition keeping the FIRST one's pid. Corpus labels are re-derived from
 * the verses afterwards (relabelCorpusInTransaction); a raw result keeps the
 * first proposition's label.
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
  if (words !== null) relabelCorpusInTransaction(tr, words);
  dispatch(editor, tr);
  return true;
}

// ---------------------------------------------------------------------------
// Color blocks (see sections.ts for the model). A break rides the PROPOSITION
// that begins its block, as that node's blockColor attr, so these are ordinary
// transactions: one undo step each, shared history with every other gesture —
// and only the rows whose attr changes re-render. Structural commands never
// touch them: a merged-away break comes back when the merge is undone, and a
// split leaves the break on the half that kept the pid.

/** The pids currently in the document, in order. */
function pidsInOrder(doc: PMNode): string[] {
  return propositionsInOrder(doc).map((p) => String(p.node.attrs.pid));
}

/** The color-block breaks the document carries, in proposition order. */
export function sectionBreaks(doc: PMNode): SectionBreak[] {
  const breaks: SectionBreak[] = [];
  for (const { node } of propositionsInOrder(doc)) {
    const color = node.attrs.blockColor;
    if (typeof color === 'number') {
      breaks.push({ start: String(node.attrs.pid), color });
    }
  }
  return breaks;
}

/**
 * Bring the document's blockColor attrs in line with `next`, touching only
 * the propositions whose attr actually differs — one transaction, one undo
 * step, and no re-render for a row that did not change.
 */
function setBreaks(editor: Editor, next: SectionBreak[]): boolean {
  const wanted = new Map(next.map((b) => [b.start, b.color]));
  const tr = editor.state.tr;
  for (const { node, pos } of propositionsInOrder(editor.state.doc)) {
    const want = wanted.get(String(node.attrs.pid)) ?? null;
    const have = typeof node.attrs.blockColor === 'number' ? node.attrs.blockColor : null;
    if (want === have) continue;
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, blockColor: want });
  }
  if (!tr.docChanged) return false; // nothing to change: no empty undo step
  dispatch(editor, tr);
  return true;
}

/**
 * Begin a new color block at the proposition `pid`. Rejected — dispatching
 * nothing — for the first proposition, an unknown pid, or a break that is
 * already there.
 */
export function addSectionBreak(editor: Editor, pid: string): boolean {
  const doc = editor.state.doc;
  return setBreaks(editor, addBreak(sectionBreaks(doc), pidsInOrder(doc), pid));
}

/**
 * Remove the color-block break at `pid`, joining its block to the one above.
 * Rejected — dispatching nothing — when no break is there.
 */
export function removeSectionBreak(editor: Editor, pid: string): boolean {
  const doc = editor.state.doc;
  return setBreaks(editor, removeBreak(sectionBreaks(doc), pidsInOrder(doc), pid));
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
