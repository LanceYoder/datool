// Editor factory for the bracketing editor: schema nodes + undo/redo history
// (@tiptap/extensions UndoRedo — the StarterKit-free history extension for
// Tiptap v3), with all text input disabled. The schema has no text nodes at
// all, so typing is impossible by construction; the NoTextInput guard
// swallows text input events before ProseMirror even tries.

import {
  Editor,
  Extension,
  type AnyExtension,
  type JSONContent,
} from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { UndoRedo } from '@tiptap/extensions';
import type { Document as AnalysisDocument, DocumentV2 } from '../types';
import type { TaxonomyLike } from '../tree/serialize';
import { documentToNode, nodeToDocument } from './convert';
import { TREE_ATTR, editorNodes } from './schema';

const NoTextInput = Extension.create({
  name: 'noTextInput',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          // Returning true marks the input as handled without inserting.
          handleTextInput: () => true,
        },
      }),
    ];
  },
});

/**
 * The core extension set: schema nodes (with an optional replacement for the
 * proposition node — the UI swaps in one carrying a React node view), history,
 * and the text-input guard.
 */
export function editorExtensions(
  propositionNode: AnyExtension = editorNodes[2] as AnyExtension,
): AnyExtension[] {
  const [doc, text] = editorNodes;
  return [doc, text, propositionNode, UndoRedo, NoTextInput] as AnyExtension[];
}

/**
 * Build an Editor with the bracketing schema, undo/redo history, and text
 * input disabled (atoms only). `content` is ProseMirror doc JSON (from
 * documentToNode) — the FLAT propositions plus the tree attribute, together,
 * because a post-mount install transaction was a window of guaranteed data
 * loss (§7.5). When given it becomes the initial state and is NOT an undo
 * step.
 */
export function buildEditor(
  extensions: AnyExtension[] = [],
  content?: JSONContent,
): Editor {
  return new Editor({
    extensions: [...editorExtensions(), ...extensions],
    ...(content !== undefined ? { content } : {}),
    editable: true,
    injectCSS: false,
    enableContentCheck: true,
  });
}

/**
 * Load a Document into an existing editor: flat content and the tree attribute
 * in ONE dispatch (§7.5), outside history — replacing the whole document
 * should not be undoable back to the previous analysis, and neither half of it
 * should ever be installed without the other.
 */
export function setDocument(
  editor: Editor,
  document: AnalysisDocument,
  textById: ReadonlyMap<string, string>,
  taxonomy: readonly TaxonomyLike[],
): void {
  const json = documentToNode(document, textById, taxonomy);
  const next = editor.schema.nodeFromJSON(json);
  const tr = editor.state.tr;
  tr.replaceWith(0, editor.state.doc.content.size, next.content);
  tr.setDocAttribute(TREE_ATTR, next.attrs[TREE_ATTR]);
  tr.setMeta('addToHistory', false);
  editor.view.dispatch(tr);
}

/** Read the editor state back out as a v2 Document (see nodeToDocument). */
export function getDocument(
  editor: Editor,
  priorDocument: AnalysisDocument,
  taxonomy: readonly TaxonomyLike[],
): DocumentV2 {
  return nodeToDocument(editor.state.doc, priorDocument, taxonomy);
}
