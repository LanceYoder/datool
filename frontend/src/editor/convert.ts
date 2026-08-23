// Conversion between the server Document shape and the editor's ProseMirror
// document. Pure functions — no editor instance required.
//
// Invariants:
//  - documentToNode . nodeToDocument is the identity for valid documents
//    (propositions rebuilt in leaf order, which equals list order by the
//    server invariant; sources/labels/colors carried over by pid).
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
  Proposition,
  TreeNode,
} from '../types';

/**
 * The SBLGNT text column carries critical-apparatus sigla (⸀ ⸂ ⸃ …) inline;
 * they are part of the edition but noise in an analysis display.
 */
const SIGLA = /[⸀⸁⸂⸃⸄⸅⸆⸇⸈⸉⸊°]/g;

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
 * Document -> ProseMirror doc JSON (feed to buildEditor / setContent).
 * Throws if the tree references an unknown proposition id.
 */
export function documentToNode(
  document: AnalysisDocument,
  textById: ReadonlyMap<string, string>,
): JSONContent {
  const propsById = new Map(document.propositions.map((p) => [p.id, p]));

  const build = (node: TreeNode): JSONContent => {
    if (node.kind === 'prop') {
      const prop = propsById.get(node.ref);
      if (prop === undefined) {
        throw new Error(`tree references unknown proposition '${node.ref}'`);
      }
      const fallback = prop.source.kind === 'raw' ? prop.source.text : '';
      return {
        type: 'proposition',
        attrs: {
          pid: prop.id,
          label: prop.label,
          text: textById.get(prop.id) ?? fallback,
          color: prop.color ?? null,
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

  return { type: 'doc', content: [build(document.tree)] };
}

/**
 * ProseMirror doc node -> Document. Propositions are rebuilt in leaf order;
 * source/color/label are carried over from `priorDocument` by pid. A pid
 * unknown to the prior document (not producible via the editor commands)
 * degrades to a raw source from the node's own attrs.
 */
export function nodeToDocument(
  pmDoc: PMNode,
  priorDocument: AnalysisDocument,
): AnalysisDocument {
  const priorById = new Map(priorDocument.propositions.map((p) => [p.id, p]));
  const propositions: Proposition[] = [];

  const build = (node: PMNode): TreeNode => {
    if (node.type.name === 'proposition') {
      const pid = String(node.attrs.pid);
      const prior = priorById.get(pid);
      let prop: Proposition;
      if (prior !== undefined) {
        prop = { id: prior.id, label: prior.label, source: prior.source };
        if (prior.color !== undefined) prop.color = prior.color;
      } else {
        prop = {
          id: pid,
          label: String(node.attrs.label ?? ''),
          source: { kind: 'raw', text: String(node.attrs.text ?? '') },
        };
        if (typeof node.attrs.color === 'string' && node.attrs.color !== '') {
          prop.color = node.attrs.color;
        }
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

  if (pmDoc.childCount !== 1) {
    throw new Error('editor document must contain exactly one root unit');
  }
  const tree = build(pmDoc.child(0));
  return { schemaVersion: 1, propositions, tree };
}
