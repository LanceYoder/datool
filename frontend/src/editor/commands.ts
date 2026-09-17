// Editing commands for the bracketing editor — the thin edge between the
// gestures and the pure core (`../tree/core.ts`, spec §5).
//
// Each command does exactly three things, in this order, and nothing else:
//
//   1. read the core Forest off the treeState node (schema.ts's readTree);
//   2. run ONE pure op from the core, which either answers with a new Forest
//      or refuses (a refusal changes nothing — no transaction is dispatched);
//   3. dispatch ONE transaction carrying the new state: the proposition
//      ReplaceSteps a split or a merge needs, PLUS the AttrStep on the
//      treeState node, together.
//
// That third rule is §7.2, and everything downstream depends on it. An
// AttrStep is a real, invertible step, so prosemirror-history gives atomic
// undo of text AND tree together; `docChanged` fires onUpdate/docTick/onChange
// unchanged; and `closeHistory` per command keeps one gesture to one undo
// step. There is no plugin-owned state to keep in sync, because there is no
// second copy of the structure to be out of sync with (§7.7).
//
// Nothing here re-derives structure. The one re-derived piece of DISPLAY state
// is the verse numbering: split and merge re-label corpus propositions from
// their words' verses (11a, 11b, … — relabelCorpusInTransaction), because the
// corpus always knows where the verses fall.

import type { Editor } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import type { CorpusWord, SectionBreak, TaxonomyEntry } from '../types';
import type { Forest, Refusal, Result, Side, TaxonomyFacts, Unit, UnitAddr } from '../tree/core';
import {
  bracketById,
  clearTree as coreClear,
  connect as coreConnect,
  deleteAt as coreDeleteAt,
  flipStar as coreFlipStar,
  mergeLeaves as coreMerge,
  setRelationship as coreSetRelationship,
  settleSide as coreSettle,
  settleTargetFor,
  splitLeaf as coreSplit,
} from '../tree/core';
import { displayWordText } from './convert';
import {
  TREE_ATTR,
  TREE_POS,
  findPropositionPos,
  pidsInOrder,
  propositionsInOrder,
  readTree,
} from './schema';
import { addBreak, removeBreak } from './sections';

/**
 * Run a document change without letting the page move under the reader.
 *
 * Replacing a range (a split, a merge) rebuilds the React node views inside
 * it, and for a moment the document is SHORTER than the position it is
 * scrolled to. The browser clamps the scroll to what is left, and when the
 * rows come back there is nothing to scroll back to: the clamp is permanent.
 * (A connect or a delete used to rebuild EVERY row for the same reason —
 * the tree rode the doc's attrs — and now rebuilds none; see `commit`.)
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

/**
 * Dispatch a command's single transaction as its own UNDO STEP.
 * prosemirror-history groups transactions arriving within newGroupDelay into
 * one event — right for typing, wrong here: every transaction is a discrete
 * structural gesture, so the group is closed first.
 */
function dispatch(editor: Editor, tr: Transaction): void {
  keepPageScroll(() => {
    editor.view.dispatch(closeHistory(tr));
  });
}

/**
 * The ONE way a new core state reaches the document: the AttrStep on the
 * treeState node, plus whatever proposition steps the gesture also needs, in
 * a single transaction (§7.2). `steps` runs before the attribute is written,
 * on the same `tr`; the treeState node stands at position 0 whatever they do
 * to the propositions after it, so the position needs no mapping.
 *
 * On the treeState node and NOT the doc's attrs: the view rebuilds every node
 * whose attributes changed, and for the doc that was every row on every
 * gesture — the page collapsed and grew back, which the reader saw as a jump.
 */
function commit(editor: Editor, forest: Forest, steps?: (tr: Transaction) => void): boolean {
  const tr = editor.state.tr;
  steps?.(tr);
  tr.setNodeAttribute(TREE_POS, TREE_ATTR, forest);
  dispatch(editor, tr);
  return true;
}

/** What the core needs to know about a relationship (§5.6, §7.1). */
function factsFor(
  taxonomy: readonly TaxonomyEntry[],
  rel: string,
): TaxonomyFacts | null {
  const entry = taxonomy.find((e) => e.code === rel);
  if (entry === undefined) return null;
  return { coordinate: entry.coordinate, starredLabel: entry.starredLabel ?? undefined };
}

// ---------------------------------------------------------------------------
// §5.1 Connect

/**
 * What a connect gesture answers with: the bracket the menu opens on, and
 * whether it was ALREADY there (§5.1 step 1's same-bracket re-connection —
 * nothing structural changed, nothing to undo, and the menu opens preloaded).
 */
export type ConnectResult = Result<{ bracketId: number; editedInPlace: boolean }>;

/**
 * Connect two units, addressed by id (§7.3). The core is the judge: the join
 * SUCCEEDS whenever the two spans meet, breaking exactly the brackets standing
 * in its way, and the only refusals are geometric — so a refused gesture just
 * shakes its dot (§10 A6).
 *
 * The new bracket is a SER (§10 A5 — Q6 reversed): the join always has a name,
 * the menu opens preloaded on it, and clicking away simply leaves the Ser
 * standing. There is no unlabeled state, and nothing to undo on dismissal.
 */
export function connectUnits(editor: Editor, a: UnitAddr, b: UnitAddr): ConnectResult {
  const out = coreConnect(readTree(editor.state.doc), a, b);
  if (!out.ok) return out;
  // A re-connection leaves the state byte-identical; dispatching it would put
  // an empty step in the history for a gesture that changed nothing.
  if (out.editedInPlace === undefined) commit(editor, out.state);
  return {
    ok: true,
    bracketId: out.newBracketId,
    editedInPlace: out.editedInPlace !== undefined,
  };
}

// ---------------------------------------------------------------------------
// §10 A2 Settle — the pickup dot's own gesture

/**
 * Finish a bracket: the named hanging side settles, and the relationship is
 * whole (§10 A2). ONE undo step, no new bracket, no menu — the analyst is not
 * naming anything here, they are saying "that group is done".
 *
 * The core refuses when the side still holds more than one lodger; the UI's
 * whole answer to that is a shake (§10 A6), so the refusal is returned rather
 * than described.
 */
export function settleHang(editor: Editor, bracketId: number, side: Side): Refusal | null {
  const out = coreSettle(readTree(editor.state.doc), bracketId, side);
  if (!out.ok) return out.refusal;
  commit(editor, out.state);
  return null;
}

/**
 * The sole lodger of that hanging side, when there is exactly one — the unit
 * the pickup dot's gesture must be paired with (§10 A2). Null when the side
 * holds a group still being assembled, or does not hang at all.
 */
export function settleLodger(editor: Editor, bracketId: number, side: Side): Unit | null {
  return settleTargetFor(readTree(editor.state.doc), bracketId, side);
}

// ---------------------------------------------------------------------------
// §5.3 Delete

/**
 * Delete by dot (§5.3): a bracket dot names its bracket, a leaf dot the
 * bracket owning the side that holds it, and a ROOT leaf's dot-delete is a
 * refusal. The core's own dot targeting decides which — this only dispatches.
 */
export function deleteAt(editor: Editor, addr: UnitAddr): Refusal | null {
  const out = coreDeleteAt(readTree(editor.state.doc), addr);
  if (!out.ok) return out.refusal;
  commit(editor, out.state);
  return null;
}

// ---------------------------------------------------------------------------
// §5.6 Attribute edits and clear

/**
 * Set a bracket's relationship, by id (§5.6, §7.3). The star follows: null for
 * a coordinate target (I7); for a subordinate target the existing star is
 * kept, or — coming from coordinate, or from an unlabeled new bracket — the
 * taxonomy's default end. `reversed` is not stored at all any more: it is
 * derived from rel + star at render and serialize time.
 *
 * Re-picking the relationship a bracket ALREADY has succeeds and dispatches
 * nothing. The core rebuilds the bracket either way (`{...b, rel, star}` is
 * never reference-equal), so without this guard every re-pick would land a
 * real DocAttrStep and open a new history group — a dead entry in the undo
 * stack for a gesture that changed no byte of the model. flipStar
 * (`out.state === forest`), clearConnections and setBreaks (`!tr.docChanged`)
 * all guard the same case; the menu still closes, because that is
 * AnalysisEditor's setPopover(null) and runs regardless of what we answer.
 */
export function setRelationship(
  editor: Editor,
  bracketId: number,
  rel: string,
  taxonomy: readonly TaxonomyEntry[],
): boolean {
  const facts = factsFor(taxonomy, rel);
  if (facts === null) return false;
  const forest = readTree(editor.state.doc);
  const out = coreSetRelationship(forest, bracketId, rel, facts);
  if (!out.ok) return false;
  const before = bracketById(forest, bracketId);
  const after = bracketById(out.state, bracketId);
  if (before !== null && after !== null && before.rel === after.rel && before.star === after.star) {
    return true; // nothing to change: no empty undo step
  }
  return commit(editor, out.state);
}

/**
 * Move the star to the other end, so the label at each end — and the derived
 * `reversed` — follows it. A coordinate bracket has no star to move (I7), and
 * neither has an unlabeled one: both report failure and dispatch nothing.
 */
export function flipStar(
  editor: Editor,
  bracketId: number,
  taxonomy: readonly TaxonomyEntry[],
): boolean {
  const forest = readTree(editor.state.doc);
  const bracket = bracketById(forest, bracketId);
  if (bracket === null || bracket.rel === null) return false;
  const facts = factsFor(taxonomy, bracket.rel);
  if (facts === null || facts.coordinate) return false;
  const out = coreFlipStar(forest, bracketId, facts);
  if (!out.ok || out.state === forest) return false;
  return commit(editor, out.state);
}

/** Toolbar: every connection removed at once; the propositions stay put. */
export function clearConnections(editor: Editor): boolean {
  const forest = readTree(editor.state.doc);
  if (forest.roots.every((u) => u.kind === 'leaf')) return false; // nothing to clear
  const out = coreClear(forest);
  if (!out.ok) return false;
  return commit(editor, out.state);
}

// ---------------------------------------------------------------------------
// §5.4 / §5.5 Split and merge — the propositions AND the tree, one transaction
//
// The core knows only that one leaf became two (or two became one). Dividing
// the corpus source at the chosen word, minting the new pid, keeping the
// blockColor on the half that keeps the pid, and re-deriving the verse labels
// are the edge's business — §7.10's bookkeeping, unchanged from the old
// engine, and it rides the same transaction the tree attribute does.

/** U+2032 PRIME — suffixed to the label of a raw split's second half. */
export const PRIME = '′';

/** An unused proposition id of the form p<n>, given the ids already in `doc`. */
export function freshPid(doc: PMNode): string {
  const taken = new Set<string>();
  let max = 0;
  for (const pid of pidsInOrder(doc)) {
    taken.add(pid);
    const m = /^p(\d+)$/.exec(pid);
    if (m !== null) max = Math.max(max, Number(m[1]));
  }
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

  for (const { pos, node } of propositionsInOrder(tr.doc)) {
    const { srcStart, srcEnd } = node.attrs;
    if (typeof srcStart !== 'number' || typeof srcEnd !== 'number') continue;
    const first = words.get(srcStart);
    const last = words.get(srcEnd);
    if (first === undefined || last === undefined) continue;

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
  }

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
 * Split the proposition `pid` after its `firstCount`th word (a UI wanting
 * "split after the word I clicked" passes clickedOrdinal + 1).
 *
 * §7.10's bookkeeping: w1 keeps the pid AND the blockColor (a color block
 * begins once — the head keeps the break, the tail is simply the next
 * proposition inside the same block); w2's pid is minted by today's
 * convention; the corpus source divides at the chosen word; corpus labels are
 * then re-derived from the verses across the whole document, while a raw
 * source's second half takes the first's label with a prime.
 *
 * Structure is preserved up to I3 (ruling Q4): a committed leaf's side now
 * holds ⟨w1 w2⟩ and HANGS, awaiting reassembly — the split does not eject the
 * leaf, and only a bracket left hanging at both ends gives way.
 */
export function splitProposition(
  editor: Editor,
  pid: string,
  firstCount: number,
  words: ReadonlyMap<number, CorpusWord> | null,
): boolean {
  const { state } = editor;
  const pos = findPropositionPos(state.doc, pid);
  if (pos === null) return false;
  const node = state.doc.nodeAt(pos);
  const type = state.schema.nodes.proposition;
  if (node === null || node.type.name !== 'proposition' || type === undefined) return false;

  const attrs = node.attrs;
  const label = String(attrs.label ?? '');
  const pidB = freshPid(state.doc);

  // Validate and compute both halves BEFORE touching anything, so a rejected
  // split dispatches nothing at all.
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

  const out = coreSplit(readTree(state.doc), pid, pidB);
  if (!out.ok) return false;

  return commit(editor, out.state, (tr) => {
    tr.replaceWith(pos, pos + node.nodeSize, [type.create(attrsA), type.create(attrsB)]);
    if (words !== null) relabelCorpusInTransaction(tr, words);
  });
}

/**
 * Merge the proposition `pid` with the NEXT one (§5.5). The fused leaf keeps
 * the upper one's pid and blockColor and concatenates the spans; contiguous
 * corpus ranges re-join into one range (text rebuilt from `words`, apparatus
 * sigla stripped), and anything else degrades to a raw source with the two
 * display texts joined. Corpus labels are re-derived from the verses
 * afterwards; a raw result keeps the first proposition's label.
 *
 * The core removes the MINIMAL set of brackets around the pair
 * (innermost-outward: give way where the leaf is committed or the boundary
 * separates the pair, release where it is a fringe lodger). Returns false when
 * `pid` is the last proposition, or is not in the document.
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
  const upper = props[index];
  const lower = props[index + 1];
  if (upper === undefined || lower === undefined) return false; // last proposition

  const a = upper.node.attrs;
  const b = lower.node.attrs;
  let merged: Record<string, unknown>;
  if (
    typeof a.srcStart === 'number' && typeof a.srcEnd === 'number'
    && typeof b.srcStart === 'number' && typeof b.srcEnd === 'number'
    && a.srcEnd + 1 === b.srcStart
  ) {
    const text = words !== null
      ? corpusText(words, a.srcStart, b.srcEnd)
      : `${String(a.text)} ${String(b.text)}`.trim();
    merged = { ...a, srcEnd: b.srcEnd, text };
  } else {
    const text = `${String(a.text)} ${String(b.text)}`.trim();
    merged = { ...a, srcStart: null, srcEnd: null, rawText: text, text };
  }

  const out = coreMerge(readTree(state.doc), pid);
  if (!out.ok) return false;

  return commit(editor, out.state, (tr) => {
    // The document is FLAT, so the two propositions are adjacent siblings:
    // one replacement covers both.
    tr.replaceWith(upper.pos, lower.pos + lower.node.nodeSize, type.create(merged));
    if (words !== null) relabelCorpusInTransaction(tr, words);
  });
}

// ---------------------------------------------------------------------------
// Section breaks (color blocks). Not tree structure: a break is carried by
// the proposition that begins its block, as that node's blockColor attr, so
// these are ordinary transactions — one undo step each, shared history — and
// only the rows whose attr changes re-render.

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
