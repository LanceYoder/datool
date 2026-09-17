// Conversion between the server Document shape and the editor's ProseMirror
// document. Pure functions — no editor instance required.
//
// The editor's document is FLAT (spec §7.7): one proposition per child, in
// reading order, with the tree riding the treeState node's `tree` attribute
// as a core Forest (schema.ts). So this module is the two ENDS of the load/save
// pipeline, and the wire adapter (`../tree/serialize`) is its middle:
//
//   LOAD  (§7.5)  normalizeDocument -> normalizeHoles -> fromWire(+taxonomy)
//                 -> flat doc JSON, the forest on its treeState node
//                 -> on ANY failure: withoutConnections + a console warning
//   SAVE  (§7.4)  propositions off the flat doc + tryToWire(readTree(doc))
//
// Invariants:
//  - documentToNode . nodeToDocument is the identity for valid v2 documents
//    (propositions rebuilt in list order, which equals leaf order by the
//    server invariant; sources/labels/colors carried over by pid).
//  - Color-block breaks (document `sections`) ride the PROPOSITION that begins
//    each block, in and out, and come back pruned to live pids — absent when
//    empty.
//  - Legacy v1 documents load through normalizeDocument (tree -> forest of
//    one); nodeToDocument always writes v2.
//  - HOLES round-trip both ways: an analysis with an edit half-made is a real
//    state, worth storing. Rooms are CURRENT model, not legacy (§1), and
//    NOTHING settles them on the way in (§10 A1): a one-child hole loads as a
//    one-lodger room and a two-hole bracket loads as a bracket hanging at both
//    ends. They are written back out by the wire adapter from the hanging
//    sides the core holds.
//  - Optional bracket keys are normalized by the wire adapter: `reversed`
//    appears only when true and is DERIVED there, `flag` only when 'review'.
//  - Display text is resolved BEFORE conversion via `textById` (see
//    buildTextById); raw sources fall back to their own text.

import type { JSONContent } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type {
  CorpusWord,
  Document as AnalysisDocument,
  DocumentV2,
  Proposition,
  SectionBreak,
  TreeNode,
} from '../types';
import type { Forest } from '../tree/core';
import type { TaxonomyLike, WireWriteProblem } from '../tree/serialize';
import { fromWire, tryToWire } from '../tree/serialize';
import { TREE_ATTR, TREE_NODE, propositionsInOrder, readTree } from './schema';
import { normalizeBreaks, pruneBreaks } from './sections';

/**
 * Holes put in the two places they cannot stand. A hole is a WAITING ROOM (see
 * types.ts), not structure, so of every stored forest:
 *
 *  - a hole never holds another hole: what waits, waits together;
 *  - a hole is never a forest ROOT, because a root is unattached already.
 *
 * And that is ALL this pass does now (spec §10 A1, A4). Two rules it used to
 * enforce are GONE, because they were the auto-completion the analyst
 * overruled:
 *
 *  - a hole holding ONE unit is a one-lodger room — tick, pickup dot, the lone
 *    unit waiting — and collapsing it into the slot would settle a bracket the
 *    analyst never finished (A1). Only the pickup dot settles a side (A2).
 *  - a bracket with a hole at EACH end is a legal work-in-progress (A4): "only
 *    validate the tree structure when there are no holes remaining". It is not
 *    a shell to bring down.
 *
 * Leaf order is untouched, which is the invariant that matters.
 */
export function normalizeHoles(forest: readonly TreeNode[]): TreeNode[] {
  // The units a node contributes where holes carry no meaning: inside another
  // hole, and at the forest floor.
  const loose = (node: TreeNode): TreeNode[] => {
    if (node.kind === 'hole') return node.children.flatMap(loose);
    const slot = asSlot(node);
    if (slot === null) return [];
    return [slot];
  };

  // The node as a CHILD of a bracket, where a hole DOES mean something —
  // whatever it holds, as long as it holds something.
  const asSlot = (node: TreeNode): TreeNode | null => {
    if (node.kind === 'prop') return node;
    if (node.kind === 'hole') {
      const waiting = node.children.flatMap(loose);
      if (waiting.length === 0) return null;
      return { kind: 'hole', children: waiting };
    }
    const children = node.children.map(asSlot).filter((c): c is TreeNode => c !== null);
    if (children.length === 0) return null;
    // A bracket down to one child says nothing about anything: it gives way.
    if (children.length === 1) return children[0]!;
    return { ...node, children };
  };

  return forest.flatMap(loose);
}

/** Whether any hole in `forest` sits somewhere the model does not allow. */
function holesAreSettled(forest: readonly TreeNode[]): boolean {
  const ok = (node: TreeNode, parent: 'root' | 'bracket' | 'hole'): boolean => {
    if (node.kind === 'prop') return true;
    if (node.kind === 'hole' && (parent !== 'bracket' || node.children.length < 1)) return false;
    return node.children.every((child) => ok(child, node.kind === 'hole' ? 'hole' : 'bracket'));
  };
  return forest.every((root) => ok(root, 'root'));
}

/**
 * Bring any stored document to the v2 shape: `forest` is the list of ordered
 * roots. A v1 `tree` becomes a forest of one; a document carrying neither
 * degrades to one root per proposition (all disconnected — legal in v2); and
 * any hole is settled where the model allows one (normalizeHoles).
 * The returned wrapper object is always fresh (so `tree` never leaks through);
 * the propositions array is shared with the input, and so is the forest when
 * it needed nothing done to it, which is safe because nothing here mutates a
 * document in place.
 */
export function normalizeDocument(document: AnalysisDocument): DocumentV2 {
  const propositions = document.propositions;
  let forest: TreeNode[];
  if (Array.isArray(document.forest)) {
    forest = document.forest;
  } else if (document.tree !== undefined) {
    forest = [document.tree];
  } else {
    forest = propositions.map((p) => ({ kind: 'prop', ref: p.id }) as TreeNode);
  }
  if (!holesAreSettled(forest)) forest = normalizeHoles(forest);
  const out: DocumentV2 = { schemaVersion: 2, propositions, forest };
  if (Array.isArray(document.sections) && document.sections.length > 0) {
    out.sections = document.sections;
  }
  return out;
}

/**
 * The SBLGNT text column carries critical-apparatus sigla (⸀ ⸂ ⸃ …) inline —
 * some numbered (⸀1ἄλλῳ in 1 Cor 12:10). Part of the edition, but noise in
 * an analysis display.
 */
const SIGLA = /[⸀⸁⸂⸃⸄⸅⸆⸇⸈⸉⸊°][0-9]?/g;

/**
 * The same document with every connection removed: each proposition becomes a
 * root of its own. Used where a proposed tree cannot be drawn at all — the
 * propositions are what matter, and a tree nobody can see is worse than none.
 */
export function withoutConnections(document: AnalysisDocument): DocumentV2 {
  const normalized = normalizeDocument(document);
  return {
    ...normalized,
    forest: normalized.propositions.map((p) => ({ kind: 'prop', ref: p.id })),
  };
}

export function displayWordText(text: string): string {
  return text.replace(SIGLA, '');
}

/**
 * Resolve display text per proposition id: corpus sources join their word
 * range's `text` column with spaces (INCLUSIVE [start, end] — the server
 * contract); raw sources pass their text through. Corpus props with no words
 * supplied resolve to ''.
 */
export function buildTextById(
  document: AnalysisDocument,
  corpusWords: readonly CorpusWord[] = [],
): Map<string, string> {
  const byIndex = new Map(corpusWords.map((w) => [w.index, w]));
  const out = new Map<string, string>();
  for (const prop of document.propositions) {
    if (prop.source.kind === 'raw') {
      out.set(prop.id, prop.source.text);
      continue;
    }
    const parts: string[] = [];
    for (let i = prop.source.start; i <= prop.source.end; i += 1) {
      const word = byIndex.get(i);
      if (word !== undefined) parts.push(displayWordText(word.text));
    }
    out.set(prop.id, parts.join(' '));
  }
  return out;
}

/**
 * Read a stored document's forest as a core Forest, per §7.5's pipeline —
 * `normalizeDocument` (v1 lift, hole settling) then the STRICT `fromWire`,
 * with the propositions-only fallback and a console warning on any failure.
 *
 * Exported for the tests that pin the fallback; `documentToNode` is what the
 * app calls.
 */
export function readStoredForest(
  document: AnalysisDocument,
  taxonomy: readonly TaxonomyLike[] = [],
): { forest: Forest; propositions: Proposition[]; sections?: (SectionBreak | string)[] } {
  const normalized = normalizeDocument(document);
  const order = normalized.propositions.map((p) => p.id);
  const known = taxonomy.length > 0 ? taxonomy : undefined;
  const loaded = fromWire(normalized.forest, order, known);
  if (loaded.ok) {
    return {
      forest: loaded.forest,
      propositions: normalized.propositions,
      ...(normalized.sections === undefined ? {} : { sections: normalized.sections }),
    };
  }
  // §7.5, ruling Q2: no binarizer, no repair. A tree nobody can draw is worse
  // than none, so the propositions open without it and the analyst is told.
  console.warn(
    `datool: this analysis's tree could not be read (${loaded.reason.code}: `
      + `${loaded.reason.message}); opening its propositions without connections.`,
  );
  const flat = withoutConnections(normalized);
  const fallback = fromWire(flat.forest, order, known);
  if (!fallback.ok) {
    // Only reachable for a document with no propositions at all — which the
    // schema ('proposition+') could not hold either.
    throw new Error(`document has no propositions (${fallback.reason.message})`);
  }
  return {
    forest: fallback.forest,
    propositions: flat.propositions,
    ...(flat.sections === undefined ? {} : { sections: flat.sections }),
  };
}

/**
 * Document -> ProseMirror doc JSON (feed to buildEditor / setDocument): the
 * FLAT doc — the treeState node first, then one child per proposition, in
 * reading order — with the core Forest embedded on the treeState node, ids
 * and mint included (§7.2, §7.5). The two halves travel together because
 * installing one without the other is a window of guaranteed data loss.
 *
 * v1 documents are normalized on the way in; a forest the model cannot hold
 * (an n-ary bracket, a misplaced room, a proposition the forest drops) opens
 * WITHOUT connections and warns, rather than throwing. Throws only when there
 * are no propositions at all, which the schema could not represent.
 */
export function documentToNode(
  document: AnalysisDocument,
  textById: ReadonlyMap<string, string>,
  taxonomy: readonly TaxonomyLike[] = [],
): JSONContent {
  const { forest, propositions, sections } = readStoredForest(document, taxonomy);
  // Color-block breaks ride the proposition that BEGINS each block (see
  // schema.ts). Legacy pid-string lists normalize to {start, color} here, on
  // the way in.
  const blockColorByPid = new Map(normalizeBreaks(sections).map((b) => [b.start, b.color]));

  const content = propositions.map((prop) => {
    const fallback = prop.source.kind === 'raw' ? prop.source.text : '';
    return {
      type: 'proposition',
      attrs: {
        pid: prop.id,
        label: prop.label,
        text: textById.get(prop.id) ?? fallback,
        color: prop.color ?? null,
        srcStart: prop.source.kind === 'corpus' ? prop.source.start : null,
        srcEnd: prop.source.kind === 'corpus' ? prop.source.end : null,
        rawText: prop.source.kind === 'raw' ? prop.source.text : null,
        blockColor: blockColorByPid.get(prop.id) ?? null,
      },
    };
  });

  return {
    type: 'doc',
    content: [{ type: TREE_NODE, attrs: { [TREE_ATTR]: forest } }, ...content],
  };
}

/** A snapshot that could not be written, and why (§7.4's two write paths). */
export type DocumentWrite =
  | { ok: true; document: DocumentV2 }
  | { ok: false; reason: WireWriteProblem };

/**
 * THE PER-DOCTICK SNAPSHOT (§7.4 item 4): the propositions rebuilt from the
 * flat doc, and the forest written out of the treeState node by the wire adapter.
 *
 * It answers with a typed problem instead of throwing for ONE remaining case:
 * a `rel` this taxonomy does not carry, which is a data mismatch rather than a
 * gesture. §10 A5 retired the other one — every connect mints a Ser, so no
 * docTick ever fires on an unlabeled bracket and no snapshot is held back.
 */
export function trySnapshot(
  pmDoc: PMNode,
  priorDocument: AnalysisDocument,
  taxonomy: readonly TaxonomyLike[],
): DocumentWrite {
  const priorById = new Map(priorDocument.propositions.map((p) => [p.id, p]));
  const propositions: Proposition[] = [];
  const blockStarts: SectionBreak[] = [];

  if (propositionsInOrder(pmDoc).length < 1) {
    throw new Error('editor document must contain at least one proposition');
  }
  pmDoc.forEach((node) => {
    if (node.type.name === TREE_NODE) return; // the tree's carrier, read by readTree
    if (node.type.name !== 'proposition') {
      throw new Error(`unexpected node '${node.type.name}' in editor document`);
    }
    const pid = String(node.attrs.pid);
    const prior = priorById.get(pid);
    let prop: Proposition;
    if (typeof node.attrs.srcStart === 'number' && typeof node.attrs.srcEnd === 'number') {
      prop = {
        id: pid,
        label: String(node.attrs.label ?? ''),
        source: { kind: 'corpus', start: node.attrs.srcStart, end: node.attrs.srcEnd },
      };
    } else if (typeof node.attrs.rawText === 'string') {
      prop = {
        id: pid,
        label: String(node.attrs.label ?? ''),
        source: { kind: 'raw', text: node.attrs.rawText },
      };
    } else if (prior !== undefined) {
      prop = { id: prior.id, label: prior.label, source: prior.source };
    } else {
      prop = {
        id: pid,
        label: String(node.attrs.label ?? ''),
        source: { kind: 'raw', text: String(node.attrs.text ?? '') },
      };
    }
    if (typeof node.attrs.color === 'string' && node.attrs.color !== '') {
      prop.color = node.attrs.color;
    }
    if (typeof node.attrs.blockColor === 'number') {
      blockStarts.push({ start: prop.id, color: node.attrs.blockColor });
    }
    propositions.push(prop);
  });

  const written = tryToWire(readTree(pmDoc), taxonomy);
  if (!written.ok) return { ok: false, reason: written.reason };

  const out: DocumentV2 = { schemaVersion: 2, propositions, forest: written.forest };
  // Color-block breaks, read back off the propositions that begin them and
  // pruned: the FIRST proposition can carry a blockColor (a merge can leave
  // it holding one), and a break there is no break at all.
  const breaks = pruneBreaks(blockStarts, propositions.map((p) => p.id));
  if (breaks.length > 0) out.sections = breaks;
  return { ok: true, document: out };
}

/**
 * THE SAVE PATH (§7.4): `trySnapshot`, unwrapped. It throws on the unstorable
 * brackets `toWire` throws on — a rel the taxonomy does not carry, and the
 * `rel: null` no gesture can produce any more (§10 A5).
 */
export function nodeToDocument(
  pmDoc: PMNode,
  priorDocument: AnalysisDocument,
  taxonomy: readonly TaxonomyLike[],
): DocumentV2 {
  const written = trySnapshot(pmDoc, priorDocument, taxonomy);
  if (!written.ok) throw new Error(`editor/convert: ${written.reason.message}`);
  return written.document;
}
