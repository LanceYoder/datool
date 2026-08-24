// The "?" panel: every gesture the editor answers to, in one short list.
// Nothing here is state — it is the manual, kept beside the work.

export interface HelpPanelProps {
  onClose: () => void;
}

const GESTURES: { what: string; how: string }[] = [
  { what: 'Connect two units', how: 'Click a dot, then click an adjacent one' },
  { what: 'Label the connection', how: 'Click the bracket’s letters — or type a relationship’s key' },
  { what: 'Remove a connection', how: 'Double-click its dot' },
  { what: 'Split a proposition', how: 'Double-click the word it should end on' },
  { what: 'Join two propositions', how: 'Merge below, at the end of the upper one' },
  { what: 'Move the star', how: 'Click the star — it marks the prominent side' },
  { what: 'Start the tree over', how: 'Clear tree — the propositions stay as they are' },
  { what: 'Undo / redo', how: '⌘Z / ⇧⌘Z, or the toolbar buttons' },
];

export default function HelpPanel({ onClose }: HelpPanelProps) {
  return (
    <div className="help-panel" role="dialog" aria-label="How this editor works">
      <div className="help-head">
        <strong>How this editor works</strong>
        <button type="button" onClick={onClose}>
          Done
        </button>
      </div>
      <dl className="help-list">
        {GESTURES.map((g) => (
          <div className="help-row" key={g.what}>
            <dt>{g.what}</dt>
            <dd className="muted">{g.how}</dd>
          </div>
        ))}
      </dl>
      <p className="muted help-foot">
        The red row is the main point: it appears once every proposition is connected into one
        tree. A starred side is the prominent one; coordinate relationships have no star.
      </p>
    </div>
  );
}
