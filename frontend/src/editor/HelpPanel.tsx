// The "?" panel: every gesture the editor answers to, in one short list.
// Nothing here is state — it is the manual, kept beside the work. The "?"
// button opens it and closes it again, so the panel needs no control of its
// own.

/**
 * Two columns: what you do to the TREE, and what you do to the PROPOSITIONS
 * themselves. Undo and redo are not here — the toolbar carries them, and the
 * shortcuts are the ones every application uses.
 */
const COLUMNS: { what: string; how: string }[][] = [
  [
    { what: 'Connect two units', how: 'Click a dot, then click an adjacent one' },
    {
      what: 'Label the connection',
      how: 'Click the bracket’s letters. You may type a key as a shortcut',
    },
    { what: 'Remove a connection', how: 'Right-click its dot, or select it and press Delete' },
    { what: 'Move the star', how: 'Click the star' },
  ],
  [
    { what: 'Split a proposition', how: 'Right-click the word it should end on' },
    { what: 'Join two propositions', how: 'Right-click the last word of the upper one' },
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
