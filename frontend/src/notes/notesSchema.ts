// The notes editor's schema: paragraphs of text with bold, italic and
// underline — nothing else.
//
// Written out rather than pulled from StarterKit for the same reason the
// bracketing editor is (see editor.ts): the schema IS the contract. Anything
// pasted into the notes that these nodes and marks cannot express — a script,
// a table, an image — is dropped on the way in, so what is stored is only
// ever text and its emphasis.

import { Mark, Node } from '@tiptap/core';
import type { AnyExtension } from '@tiptap/core';
import { UndoRedo } from '@tiptap/extensions';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    notesMarks: {
      toggleBold: () => ReturnType;
      toggleItalic: () => ReturnType;
      toggleUnderline: () => ReturnType;
      setHardBreak: () => ReturnType;
    };
  }
}

const NotesDocument = Node.create({ name: 'doc', topNode: true, content: 'block+' });

const Text = Node.create({ name: 'text', group: 'inline' });

const Paragraph = Node.create({
  name: 'paragraph',
  group: 'block',
  content: 'inline*',
  parseHTML: () => [{ tag: 'p' }],
  renderHTML: ({ HTMLAttributes }) => ['p', HTMLAttributes, 0],
});

const HardBreak = Node.create({
  name: 'hardBreak',
  group: 'inline',
  inline: true,
  selectable: false,
  parseHTML: () => [{ tag: 'br' }],
  renderHTML: ({ HTMLAttributes }) => ['br', HTMLAttributes],
  addKeyboardShortcuts() {
    return { 'Shift-Enter': () => this.editor.commands.setHardBreak() };
  },
  addCommands() {
    return {
      setHardBreak:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name }),
    };
  },
});

const Bold = Mark.create({
  name: 'bold',
  parseHTML: () => [{ tag: 'strong' }, { tag: 'b' }, { style: 'font-weight=bold' }],
  renderHTML: ({ HTMLAttributes }) => ['strong', HTMLAttributes, 0],
  addCommands() {
    return { toggleBold: () => ({ commands }) => commands.toggleMark(this.name) };
  },
  addKeyboardShortcuts() {
    return { 'Mod-b': () => this.editor.commands.toggleBold() };
  },
});

const Italic = Mark.create({
  name: 'italic',
  parseHTML: () => [{ tag: 'em' }, { tag: 'i' }, { style: 'font-style=italic' }],
  renderHTML: ({ HTMLAttributes }) => ['em', HTMLAttributes, 0],
  addCommands() {
    return { toggleItalic: () => ({ commands }) => commands.toggleMark(this.name) };
  },
  addKeyboardShortcuts() {
    return { 'Mod-i': () => this.editor.commands.toggleItalic() };
  },
});

const Underline = Mark.create({
  name: 'underline',
  parseHTML: () => [{ tag: 'u' }, { style: 'text-decoration=underline' }],
  renderHTML: ({ HTMLAttributes }) => ['u', HTMLAttributes, 0],
  addCommands() {
    return { toggleUnderline: () => ({ commands }) => commands.toggleMark(this.name) };
  },
  addKeyboardShortcuts() {
    return { 'Mod-u': () => this.editor.commands.toggleUnderline() };
  },
});

export const notesExtensions: AnyExtension[] = [
  NotesDocument,
  Paragraph,
  Text,
  HardBreak,
  Bold,
  Italic,
  Underline,
  UndoRedo,
];

/** Empty notes come back from the editor as an empty paragraph; store ''. */
export function normalizeNotesHtml(html: string): string {
  return html === '<p></p>' || html === '<p><br></p>' ? '' : html;
}
