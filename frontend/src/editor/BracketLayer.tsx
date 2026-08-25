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
import type { ViewSettings } from './viewSettings';
import { relationColor } from './viewSettings';

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

/** Outer radius of the drawn star; the inner radius is this times 0.42. */
const STAR_R = 7;

/** How far a label's BASELINE sits above its tick line. */
const LABEL_RISE = 5;

/**
 * How far the star's center sits above the tick: the same rise as the label's
 * baseline, plus a third of the label's size — which puts the star's middle at
 * the middle of the letters beside it rather than on their baseline. The size
 * matches .bracket-label in styles.css.
 */
const LABEL_SIZE = 13;
const STAR_RISE = LABEL_RISE + LABEL_SIZE * 0.36;

/** A five-pointed star, point up, centered on (cx, cy). */
function starPath(cx: number, cy: number, r: number): string {
  const points: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? r : r * 0.42;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    points.push(`${(cx + radius * Math.cos(angle)).toFixed(2)},${(cy + radius * Math.sin(angle)).toFixed(2)}`);
  }
  return `M${points.join('L')}Z`;
}

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
  /** Right-click: remove the connections at this dot. */
  onDotDelete: (dot: DotGeom) => void;
  /**
   * Where the pointer is, in overlay coordinates, while a dot is selected —
   * the loose end of the connection being made. Null when nothing is selected
   * or the pointer has not moved yet.
   */
  pointer: Point | null;
  /** Reader's display options — here, the per-relationship bracket colors. */
  view: ViewSettings;
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
  onDotDelete,
  pointer,
  view,
}: BracketLayerProps) {
  const selectedDot = dots.find((d) => d.id === selectedDotId);

  return (
    <svg className="bracket-layer interactive" width={width} height={height} style={{ left: 0 }}>
      <g className="spine-layer" pointerEvents="none">
        {brackets.map((b) => (
          <g key={b.pos} className="bracket" data-rel={b.rel}>
            <line
              x1={b.x}
              y1={b.top}
              x2={b.x}
              y2={b.bottom}
              stroke={relationColor(view, b.rel)}
              strokeWidth={1.8}
            />
            {b.ticks.map((t) => (
              <line
                key={t.childIndex}
                x1={t.x1}
                y1={t.y}
                x2={t.x2}
                y2={t.y}
                stroke={relationColor(view, b.rel)}
                strokeWidth={1.5}
              />
            ))}
          </g>
        ))}
      </g>

      {/* The connection in progress: from the selected dot to the pointer, so
          it is visible where the next click would land it. Inert. */}
      {selectedDot !== undefined && pointer !== null && (
        <line
          className="rubber-band"
          x1={selectedDot.x}
          y1={selectedDot.y}
          x2={pointer.x}
          y2={pointer.y}
          pointerEvents="none"
        />
      )}

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
              onContextMenu={(event) => {
                event.preventDefault();
                onDotDelete(d);
              }}
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
              const y = l.y - LABEL_RISE;
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
                    fill={relationColor(view, b.rel)}
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
                    <circle cx={sx + STAR_R} cy={t.y - STAR_RISE} r={12} fill="transparent" />
                    <path
                      className="bracket-star"
                      d={starPath(sx + STAR_R, t.y - STAR_RISE, STAR_R)}
                      fill={relationColor(view, b.rel)}
                    />
                  </g>
                );
              })}
          </g>
        ))}
      </g>
    </svg>
  );
}
