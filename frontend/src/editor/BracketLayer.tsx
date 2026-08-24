// The SVG margin overlay: bracket spines and ticks, the dots, and the
// clickable stars and labels. Presentational — every gesture is handed
// straight back up to AnalysisEditor, which is where the commands run.
//
// There is no click-to-select-a-bracket area: dots, labels and stars are the
// only handles. Paint order still matters:
//   1. spines and ticks — inert (pointer-events: none), drawn underneath.
//   2. dots.
//   3. labels, then stars LAST, so where a star hugs its letters the star
//      wins the click (a mis-hit there used to open the relationship menu).

import type { BracketGeom, DotGeom } from './layout';
import type { Point } from './interaction';

/** A laid-out bracket zipped with the ProseMirror position of its node. */
export interface PositionedBracket extends BracketGeom {
  pos: number;
}

/** A failed connection attempt: the dot to shake, with a re-run counter. */
export interface ShakeState {
  dotId: string;
  seq: number;
}

const LINE = '#374151';
const ACCENT = '#1d4ed8';
const MUTED = '#9ca3af';

/** Every dot is this size, whatever it belongs to and however it is nested. */
const DOT_R = 5;
/** The (invisible) click target around each dot. */
const DOT_HIT_R = 12;

/** Rough advance width of the 13px label font, for the label hit rect. */
const LABEL_CHAR_W = 8;

/**
 * How far a label sits from its bracket's spine: end labels start this far
 * right of it, mid (coordinate) labels end this far left of it. The bracket's
 * own dot sits ON the spine, so this is what keeps letters and dots apart.
 */
const LABEL_OFFSET = 12;

/** Gap between an end label's last letter and its star. */
const STAR_GAP = 4;

/**
 * How far LEFT of a root bracket's dot its delete cross sits. Left, because
 * everything a bracket draws — spine, ticks, labels, stars — is at the dot or
 * to its right: out here the cross can never land on a line.
 */
const DELETE_OFFSET = 17;

export interface BracketLayerProps {
  brackets: PositionedBracket[];
  dots: DotGeom[];
  width: number;
  height: number;
  selectedDotId: string | null;
  shake: ShakeState | null;
  onDotClick: (dot: DotGeom) => void;
  onLabelClick: (pos: number, at: Point) => void;
  onStarClick: (pos: number) => void;
  /** Remove the connection a ROOT bracket's dot names (its delete cross). */
  onDeleteBracket: (dot: DotGeom) => void;
}

/** Never let a click in the overlay move the ProseMirror selection. */
function swallow(event: { preventDefault: () => void }): void {
  event.preventDefault();
}

export default function BracketLayer({
  brackets,
  dots,
  width,
  height,
  selectedDotId,
  shake,
  onDotClick,
  onLabelClick,
  onStarClick,
  onDeleteBracket,
}: BracketLayerProps) {
  return (
    <svg className="bracket-layer interactive" width={width} height={height} style={{ left: 0 }}>
      <g className="spine-layer" pointerEvents="none">
        {brackets.map((b) => (
          <g key={b.pos} className="bracket" data-rel={b.rel}>
            <line x1={b.x} y1={b.top} x2={b.x} y2={b.bottom} stroke={LINE} strokeWidth={1.8} />
            {b.ticks.map((t) => (
              <line
                key={t.childIndex}
                x1={t.x1}
                y1={t.y}
                x2={t.x2}
                y2={t.y}
                stroke={LINE}
                strokeWidth={1.5}
              />
            ))}
          </g>
        ))}
      </g>

      <g className="dot-layer">
        {dots.map((d) => {
          const selected = d.id === selectedDotId;
          const shaking = shake !== null && shake.dotId === d.id;
          // Every dot renders (and behaves) identically; 'root' only marks
          // units that are currently disconnected, for styling and tests.
          const classes = ['dot-group'];
          if (d.root) classes.push('root');
          if (selected) classes.push('selected');
          if (shaking) classes.push('shake');
          return (
            <g
              // Re-keying on the shake counter restarts the CSS animation when
              // the same dot is rejected twice in a row.
              key={shaking && shake !== null ? `${d.id}!${shake.seq}` : d.id}
              className={classes.join(' ')}
              data-dot={d.id}
              onMouseDown={swallow}
              onClick={() => onDotClick(d)}
            >
              {d.stubX1 !== undefined && d.stubX2 !== undefined && (
                <line
                  className="dot-stub"
                  x1={d.stubX1}
                  y1={d.y}
                  x2={d.stubX2}
                  y2={d.y}
                  stroke={selected ? ACCENT : MUTED}
                  strokeWidth={1}
                />
              )}
              <circle cx={d.x} cy={d.y} r={DOT_HIT_R} fill="transparent" />
              <circle
                className="dot"
                cx={d.x}
                cy={d.y}
                r={DOT_R}
                fill={selected ? ACCENT : '#fff'}
                stroke={selected ? ACCENT : LINE}
                strokeWidth={1.6}
              />
              {/* One click to undo a connection, on the bracket that holds it.
                  Only a ROOT bracket can be dissolved on its own, which is
                  exactly where the menu offers Disconnect. */}
              {d.kind === 'bracket' && d.root && (
                <g
                  className="dot-delete"
                  onMouseDown={swallow}
                  onClick={(event) => {
                    event.stopPropagation();
                    onDeleteBracket(d);
                  }}
                >
                  <title>Delete this connection</title>
                  <circle
                    cx={d.x - DELETE_OFFSET}
                    cy={d.y}
                    r={DOT_HIT_R - 1}
                    fill="transparent"
                  />
                  <circle
                    className="dot-delete-disc"
                    cx={d.x - DELETE_OFFSET}
                    cy={d.y}
                    r={DOT_R + 2}
                  />
                  <path
                    className="dot-delete-cross"
                    d={`M${d.x - DELETE_OFFSET - 3},${d.y - 3} l6,6 M${d.x - DELETE_OFFSET + 3},${d.y - 3} l-6,6`}
                  />
                </g>
              )}
            </g>
          );
        })}
      </g>

      <g className="glyph-layer">
        {/* Labels first, stars LAST: where the two touch (a star hugs its
            letters), the star must win the click — otherwise a star click
            opens the relationship menu instead of flipping the star. */}
        {brackets.map((b) => (
          <g key={`labels-${b.pos}`}>
            {b.labels.map((l, i) => {
              const mid = l.placement === 'mid';
              // Each label gets its own lane, clear of the bracket's dot
              // (which sits ON the spine): end labels start LABEL_OFFSET
              // right of the spine, mid labels end LABEL_OFFSET left of it.
              // Both sit ABOVE their line, so a parent's tick arriving at a
              // coordinate bracket's midpoint never runs through the letters.
              const x = mid ? b.x - LABEL_OFFSET : b.x + LABEL_OFFSET;
              const y = l.y - 5;
              const w = Math.max(18, l.text.length * LABEL_CHAR_W + 10);
              const hitX = mid ? x - w : x - 2;
              return (
                <g
                  key={`label-${i}`}
                  className="label-hit"
                  data-label={l.text}
                  onMouseDown={swallow}
                  onClick={() => onLabelClick(b.pos, { x: hitX, y: y + 6 })}
                >
                  {/* Sits just above the label's own row so it never covers
                      the tick line's dot. */}
                  <rect x={hitX} y={y - 14} width={w} height={16} fill="transparent" />
                  <text
                    className="bracket-label"
                    x={x}
                    y={y}
                    fill={LINE}
                    textAnchor={mid ? 'end' : 'start'}
                  >
                    {l.text}
                  </text>
                </g>
              );
            })}
          </g>
        ))}
        {brackets.map((b) => (
          <g key={`stars-${b.pos}`}>
            {b.ticks
              .filter((t) => t.star)
              .map((t) => {
                // The star sits a fixed gap after its end's letters (or in
                // their place when that end shows none) — never out in the
                // middle of the tick.
                const label = b.labels.find(
                  (l) => l.placement !== 'mid' && l.y === t.y,
                );
                const sx =
                  b.x +
                  LABEL_OFFSET +
                  STAR_GAP +
                  (label !== undefined ? label.text.length * LABEL_CHAR_W : 0);
                return (
                  <g
                    key={`star-${t.childIndex}`}
                    className="star-hit"
                    onMouseDown={swallow}
                    onClick={() => onStarClick(b.pos)}
                  >
                    <circle cx={sx + 5} cy={t.y - 9} r={12} fill="transparent" />
                    <text
                      className="bracket-star"
                      x={sx}
                      y={t.y - 5}
                      fill={LINE}
                      textAnchor="start"
                    >
                      *
                    </text>
                  </g>
                );
              })}
          </g>
        ))}
      </g>
    </svg>
  );
}
