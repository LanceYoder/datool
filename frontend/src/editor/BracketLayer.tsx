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
//
// §5.2's aiming signals all arrive as PROPS, worked out from the core state
// upstream: the endangered ids `previewConnect` enumerated, whether the aimed
// target refuses, and which brackets a gesture just anchored. The hover
// span-wash is GONE (§10 A6: quiet the UI). Nothing here re-derives a rule (§7.9) — this file only knows how
// each of those answers is drawn.

import type { CSSProperties } from 'react';
import { useMemo } from 'react';
import {
  COL_W,
  LABEL_BOX_RX,
  STAR_R,
  STUB_W,
  isCompactLabel,
  isSymbolLabel,
  labelBox,
  marginInk,
  starCenterX,
  starCenterY,
} from './layout';
import type { BracketGeom, DotGeom } from './layout';
import type { Point } from './interaction';
import type { ViewSettings } from './viewSettings';
import { relationColor } from './viewSettings';
import { useTheme } from '../theme';
import DrolleryDefs, { DrolleryLayer, drolleryPerches } from './Drolleries';

/** A failed connection attempt: the dot to shake, with a re-run counter. */
export interface ShakeState {
  dotId: string;
  seq: number;
}

// The tree's ink, as CSS variables rather than literals: a skin repaints the
// whole overlay by redefining them (themes.css), and the geometry never moves.
// They are handed to SVG through inline `style`, not through presentation
// attributes — only a style declaration is guaranteed to resolve var().
const LINE = 'var(--tree-line, #374151)';
const ACCENT = 'var(--tree-accent, #1d4ed8)';
const MUTED = 'var(--tree-muted, #9ca3af)';
const DOT_FILL = 'var(--tree-dot-fill, #fff)';
/** What a SELECTED dot is filled with — flat accent, unless a skin would
 * rather it were scribbled in or gilded. */
const DOT_SELECTED_FILL = 'var(--tree-dot-selected-fill, var(--tree-accent, #1d4ed8))';
const DOT_STROKE = 'var(--tree-dot-stroke, var(--tree-line, #374151))';
/** Labels and stars may take an ink of their own — a manuscript writes its
 * letters in one color and gilds its stars in another. */
const LABEL_INK = 'var(--tree-label, var(--tree-line, #374151))';
const STAR_INK = 'var(--tree-star, var(--tree-line, #374151))';
/**
 * §5.2's endangered ink: what a bracket is drawn in while the aim would BREAK
 * it — a claimer, the crossed bracket, or a cascade death. It replaces the
 * relationship's own colour rather than tinting it, because "this is about to
 * go" outranks "this is a Ground"; the rest of the endangered style (the
 * bracket steps back, its label ring follows) is the stylesheet's.
 */
const ENDANGERED = 'var(--tree-endangered, var(--danger, #b91c1c))';

/**
 * What a bracket is drawn in: its relationship's color while color coding is
 * on, and otherwise the skin's ink. `fallback` is the variable to fall back
 * to — the line's, the label's or the star's.
 */
function ink(view: ViewSettings, rel: string, fallback: string): string {
  return view.colorCoding ? relationColor(view, rel) : fallback;
}

/** Every dot is this size, whatever it belongs to and however it is nested. */
const DOT_R = 5;
/** The (invisible) click target around each dot. */
const DOT_HIT_R = 12;

/**
 * The label as it is SET. The taxonomy writes Negative–Positive's first half
 * with a hyphen; a hyphen is a word-joiner, not an operator, and beside a "+"
 * it reads as a stray tick. Drawn as a true minus, which is the same width as
 * the plus it answers to. The data keeps its hyphen (data-label, and every
 * selector that reads it).
 */
function labelGlyph(text: string): string {
  return text === '-' ? '\u2212' : text;
}

/** The two sizes a label is set at — .bracket-label(.symbol) in styles.css. */
const LABEL_SIZE = 13;
const SYMBOL_SIZE = 20;

/**
 * Where a glyph's INK centers above its own baseline, as a share of its font
 * size. This is what puts a label in the middle of its square rather than
 * merely near it: the box is centered on the geometry, but a glyph is not
 * centered on its baseline, and the two do not meet by themselves. (Nor does
 * dominant-baseline do it — that centers the EM BOX, descender room included,
 * and every label here is caps with nothing below the line.)
 *
 * Measured off the interface face at the sizes above. The letters all land
 * within a hair of 0.36. The marks are set on the math axis and center lower;
 * "∴" lower still, its three dots sitting near the baseline.
 */
const LETTER_INK = 0.36;
const MARK_INK = 0.285;
const INK_EXCEPTIONS: Record<string, number> = { '∴': 0.19 };

/** How far a label's baseline sits BELOW the middle of its square. */
function baselineDrop(text: string): number {
  const symbol = isSymbolLabel(text);
  const ratio = INK_EXCEPTIONS[text] ?? (symbol ? MARK_INK : LETTER_INK);
  return (symbol ? SYMBOL_SIZE : LABEL_SIZE) * ratio;
}

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

/**
 * A repeatable wobble in [-1, 1] from a seed — the same star comes out the
 * same way on every render, which is the difference between a drawn hand and
 * a twitch.
 */
function wobble(seed: number): number {
  const x = Math.sin(seed * 127.1 + 43.7) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

/**
 * A number for a NAME — a dot's id, a bracket's id and which of its strokes.
 * The doodles are seeded from these and never from geometry (ruled
 * 2026-09-17): a stroke is drawn once, when its bracket is made, and keeps
 * that drawing however the tree around it moves. The core's ids are minted at
 * creation and never reused, so a deleted bracket's doodle goes with it and a
 * new bracket gets a new one.
 */
function seedOf(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i += 1) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/**
 * A dot scribbled in, the way a pen actually fills a circle: back and forth
 * across it, and past the line at the turns, because nobody stops exactly on
 * it. A fill cannot do this — a fill is clipped to the shape it fills — so
 * the scribble is a drawn stroke laid over the ring.
 *
 * Seeded from the dot's NAME (seedOf), so the same dot is scribbled the same
 * way on every render and wherever the tree carries it.
 */
function scribblePath(cx: number, cy: number, r: number, seed: number): string {
  const passes = 11;
  const reach = r * 1.3;
  const point = (i: number): [number, number] => {
    const y = -reach + (2 * reach * i) / passes;
    // Half-width of the circle at this height, opened out so the stroke
    // crosses the line — and, above and below the circle, a short overrun.
    const inside = Math.max(0, r * r - Math.min(r, Math.abs(y)) ** 2);
    const w = Math.sqrt(inside) * 1.12 + r * 0.34 + r * 0.16 * wobble(seed * 1000 + i);
    return [cx + (i % 2 === 0 ? -w : w), cy + y];
  };
  const [x0, y0] = point(0);
  let d = `M${x0.toFixed(2)},${y0.toFixed(2)}`;
  for (let i = 1; i <= passes; i += 1) {
    const [, py] = point(i - 1);
    const [x, y] = point(i);
    // The turn loops out past the end of the stroke rather than folding back
    // on itself — that loop is what makes it read as a scribble.
    const bulge = x + (x - cx) * 0.32;
    d += `Q${bulge.toFixed(2)},${((py + y) / 2).toFixed(2)} ${x.toFixed(2)},${y.toFixed(2)}`;
  }
  return d;
}

/**
 * A line as a hand draws it: bowed off its chord, and a touch long at both
 * ends, the way a stroke overruns the corner it was aiming for. The bow is
 * seeded from the stroke's NAME (seedOf) — never its endpoints — so a spine
 * bends the same way on every render and keeps its bend when the tree moves
 * it; only a new bracket is drawn afresh.
 *
 * Generated geometry, not a displacement filter: a filter shifts neighbouring
 * pixels of a 1.5px line by different amounts and eats the line away in
 * places, which is why the ticks came out dashed.
 */
function handLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  seed: number,
  amp = 0.02,
  cap = 2.6,
  over = 1.2,
): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy) || 1;
  // Long strokes bend more than short ones, but never by more than a couple
  // of pixels — this is a steady hand, not a shaky one. A quill is steadier
  // still than a ballpoint, so the book passes a smaller amplitude.
  const bow = Math.min(cap, length * amp) * wobble(seed);
  const ux = dx / length;
  const uy = dy / length;
  const ax = x1 - ux * over + uy * 0.6 * wobble(seed + 3);
  const ay = y1 - uy * over - ux * 0.6 * wobble(seed + 3);
  const bx = x2 + ux * over + uy * 0.6 * wobble(seed + 7);
  const by = y2 + uy * over - ux * 0.6 * wobble(seed + 7);
  const mx = (ax + bx) / 2 - uy * bow;
  const my = (ay + by) / 2 + ux * bow;
  return (
    `M${ax.toFixed(2)},${ay.toFixed(2)} ` +
    `Q${mx.toFixed(2)},${my.toFixed(2)} ${bx.toFixed(2)},${by.toFixed(2)}`
  );
}

/**
 * The star as a pen draws it: one unbroken stroke around a pentagram, its five
 * points off a true circle and its strokes bowed, closing a little past where
 * it began — nobody's hand shuts the loop exactly.
 */
function penStarPath(cx: number, cy: number, r: number): string {
  const point = (i: number): [number, number] => {
    const angle = (Math.PI * 2 * i) / 5 - Math.PI / 2 + 0.05 * wobble(i);
    const radius = r * (1.05 + 0.1 * wobble(i + 9));
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
  };
  const order = [0, 2, 4, 1, 3, 0];
  const [x0, y0] = point(order[0]!);
  let d = `M${x0.toFixed(2)},${y0.toFixed(2)}`;
  for (let i = 1; i < order.length; i += 1) {
    const [xa, ya] = point(order[i - 1]!);
    const [xb, yb] = point(order[i]!);
    // Bow each stroke off its chord: a ruled line is the one thing a pen
    // never draws.
    const bow = 0.06 * wobble(i + 21);
    const mx = (xa + xb) / 2 - (yb - ya) * bow;
    const my = (ya + yb) / 2 + (xb - xa) * bow;
    d += `Q${mx.toFixed(2)},${my.toFixed(2)} ${xb.toFixed(2)},${yb.toFixed(2)}`;
  }
  return d;
}

/** A bracket a gesture just made whole (§5.2), with a re-run counter. */
export interface AnchorState {
  ids: readonly number[];
  seq: number;
}

/** Shared empty list, so a default prop never re-arms the memos below. */
const NO_IDS: readonly number[] = [];

export interface BracketLayerProps {
  brackets: BracketGeom[];
  dots: DotGeom[];
  width: number;
  height: number;
  selectedDotId: string | null;
  shake: ShakeState | null;
  onDotClick: (dot: DotGeom) => void;
  onLabelClick: (bracketId: number, at: Point) => void;
  onStarClick: (bracketId: number) => void;
  /** Right-click: remove the connections at this dot. */
  onDotDelete: (dot: DotGeom) => void;
  /** The pointer entered a dot, or left one (null) — §5.2's first signal. */
  onDotHover?: (dot: DotGeom | null) => void;
  /**
   * §5.2: every bracket `previewConnect` says the aimed join would break —
   * claimers and a crossed bracket, ALL of them. The list comes straight from
   * the core (§7.9: the UI never re-derives classification).
   */
  endangered?: readonly number[];
  /** The dot under the pointer while another is armed: where the aim lands. */
  aimTargetId?: string | null;
  /** §5.2: that target would REFUSE — the aim line says so in its own style. */
  aimRefused?: boolean;
  /** §5.2: brackets a gesture just anchored, for the emphasis animation. */
  anchored?: AnchorState | null;
  /**
   * Where the pointer is, in overlay coordinates, while a dot is selected —
   * the loose end of the connection being made. Null when nothing is selected
   * or the pointer has not moved yet.
   */
  pointer: Point | null;
  /** Reader's display options — here, the per-relationship bracket colors. */
  view: ViewSettings;
}

/**
 * The connection in progress, drawn as the BRACKET it would become: out from
 * the pointer to a spine one column left of whichever end is further left —
 * where the bracket itself will stand — down that spine, and out to the dot.
 *
 * A carried HANGING END is not this: nothing new is being made there, so its
 * own tick follows the pointer instead (see carriedHang).
 */
function rubberBandPath(dot: DotGeom, pointer: Point): string {
  const spineX = Math.min(dot.x, pointer.x) - (COL_W - STUB_W);
  return (
    `M${pointer.x.toFixed(1)},${pointer.y.toFixed(1)} ` +
    `L${spineX.toFixed(1)},${pointer.y.toFixed(1)} ` +
    `L${spineX.toFixed(1)},${dot.y.toFixed(1)} ` +
    `L${dot.x.toFixed(1)},${dot.y.toFixed(1)}`
  );
}

/** Never let a click in the overlay move the ProseMirror selection. */
function swallow(event: { preventDefault: () => void }): void {
  event.preventDefault();
}

/**
 * The hook a quill leaves when it lifts off the end of a rule. Drawn at the
 * top and (mirrored) the bottom of every bracket's spine in the book, where a
 * plain stopped line looks like it was made with a ruler.
 */
function flourish(x: number, y: number, up: boolean): string {
  const d = up ? -1 : 1;
  return (
    `M${x.toFixed(1)},${y.toFixed(1)} ` +
    `c0,${(5.5 * d).toFixed(1)} -1.6,${(8.4 * d).toFixed(1)} -5.2,${(8.6 * d).toFixed(1)} ` +
    `c-3.4,${(0.2 * d).toFixed(1)} -5.4,${(-2.4 * d).toFixed(1)} -4.2,${(-4.8 * d).toFixed(1)} ` +
    `c0.9,${(-1.8 * d).toFixed(1)} 3.6,${(-1.6 * d).toFixed(1)} 3.9,${(0.6 * d).toFixed(1)}`
  );
}

/**
 * One line of the tree: ruled, or — in the notebook — drawn. Both carry the
 * same endpoints; only the path between them differs.
 */
type Hand = 'ruled' | 'pen' | 'quill';

function Stroke({
  x1,
  y1,
  x2,
  y2,
  width,
  color,
  hand,
  name,
  hanging = false,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  color: string;
  hand: Hand;
  /** What this stroke IS — the seed of its hand-drawn wobble (seedOf). */
  name: string;
  /** Nothing on the far end: draw it as a line that stops. */
  hanging?: boolean;
}) {
  const loose = hanging ? { className: 'hanging' } : {};
  if (hand === 'ruled') {
    return (
      <line
        {...loose}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        style={{ stroke: color }}
        strokeWidth={width}
      />
    );
  }
  // A quill is a steadier instrument than a ballpoint: it bends its line half
  // as far, and does not overrun the corner it was aiming for.
  const pen = hand === 'pen';
  return (
    <path
      {...loose}
      d={
        pen
          ? handLine(x1, y1, x2, y2, seedOf(name))
          : handLine(x1, y1, x2, y2, seedOf(name), 0.008, 1.3, 0.4)
      }
      fill="none"
      style={{ stroke: color }}
      strokeWidth={pen ? width + 0.5 : width}
      strokeLinecap="round"
    />
  );
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
  onDotHover,
  endangered = NO_IDS,
  aimTargetId = null,
  aimRefused = false,
  anchored = null,
  pointer,
  view,
}: BracketLayerProps) {
  const selectedDot = dots.find((d) => d.id === selectedDotId);
  const doomed = useMemo(() => new Set(endangered), [endangered]);
  const whole = useMemo(() => new Set(anchored?.ids ?? NO_IDS), [anchored]);
  /**
   * The AIM: while a dot is armed and the pointer is over another dot, the
   * line SNAPS to that dot instead of trailing the pointer, so the shape on
   * screen is the bracket the click would make (§5.2). Everything else about
   * the line — where it leaves from, the spine it drops down — is unchanged.
   */
  const aimDot = dots.find((d) => d.id === aimTargetId && d.id !== selectedDotId);
  // A hanging end being carried: THIS tick follows the pointer — the line the
  // reader picked up is the line that moves, not a second one drawn beside it.
  // A bracket may hang at BOTH ends now (§10 A4), so the carried end is named
  // by the bracket AND the side.
  const carriedHang =
    selectedDot !== undefined && selectedDot.kind === 'hang' && pointer !== null
      ? { id: Number(selectedDot.ref), side: selectedDot.side }
      : null;
  // Which instrument the tree is drawn with. The notebook is a ballpoint —
  // bowed lines, a struck star, a scribbled-in dot. The book is a quill:
  // steadier, flourished at the ends of its rules, and it brings the margin's
  // creatures with it.
  const theme = useTheme();
  const pen = theme === 'notebook';
  const quill = theme === 'book';
  const hand: Hand = pen ? 'pen' : quill ? 'quill' : 'ruled';

  // Where the margin's creatures may stand — everywhere the tree has not
  // already written. Only the book draws them, so only the book pays for
  // working it out.
  const perches = useMemo(
    () => (quill ? drolleryPerches(brackets, marginInk(brackets, dots)) : []),
    [quill, brackets, dots],
  );

  /**
   * What one bracket is written in. Normally its relationship's colour (or the
   * skin's ink); while the aim would break it, the endangered ink instead —
   * one place, so the spine, its ticks, its letters and its star all say the
   * same thing about the same bracket.
   */
  const inkOf = (b: BracketGeom, fallback: string): string =>
    doomed.has(b.bracketId) ? ENDANGERED : ink(view, b.rel ?? '', fallback);

  /** One bracket's class list — endangered, just-anchored. */
  const bracketClass = (b: BracketGeom, base: string): string => {
    const classes = [base];
    if (doomed.has(b.bracketId)) classes.push('endangered');
    if (whole.has(b.bracketId)) classes.push('anchored');
    return classes.join(' ');
  };

  /**
   * Re-key a bracket on the anchoring counter, so the same bracket anchoring
   * twice runs the emphasis twice — the dots' shake does exactly this, and for
   * the same reason: a CSS animation only restarts on a fresh element.
   */
  const bracketKey = (b: BracketGeom, prefix: string): string =>
    anchored !== null && whole.has(b.bracketId)
      ? `${prefix}${b.bracketId}!${anchored.seq}`
      : `${prefix}${b.bracketId}`;

  return (
    <svg className="bracket-layer interactive" width={width} height={height} style={{ left: 0 }}>
      {/* Referenced from themes.css by the notebook skin, and applied there to
          the DOTS alone: a ring drawn by hand is never quite a circle. The
          lines get their wobble from handLine instead — a filter thins a
          hairline where it displaces it, and the ticks came out dashed. */}
      <defs>
        {/* A burnished stud, for a skin that would rather its dots were gold
            than white (the book points --tree-dot-fill here). */}
        <radialGradient id="datool-boss" cx="35%" cy="32%" r="72%">
          <stop offset="0%" stopColor="#f4e4ad" />
          <stop offset="55%" stopColor="#c9a227" />
          <stop offset="100%" stopColor="#8a6a18" />
        </radialGradient>

        {quill && <DrolleryDefs />}

        <filter id="datool-pen" x="-5%" y="-5%" width="110%" height="110%">
          {/* One long, smooth octave. Faster noise displaces neighbouring
              pixels of a hairline by different amounts and breaks the line
              into dashes; a low frequency bends the whole stroke instead. */}
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.011"
            numOctaves="1"
            seed="5"
            result="noise"
          />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="3.4" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>

      <g className="spine-layer" pointerEvents="none">
        {brackets.map((b) => (
          <g
            key={bracketKey(b, '')}
            className={bracketClass(b, 'bracket')}
            // The core id, on the element — the dots publish theirs the same
            // way (data-dot). Nothing styles off it; it is what lets a test,
            // or a pair of eyes in the inspector, say WHICH bracket a signal
            // landed on rather than counting spines.
            data-bracket={b.bracketId}
            data-rel={b.rel ?? ''}
          >
            <Stroke
              x1={b.x}
              y1={b.top}
              x2={b.x}
              y2={b.bottom}
              width={1.8}
              color={inkOf(b, LINE)}
              hand={hand}
              name={`bracket:${b.bracketId}:spine`}
            />
            {quill && (
              <>
                <path
                  d={flourish(b.x, b.top, true)}
                  fill="none"
                  style={{ stroke: inkOf(b, LINE) }}
                  strokeWidth={1.1}
                  strokeLinecap="round"
                />
                <path
                  d={flourish(b.x, b.bottom, false)}
                  fill="none"
                  style={{ stroke: inkOf(b, LINE) }}
                  strokeWidth={1.1}
                  strokeLinecap="round"
                />
              </>
            )}
            {b.ticks.map((t) => {
              // A HANGING tick leaves the spine and stops: the relationship is
              // still here, what it held is not. While its end is carried, the
              // tick reaches all the way to the pointer instead.
              const carried =
                carriedHang !== null
                && t.hanging
                && b.bracketId === carriedHang.id
                && t.side === carriedHang.side;
              return (
                <Stroke
                  key={t.side}
                  x1={carried ? pointer!.x : t.x1}
                  y1={carried ? pointer!.y : t.y}
                  x2={t.x2}
                  y2={t.y}
                  width={1.5}
                  color={inkOf(b, LINE)}
                  hand={hand}
                  name={`bracket:${b.bracketId}:tick:${t.side}`}
                  hanging={t.hanging}
                />
              );
            })}
          </g>
        ))}
      </g>

      {/* The margin's creatures, perched where the margin is empty. Which
          bracket is offered one comes from its OWN position, not its index, so
          a bracket keeps its creature for as long as it stays put; whether the
          offer can be taken is up to the ink already on the page. Inert, like
          the spines they stand on. */}
      {quill && <DrolleryLayer perches={perches} />}

      {/* The connection in progress, drawn as the BRACKET it would become: a
          spine where the new bracket's spine will stand, with a tick out to
          the selected dot and another out to the pointer — or, once the
          pointer is ON another dot, out to THAT dot, so the shape on screen is
          the bracket the click would make. It then speaks in one of three
          voices (§5.2): trailing the pointer, offering a legal join, or
          refusing one the core will not take. Inert. */}
      {selectedDot !== undefined
        && carriedHang === null
        && (aimDot !== undefined || pointer !== null) && (
        <path
          className={
            aimDot === undefined
              ? 'rubber-band'
              : aimRefused
                ? 'rubber-band refused'
                : 'rubber-band provisional'
          }
          d={rubberBandPath(selectedDot, aimDot ?? pointer!)}
          pointerEvents="none"
        />
      )}

      <g className="dot-layer">
        {dots.map((d) => {
          // The carried end's dot travels with its line.
          if (carriedHang !== null && d.kind === 'hang' && d.id === selectedDotId) {
            d = { ...d, x: pointer!.x, y: pointer!.y };
          }
          const selected = d.id === selectedDotId;
          const shaking = shake !== null && shake.dotId === d.id;
          // Every dot renders (and behaves) identically; 'root' only marks
          // units that are currently disconnected, for styling and tests.
          const classes = ['dot-group'];
          if (d.root) classes.push('root');
          // The loose end of a hanging relationship: a handle like any other,
          // marked so it reads as an end waiting for something.
          if (d.kind === 'hang') classes.push('loose-end');
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
              // §5.2's two hover signals both start here: the span this dot
              // names, and — while another dot is armed — the preview of the
              // join it would land.
              onMouseEnter={() => onDotHover?.(d)}
              onMouseLeave={() => onDotHover?.(null)}
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
                  style={{ stroke: selected ? ACCENT : MUTED }}
                  strokeWidth={1}
                />
              )}
              <circle cx={d.x} cy={d.y} r={DOT_HIT_R} fill="transparent" />
              <circle
                className="dot"
                cx={d.x}
                cy={d.y}
                r={DOT_R}
                style={{
                  fill: selected ? DOT_SELECTED_FILL : DOT_FILL,
                  stroke: selected ? ACCENT : DOT_STROKE,
                }}
                strokeWidth={1.6}
              />
              {pen && selected && (
                <path
                  className="dot-scribble"
                  d={scribblePath(d.x, d.y, DOT_R, seedOf(d.id))}
                  fill="none"
                  style={{ stroke: ACCENT }}
                  strokeWidth={1.05}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
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
          <g key={bracketKey(b, 'labels-')} className={bracketClass(b, 'bracket-glyphs')}>
            {b.labels.map((l, i) => {
              // Each label gets its own lane, clear of the bracket's dot
              // (which sits ON the spine): end labels sit right of the spine,
              // mid labels hang left of it, and both stand ABOVE their line —
              // so a parent's tick arriving at a coordinate bracket's midpoint
              // never runs through the letters. layout.ts owns the geometry.
              const box = labelBox(b.x, l.y, l.placement);
              // The letters are centered in the box on BOTH axes, because
              // every label on the page is drawn in the SAME square: what
              // varies is the word, not the handle it is written on. The
              // 20px marks and the 13px letters each find the same middle.
              const cx = box.x + box.width / 2;
              const cy = box.y + box.height / 2;
              return (
                <g
                  key={`label-${i}`}
                  className="label-hit"
                  data-label={l.text}
                  // The bracket's own ink, for the box to deepen to on hover
                  // (styles.css) — a stroke set here instead could not be
                  // overridden by a :hover rule.
                  style={{ '--label-ink': inkOf(b, LABEL_INK) } as CSSProperties}
                  onMouseDown={swallow}
                  onClick={() =>
                    onLabelClick(b.bracketId, { x: box.x, y: box.y + box.height })
                  }
                >
                  {/* The box IS the hit target: what the reader is shown to
                      click is exactly what takes the click. Transparent fill,
                      not `none` — a `none` fill is not hit-tested. */}
                  <rect
                    className="label-box"
                    x={box.x}
                    y={box.y}
                    width={box.width}
                    height={box.height}
                    rx={LABEL_BOX_RX}
                  />
                  <text
                    className={
                      isSymbolLabel(l.text)
                        ? 'bracket-label symbol'
                        : isCompactLabel(l.text)
                          ? 'bracket-label compact'
                          : 'bracket-label'
                    }
                    x={cx}
                    y={cy + baselineDrop(l.text)}
                    style={{ fill: inkOf(b, LABEL_INK) }}
                    textAnchor="middle"
                  >
                    {labelGlyph(l.text)}
                  </text>
                </g>
              );
            })}
          </g>
        ))}
        {brackets.map((b) => (
          <g key={bracketKey(b, 'stars-')} className={bracketClass(b, 'bracket-glyphs')}>
            {b.ticks
              .filter((t) => t.star)
              .map((t) => {
                // The star sits a fixed gap after its end's BOX (or in the
                // box's place when that end shows no letters) — never out in
                // the middle of the tick. Every labelled end's star therefore
                // stands at the same distance from its spine.
                const label = b.labels.find(
                  (l) => l.placement !== 'mid' && l.y === t.y,
                );
                const cx = starCenterX(b.x, label !== undefined);
                // The star shares the box's centre line, whether or not this
                // end writes any letters — layout.ts owns both.
                const cy = starCenterY(t.y);
                return (
                  <g
                    key={`star-${t.side}`}
                    className="star-hit"
                    onMouseDown={swallow}
                    onClick={() => onStarClick(b.bracketId)}
                  >
                    <circle cx={cx} cy={cy} r={12} fill="transparent" />
                    {/* Struck with a pen in the notebook, filled in everywhere
                        else — the same star, in the hand of the page. */}
                    <path
                      className="bracket-star"
                      d={
                        pen
                          ? penStarPath(cx, cy, STAR_R)
                          : starPath(cx, cy, STAR_R)
                      }
                      style={
                        pen
                          ? {
                              fill: 'none',
                              stroke: inkOf(b, STAR_INK),
                              strokeWidth: 1.6,
                              strokeLinecap: 'round',
                              strokeLinejoin: 'round',
                            }
                          : { fill: inkOf(b, STAR_INK) }
                      }
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
