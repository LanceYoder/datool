// The "?" panel: every gesture the editor answers to, in one short list.
// Nothing here is state — it is the manual, kept beside the work. The "?"
// button opens it and closes it again, so the panel needs no control of its
// own.

const GESTURES: { what: string; how: string }[] = [
  { what: 'Connect two units', how: 'Click a dot, then click an adjacent one' },
  { what: 'Label the connection', how: 'Click the bracket’s letters. You may type a key as a shortcut' },
  { what: 'Remove a connection', how: 'Double-click its dot' },
  { what: 'Split a proposition', how: 'Double-click the word it should end on' },
  { what: 'Join two propositions', how: 'Merge below, at the end of the upper one' },
  { what: 'Move the star', how: 'Click the star' },
  { what: 'Undo / redo', how: '⌘Z / ⇧⌘Z, or the toolbar buttons' },
];

export default function HelpPanel() {
  return (
    <div className="help-panel" role="dialog" aria-label="How this editor works">
      <dl className="help-list">
        {GESTURES.map((g) => (
          <div className="help-row" key={g.what}>
            <dt>{g.what}</dt>
            <dd className="muted">{g.how}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
