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
import type { Document as AnalysisDocument } from '../types';
import { documentToNode, nodeToDocument } from './convert';
import { editorNodes } from './schema';

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
 * Build an Editor with the bracketing schema, undo/redo history, and text
 * input disabled (atoms only). `content` is ProseMirror doc JSON (from
 * documentToNode); when given it becomes the initial state and is NOT an
 * undo step. Extra extensions (node views, selection plugins, ...) append
 * after the core set.
 */
export function buildEditor(
  extensions: AnyExtension[] = [],
  content?: JSONContent,
): Editor {
  return new Editor({
    extensions: [...editorNodes, UndoRedo, NoTextInput, ...extensions],
    ...(content !== undefined ? { content } : {}),
    editable: true,
    injectCSS: false,
    enableContentCheck: true,
  });
}

/**
 * Load a Document into an existing editor. Not recorded in history —
 * replacing the whole document should not be undoable back to the previous
 * analysis.
 */
export function setDocument(
  editor: Editor,
  document: AnalysisDocument,
  textById: ReadonlyMap<string, string>,
): void {
  const json = documentToNode(document, textById);
  editor.chain().setMeta('addToHistory', false).setContent(json).run();
}

/** Read the editor state back out as a Document (see nodeToDocument). */
export function getDocument(
  editor: Editor,
  priorDocument: AnalysisDocument,
): AnalysisDocument {
  return nodeToDocument(editor.state.doc, priorDocument);
}
