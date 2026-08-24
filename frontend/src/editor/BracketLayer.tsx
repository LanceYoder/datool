// The SVG margin overlay: bracket hit rectangles, spines and ticks, the dots,
// and the clickable stars and labels. Presentational — every gesture is handed
// straight back up to AnalysisEditor, which is where the commands run.
//
// Paint order is the whole trick of this layer:
//   1. hit rectangles, in document PRE-ORDER, so a nested bracket's rect paints
//      after (and therefore wins clicks over) each of its ancestors'. An outer
//      bracket keeps exactly its own rectangle minus its subordinates' areas
//      without anyone computing that difference.
//   2. spines and ticks — inert (pointer-events: none), drawn under everything.
//   3. dots, which sit on top of the rectangles so a dot click is a dot click.
//   4. stars and labels last, so their (generous) hit areas beat both.

import type { BracketGeom, DotGeom } from './layout';
import { REVIEW_COLOR } from './layout';
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

export interface BracketLayerProps {
  brackets: PositionedBracket[];
  dots: DotGeom[];
  width: number;
  height: number;
  selectedBracketPos: number | null;
  selectedDotId: string | null;
  shake: ShakeState | null;
  onSelectBracket: (pos: number) => void;
  onDotClick: (dot: DotGeom) => void;
  onLabelClick: (pos: number, at: Point) => void;
  onStarClick: (pos: number) => void;
}

/** Never let a click in the overlay move the ProseMirror selection. */
function swallow(event: { preventDefault: () => void }): void {
  event.preventDefault();
}

function strokeFor(bracket: PositionedBracket, selected: boolean): string {
  if (selected) return ACCENT;
  return bracket.review ? REVIEW_COLOR : LINE;
}

export default function BracketLayer({
  brackets,
  dots,
  width,
  height,
  selectedBracketPos,
  selectedDotId,
  shake,
  onSelectBracket,
  onDotClick,
  onLabelClick,
  onStarClick,
}: BracketLayerProps) {
  return (
    <svg className="bracket-layer interactive" width={width} height={height} style={{ left: 0 }}>
      <g className="hit-layer">
        {brackets.map((b) => (
          <rect
            key={b.pos}
            className="bracket-hit"
            data-rel={b.rel}
            data-bracket-pos={b.pos}
            x={b.rect.x}
            y={b.rect.y}
            width={b.rect.width}
            height={b.rect.height}
            fill="transparent"
            onMouseDown={swallow}
            onClick={() => onSelectBracket(b.pos)}
          />
        ))}
      </g>

      <g className="spine-layer" pointerEvents="none">
        {brackets.map((b) => {
          const selected = b.pos === selectedBracketPos;
          const stroke = strokeFor(b, selected);
          return (
            <g key={b.pos} className={selected ? 'bracket selected' : 'bracket'} data-rel={b.rel}>
              <line
                x1={b.x}
                y1={b.top}
                x2={b.x}
                y2={b.bottom}
                stroke={stroke}
                strokeWidth={selected ? 3 : 1.8}
              />
              {b.ticks.map((t) => (
                <line
                  key={t.childIndex}
                  x1={t.x1}
                  y1={t.y}
                  x2={t.x2}
                  y2={t.y}
                  stroke={stroke}
                  strokeWidth={selected ? 2.4 : 1.5}
                />
              ))}
            </g>
          );
        })}
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
            </g>
          );
        })}
      </g>

      <g className="glyph-layer">
        {brackets.map((b) => {
          const selected = b.pos === selectedBracketPos;
          const stroke = strokeFor(b, selected);
          return (
            <g key={b.pos}>
              {b.ticks
                .filter((t) => t.star)
                .map((t) => {
                  const cx = (t.x1 + t.x2) / 2;
                  return (
                    <g
                      key={`star-${t.childIndex}`}
                      className="star-hit"
                      onMouseDown={swallow}
                      onClick={() => onStarClick(b.pos)}
                    >
                      <circle cx={cx} cy={t.y - 7} r={10} fill="transparent" />
                      <text
                        className="bracket-star"
                        x={cx}
                        y={t.y - 4}
                        fill={stroke}
                        textAnchor="middle"
                      >
                        *
                      </text>
                    </g>
                  );
                })}
              {b.labels.map((l, i) => {
                const mid = l.placement === 'mid';
                const x = mid ? b.x - 5 : b.x + 5;
                const y = mid ? l.y : l.y - 5;
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
                      fill={stroke}
                      textAnchor={mid ? 'end' : 'start'}
                    >
                      {l.text}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
