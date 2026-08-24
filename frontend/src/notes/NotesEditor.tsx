// The notes box: plain writing with bold, italic and underline.
//
// The value is HTML, held by the analysis (its `notes` field). Content that
// arrives from elsewhere is re-set only when it differs from what is already
// on screen, so a save that echoes the notes back cannot interrupt typing.

import { useEffect } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { normalizeNotesHtml, notesExtensions } from './notesSchema';

export interface NotesEditorProps {
  /** Notes as HTML; '' when there are none yet. */
  value: string;
  onChange: (html: string) => void;
}

export default function NotesEditor({ value, onChange }: NotesEditorProps) {
  const editor = useEditor({
    extensions: notesExtensions,
    content: value,
    onUpdate: ({ editor: ed }) => {
      onChange(normalizeNotesHtml(ed.getHTML()));
    },
  });

  useEffect(() => {
    if (editor === null) return;
    if (normalizeNotesHtml(editor.getHTML()) !== value) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [editor, value]);

  if (editor === null) return null;

  const mark = (name: string, label: string, title: string, run: () => void) => (
    <button
      type="button"
      className={editor.isActive(name) ? 'notes-tool on' : 'notes-tool'}
      title={title}
      aria-pressed={editor.isActive(name)}
      onMouseDown={(event) => event.preventDefault()} // keep the selection
      onClick={run}
    >
      {label}
    </button>
  );

  return (
    <div className="notes-editor">
      <div className="notes-tools">
        {mark('bold', 'B', 'Bold (⌘B)', () => editor.chain().focus().toggleBold().run())}
        {mark('italic', 'I', 'Italic (⌘I)', () => editor.chain().focus().toggleItalic().run())}
        {mark('underline', 'U', 'Underline (⌘U)', () =>
          editor.chain().focus().toggleUnderline().run(),
        )}
      </div>
      <EditorContent className="notes-body" editor={editor} />
    </div>
  );
}
