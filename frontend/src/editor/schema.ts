// Tiptap/ProseMirror schema for the bracketing editor — FLAT (spec §7.7).
//
// The tree left the text document. The doc's content expression is
// 'proposition+' and nothing else: there is no bracket node, no hole node, no
// 'unit' group, and therefore no way to write a nested — or an n-ary — tree
// into the document at all. Structure lives in the pure core
// (`../tree/core.ts`) and rides the DOC NODE's `tree` attribute (§7.2), which
// is why that attribute is DECLARED here: ProseMirror silently drops writes to
// an attribute a node type does not declare, so declaring it is load-bearing,
// and the stale `sections` write it replaces is the cautionary tale.
//
//   doc         content 'proposition+'  -> the propositions, in reading order
//               attrs.tree              -> the serialized core Forest, ids and
//                                          mint included (editor-internal;
//                                          ids never reach the wire, §7.3)
//   proposition atom leaf               -> no text nodes anywhere, no typing
//
// Two representations of structure must never both be live (§7.7), so the doc
// carries the leaves and the attribute carries the tree over them. They are
// written in ONE transaction by every command in commands.ts, which is what
// makes text+tree one atomic undo step.
//
// Display text is resolved BEFORE conversion (the corpus fetch happens
// outside the editor); the editor only ever sees final display strings in
// the proposition `text` attr. JSON (get/setContent) is the interchange
// format — the HTML render/parse rules below exist for DOM display and
// robustness only.

import { Node } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Forest } from '../tree/core';
import { leaf, loadForest } from '../tree/core';

/** Attrs carried by every `proposition` node. The source lives in the attrs
 * (not only in the Document) so structural edits like proposition splits can
 * derive correct new sources without outside bookkeeping. */
export interface PropositionAttrs {
  /** Proposition id — the join key back to Document.propositions. */
  pid: string;
  /** Verse label, e.g. "1:6a". */
  label: string;
  /** Pre-resolved display text (Greek). */
  text: string;
  color: string | null;
  /** Color block begun here (see sections.ts), or null when none begins. */
  blockColor: number | null;
  /** Inclusive corpus word range for corpus sources; null for raw. */
  srcStart: number | null;
  srcEnd: number | null;
  /** Raw source text for raw sources; null for corpus. */
  rawText: string | null;
}

/** The doc attribute the core state rides on (§7.2). */
export const TREE_ATTR = 'tree';

export const EditorDoc = Node.create({
  name: 'doc',
  topNode: true,
  content: 'proposition+',

  addAttributes() {
    return {
      // The core Forest, verbatim: `{ roots, nextId }` over plain objects, so
      // it is already its own serialization — JSON in the initial content, a
      // structural value in `doc.attrs`, and the SAME object again after undo
      // (DocAttrStep inverts to the previous value, which is how §7.3's ids
      // survive an undo unchanged).
      //
      // Default null rather than an empty forest: a forest is only meaningful
      // beside the propositions it covers, and the only doc PM ever builds
      // without one is the synthesized empty document, which `readTree`
      // answers for.
      [TREE_ATTR]: { default: null as Forest | null, rendered: false },
    };
  },
});

/**
 * ProseMirror's schema compiler requires a 'text' node type to exist in every
 * schema, and Tiptap's content checker builds a temporary schema whose
 * catch-all node needs the 'inline' group to resolve. Neither 'text' nor
 * 'inline' appears in any of OUR content expressions, so text can never occur
 * in a document — typing stays impossible by construction.
 */
export const EditorText = Node.create({
  name: 'text',
  group: 'inline',
});

export const EditorProposition = Node.create({
  name: 'proposition',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      pid: { default: '', rendered: false },
      label: { default: '', rendered: false },
      text: { default: '', rendered: false },
      color: { default: null as string | null, rendered: false },
      // Color blocks: the palette color of the block this proposition BEGINS,
      // null when it begins none (see sections.ts). It rides the proposition,
      // not the doc, for two reasons: a break is a property of the place it
      // falls, and changing ONE node's attrs re-renders one row — changing the
      // doc's attrs rebuilds every row in the view.
      blockColor: { default: null as number | null, rendered: false },
      srcStart: { default: null as number | null, rendered: false },
      srcEnd: { default: null as number | null, rendered: false },
      rawText: { default: null as string | null, rendered: false },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-proposition]',
        getAttrs: (el: HTMLElement) => ({
          pid: el.getAttribute('data-proposition') ?? '',
          label: el.getAttribute('data-label') ?? '',
          text: el.textContent ?? '',
          color: el.getAttribute('data-color'),
        }),
      },
    ];
  },

  renderHTML({ node }) {
    const attrs: Record<string, string> = {
      class: 'prop-node',
      'data-proposition': String(node.attrs.pid),
      'data-label': String(node.attrs.label),
    };
    if (typeof node.attrs.color === 'string' && node.attrs.color !== '') {
      attrs['data-color'] = node.attrs.color;
    }
    // Leaf atom: the display text is emitted directly (no content hole).
    return ['div', attrs, String(node.attrs.text)];
  },
});

/**
 * The schema's nodes. Registration ORDER no longer carries meaning: with
 * 'proposition+' as the doc's content there is exactly one node PM could
 * synthesize, so the dance that kept the atom ahead of the bracket (which
 * would have recursed) is gone with the bracket (§7.7).
 */
export const editorNodes = [EditorDoc, EditorText, EditorProposition];

// ---------------------------------------------------------------------------
// The doc's two halves, read back

/** Every proposition node with its position, in document order. */
export function propositionsInOrder(doc: PMNode): { pos: number; node: PMNode }[] {
  const out: { pos: number; node: PMNode }[] = [];
  doc.forEach((node, offset) => {
    if (node.type.name === 'proposition') out.push({ pos: offset, node });
  });
  return out;
}

/** The pids the document holds, in reading order. */
export function pidsInOrder(doc: PMNode): string[] {
  return propositionsInOrder(doc).map((p) => String(p.node.attrs.pid));
}

/** Position of the proposition node with the given pid, or null. */
export function findPropositionPos(doc: PMNode, pid: string): number | null {
  for (const { pos, node } of propositionsInOrder(doc)) {
    if (String(node.attrs.pid) === pid) return pos;
  }
  return null;
}

/**
 * The core Forest the document carries — the ONE reader every consumer goes
 * through (commands, layout, the overlay, mainPids).
 *
 * Total by construction: a document whose `tree` attr is missing is one PM
 * synthesized for itself (an empty editor), and the only forest that can be
 * true of it is the flat one — every proposition a root of its own. Loading a
 * real analysis always embeds the attribute in the initial JSON (§7.5), so
 * this fallback is never the path a stored tree takes.
 */
export function readTree(doc: PMNode): Forest {
  const stored: unknown = doc.attrs[TREE_ATTR];
  // BOTH halves are checked before the cast. `nextId` is the id mint (§7.3),
  // and a value that merely LOOKS like a forest — roots without a mint, from a
  // hand-built doc or an older attribute shape — would cast cleanly and then
  // hand every op an undefined counter: the first connect mints `NaN`,
  // assertInvariants fails on the comparison rather than on the cause, and the
  // tree is silently dead. Cheaper to refuse the shape here and open flat.
  if (
    stored !== null
    && typeof stored === 'object'
    && Array.isArray((stored as Forest).roots)
    && typeof (stored as Forest).nextId === 'number'
  ) {
    return stored as Forest;
  }
  return loadForest(pidsInOrder(doc).map(leaf));
}
