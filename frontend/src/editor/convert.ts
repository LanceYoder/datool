// Conversion between the server Document shape and the editor's ProseMirror
// document. Pure functions — no editor instance required.
//
// Invariants:
//  - documentToNode . nodeToDocument is the identity for valid v2 documents
//    (propositions rebuilt in leaf order, which equals list order by the
//    server invariant; sources/labels/colors carried over by pid).
//  - The editor's ProseMirror doc holds one child per FOREST ROOT, so
//    disconnected propositions round-trip as roots of their own.
//  - Color-block breaks (document `sections`) ride the DOC node's attrs in
//    (documentToNode) and come back pruned to live pids on the way out —
//    absent when empty.
//  - Legacy v1 documents load through normalizeDocument (tree -> forest of
//    one); nodeToDocument always writes v2.
//  - Optional bracket keys are normalized: `reversed` appears in the output
//    Document only when true, `flag` only when 'review' — matching how valid
//    documents are written.
//  - Display text is resolved BEFORE conversion via `textById` (see
//    buildTextById); raw sources fall back to their own text.

import type { JSONContent } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type {
  BracketNode as BracketTreeNode,
  CorpusWord,
  Document as AnalysisDocument,
  DocumentV2,
  Proposition,
  SectionBreak,
  TreeNode,
} from '../types';
import { normalizeBreaks, pruneBreaks } from './sections';

/**
 * Bring any stored document to the v2 shape: `forest` is the list of ordered
 * roots. A v1 `tree` becomes a forest of one; a document carrying neither
 * degrades to one root per proposition (all disconnected — legal in v2).
 * The returned wrapper object is always fresh (so `tree` never leaks through);
 * the propositions and forest arrays are shared with the input, which is safe
 * because nothing here mutates a document in place.
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
 * Document -> ProseMirror doc JSON (feed to buildEditor / setContent): one doc
 * child per forest root. v1 documents are normalized on the way in. Throws if
 * the forest references an unknown proposition id, or if it is empty (the
 * schema requires at least one root).
 */
export function documentToNode(
  document: AnalysisDocument,
  textById: ReadonlyMap<string, string>,
): JSONContent {
  const normalized = normalizeDocument(document);
  const propsById = new Map(normalized.propositions.map((p) => [p.id, p]));
  // Color-block breaks ride the proposition that BEGINS each block (see
  // schema.ts). Legacy pid-string lists normalize to {start, color} here, on
  // the way in.
  const blockColorByPid = new Map(
    normalizeBreaks(normalized.sections).map((b) => [b.start, b.color]),
  );

  const build = (node: TreeNode): JSONContent => {
    if (node.kind === 'prop') {
      const prop = propsById.get(node.ref);
      if (prop === undefined) {
        throw new Error(`forest references unknown proposition '${node.ref}'`);
      }
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
    }
    return {
      type: 'bracket',
      attrs: {
        rel: node.rel,
        prominent: node.prominent ?? null,
        reversed: node.reversed === true,
        flag: node.flag ?? null,
      },
      content: node.children.map(build),
    };
  };

  if (normalized.forest.length === 0) {
    throw new Error('document has no forest roots');
  }
  return { type: 'doc', content: normalized.forest.map(build) };
}

/**
 * ProseMirror doc node -> Document (always v2). Each doc child becomes one
 * forest root; propositions are rebuilt in leaf order, with source/color/label
 * read from the node attrs (which documentToNode populates and structural
 * edits like splits maintain). `priorDocument` is the fallback for nodes
 * lacking source attrs, and lastly the node degrades to a raw source from its
 * display text.
 */
export function nodeToDocument(
  pmDoc: PMNode,
  priorDocument: AnalysisDocument,
): DocumentV2 {
  const priorById = new Map(priorDocument.propositions.map((p) => [p.id, p]));
  const propositions: Proposition[] = [];
  const blockStarts: SectionBreak[] = [];

  const build = (node: PMNode): TreeNode => {
    if (node.type.name === 'proposition') {
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
      return { kind: 'prop', ref: pid };
    }

    if (node.type.name === 'bracket') {
      const children: TreeNode[] = [];
      node.forEach((child) => {
        children.push(build(child));
      });
      const bracket: BracketTreeNode = {
        kind: 'bracket',
        rel: String(node.attrs.rel ?? ''),
        prominent:
          typeof node.attrs.prominent === 'number' ? node.attrs.prominent : null,
        children,
      };
      if (node.attrs.reversed === true) bracket.reversed = true;
      if (node.attrs.flag === 'review') bracket.flag = 'review';
      return bracket;
    }

    throw new Error(`unexpected node '${node.type.name}' in editor document`);
  };

  if (pmDoc.childCount < 1) {
    throw new Error('editor document must contain at least one root unit');
  }
  const forest: TreeNode[] = [];
  pmDoc.forEach((root) => {
    forest.push(build(root));
  });
  const out: DocumentV2 = { schemaVersion: 2, propositions, forest };
  // Color-block breaks, read back off the propositions that begin them and
  // pruned: the FIRST proposition can carry a blockColor (a merge can leave
  // it holding one), and a break there is no break at all.
  const breaks = pruneBreaks(blockStarts, propositions.map((p) => p.id));
  if (breaks.length > 0) out.sections = breaks;
  return out;
}
