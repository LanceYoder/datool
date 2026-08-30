// Tiptap/ProseMirror schema for the bracketing editor.
//
// The content expressions make invalid trees unrepresentable by construction:
//   doc         content 'unit+'      -> a FOREST of roots (>= 1); disconnected
//                                       propositions are legal roots
//   bracket     content 'unit unit+' -> every bracket has >= 2 children
//                                       (new brackets are made binary by the
//                                       commands; legacy n-ary still loads)
//   proposition atom leaf            -> no text nodes anywhere, so no typing
//
// `prominent` semantics (valid child index iff subordinate, null iff
// coordinate) are attribute-level and cannot be expressed in a content
// expression; commands.ts maintains them on every mutation.
//
// Display text is resolved BEFORE conversion (the corpus fetch happens
// outside the editor); the editor only ever sees final display strings in
// the proposition `text` attr. JSON (get/setContent) is the interchange
// format — the HTML render/parse rules below exist for DOM display and
// robustness only.

import { Node } from '@tiptap/core';

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
  /** Inclusive corpus word range for corpus sources; null for raw. */
  srcStart: number | null;
  srcEnd: number | null;
  /** Raw source text for raw sources; null for corpus. */
  rawText: string | null;
}

/** Attrs carried by every `bracket` node. */
export interface BracketAttrs {
  /** Taxonomy relationship code. */
  rel: string;
  /** Valid child index iff subordinate; null iff coordinate. */
  prominent: number | null;
  /** DERIVED from (prominent, taxonomy.starredLabel) — never user-toggled. */
  reversed: boolean;
  /** 'review' or null. */
  flag: string | null;
}

export const EditorDoc = Node.create({
  name: 'doc',
  topNode: true,
  content: 'unit+',
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
  group: 'unit',
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

export const EditorBracket = Node.create({
  name: 'bracket',
  group: 'unit',
  content: 'unit unit+',
  defining: true,

  addAttributes() {
    return {
      rel: { default: '', rendered: false },
      prominent: { default: null as number | null, rendered: false },
      reversed: { default: false, rendered: false },
      flag: { default: null as string | null, rendered: false },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-bracket]',
        getAttrs: (el: HTMLElement) => {
          const prominent = el.getAttribute('data-prominent');
          return {
            rel: el.getAttribute('data-bracket') ?? '',
            prominent: prominent === null ? null : Number(prominent),
            reversed: el.getAttribute('data-reversed') === 'true',
            flag: el.getAttribute('data-flag'),
          };
        },
      },
    ];
  },

  renderHTML({ node }) {
    const attrs: Record<string, string> = {
      class: 'bracket-node',
      'data-bracket': String(node.attrs.rel),
    };
    if (typeof node.attrs.prominent === 'number') {
      attrs['data-prominent'] = String(node.attrs.prominent);
    }
    if (node.attrs.reversed === true) attrs['data-reversed'] = 'true';
    if (typeof node.attrs.flag === 'string' && node.attrs.flag !== '') {
      attrs['data-flag'] = node.attrs.flag;
    }
    return ['div', attrs, 0];
  },
});

/**
 * A hole: units an edit left unattached, holding their place in the document's
 * order until they are connected again. No relationship, no star — the drawing
 * gives each of its units a loose dot and leaves the bracket above it hanging.
 * The commands collapse a hole holding one unit back into the slot it came
 * from, which is how a tree becomes whole again.
 */
export const EditorHole = Node.create({
  name: 'hole',
  group: 'unit',
  content: 'unit+',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-hole]' }];
  },

  renderHTML() {
    return ['div', { class: 'hole-node', 'data-hole': 'true' }, 0];
  },
});

/**
 * Schema nodes in registration order. EditorProposition MUST precede
 * EditorBracket: when ProseMirror synthesizes a default 'unit' (createAndFill
 * for an empty editor) it picks the first matching type in schema order, and
 * the atom terminates that search — a bracket would recursively require more
 * units.
 */
export const editorNodes = [
  EditorDoc,
  EditorText,
  EditorProposition,
  EditorBracket,
  EditorHole,
];
