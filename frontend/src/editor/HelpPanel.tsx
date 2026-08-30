// The "?" panel: every gesture the editor answers to, in one short list.
// Nothing here is state — it is the manual, kept beside the work. The "?"
// button opens it and closes it again, so the panel needs no control of its
// own.

/**
 * Two columns: what you do to the TREE, and what you do to the PASSAGE —
 * dividing and joining its propositions, and the color blocks over them.
 * Undo and redo are not here: the toolbar carries them, and the shortcuts
 * are the ones every application uses.
 */
const COLUMNS: { what: string; how: string }[][] = [
  [
    { what: 'Connect two units', how: 'Click a dot, then click an adjacent one' },
    {
      what: 'Label the connection',
      how: 'Click the bracket’s letters. You may type a key as a shortcut',
    },
    {
      what: 'Remove a connection',
      how: 'Right-click its dot — only that one goes, and what it held hangs loose',
    },
    { what: 'Move the star', how: 'Click the star' },
  ],
  [
    { what: 'Split a proposition', how: 'Right-click the word it should end on' },
    { what: 'Join two propositions', how: 'Right-click the last word of the upper one' },
    { what: 'Begin a color block', how: 'Hover the strip on the right, then click the +' },
    { what: 'Join two blocks', how: 'Hover their division on the strip, then click the −' },
  ],
];

export default function HelpPanel() {
  return (
    <div className="help-panel" role="dialog" aria-label="How this editor works">
      <div className="help-columns">
        {COLUMNS.map((column) => (
          <dl className="help-list" key={column[0]?.what}>
            {column.map((g) => (
              <div className="help-row" key={g.what}>
                <dt>{g.what}</dt>
                <dd className="muted">{g.how}</dd>
              </div>
            ))}
          </dl>
        ))}
      </div>
    </div>
  );
}
