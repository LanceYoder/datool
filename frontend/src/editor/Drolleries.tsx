// Marginalia for the book skin: the small figures a manuscript puts in its
// margins, which have nothing to do with the text and sit wherever there is
// room. Here they perch on the brackets — a tree gets its drolleries as it is
// built, one arriving with roughly every third connection.
//
// Three people and a goose, which is about the right proportion for a margin.
//
// Each is drawn in a 24×24 box standing on y=24, so a perch is placed by
// putting that baseline on the line it is to stand on. They are decoration and
// nothing else: the whole layer is inert, and no gesture ever reaches them.
//
// And because they are decoration, they YIELD. A drollery is offered a perch
// only where the margin is genuinely empty — clear of every label box, every
// star and every dot, with no spine or tick struck through it (layout.ts:
// marginInk / isClearOfInk). A bracket whose corners are both busy simply goes
// without one; a bird drawn over a star is not marginalia, it is a mistake.

import type { BracketGeom, MarginInk, Rect } from './layout';
import { isClearOfInk } from './layout';

/** How many figures there are to choose between. */
export const DROLLERY_COUNT = 4;

/** The box each figure is drawn in, standing on the bottom of it. */
export const DROLLERY_W = 24;
export const DROLLERY_H = 24;

/**
 * How far a drollery's back stands off the spine it perches against. More
 * than ORNAMENT_CLEAR, so that a figure's own spine — the one line it is
 * meant to lean on — never reads as crowding it.
 */
export const DROLLERY_INSET = 6;

/** A placed figure: which one, where its 24×24 box goes, and which way it faces. */
export interface Perch {
  key: string;
  which: number;
  facingLeft: boolean;
  /** Top-left of the 24×24 box. */
  x: number;
  y: number;
}

/**
 * A stable hash of a bracket's ID into [0, 1). Used to decide which of the
 * margin's creatures a bracket gets, which way it faces, and whether it gets
 * one at all. The ID and nothing else (ruled 2026-09-17): a creature is
 * assigned when its bracket is made and stays with it however the tree moves,
 * and a deleted bracket takes its creature away — the core mints ids once and
 * never reuses them. (Seeding from the spine's position, as this once did,
 * gave a bracket a new creature every time the tree shifted under it.)
 */
function hash01(id: number, salt: number): number {
  const v = Math.sin(id * 12.9898 + salt * 37.719 + 0.5) * 43758.5453;
  return v - Math.floor(v);
}

/** The 24×24 box a figure would take, standing with its feet on `foot`. */
function boxAt(spineX: number, foot: number): Rect {
  return {
    x: spineX - DROLLERY_INSET - DROLLERY_W,
    y: foot - DROLLERY_H,
    width: DROLLERY_W,
    height: DROLLERY_H,
  };
}

/**
 * Where this tree's drolleries go.
 *
 * Roughly every third bracket is OFFERED one — placed from the bracket's own
 * position, not its index, so a bracket keeps its own creature for as long as
 * it stays put. The offer is then taken only if a perch is free: the top
 * corner first, the bottom corner second, and otherwise not at all.
 *
 * Both perches stand in the lane LEFT of the spine, which is the lane a
 * coordinate bracket writes its label in — so a bracket that has written
 * there, or whose neighbour's star reaches across, keeps its margin and loses
 * its bird. That is the right way round.
 */
export function drolleryPerches(
  brackets: readonly BracketGeom[],
  ink: MarginInk,
): Perch[] {
  const out: Perch[] = [];
  for (const b of brackets) {
    if (hash01(b.bracketId, 1) >= 0.34) continue;
    const box = [boxAt(b.x, b.top), boxAt(b.x, b.bottom)].find((candidate) =>
      isClearOfInk(candidate, ink),
    );
    if (box === undefined) continue;
    out.push({
      key: `drollery-${b.bracketId}`,
      which: Math.min(
        DROLLERY_COUNT - 1,
        Math.floor(hash01(b.bracketId, 2) * DROLLERY_COUNT),
      ),
      facingLeft: hash01(b.bracketId, 3) < 0.5,
      x: box.x,
      y: box.y,
    });
  }
  return out;
}

/**
 * The margin's creatures, drawn. Inert, like the spines they stand on.
 *
 * Mirroring about the local origin walks the box into negative x, so the
 * translate that follows puts it back in the same lane.
 */
export function DrolleryLayer({ perches }: { perches: readonly Perch[] }) {
  return (
    <g className="drollery-layer" pointerEvents="none">
      {perches.map((p) => (
        <use
          key={p.key}
          href={`#datool-drollery-${p.which}`}
          transform={
            p.facingLeft
              ? `translate(${(p.x + DROLLERY_W).toFixed(1)}, ${p.y.toFixed(1)}) scale(-1,1)`
              : `translate(${p.x.toFixed(1)}, ${p.y.toFixed(1)})`
          }
        />
      ))}
    </g>
  );
}

const CORAL = '#d98070';
const CORAL_DARK = '#ad5847';
const BLUE = '#6f93c6';
const BLUE_DARK = '#3f639a';
const GREEN = '#7fa356';
const GREEN_DARK = '#4d7132';
const GOLD = '#c9a227';
const GOLD_DARK = '#8a6a18';
const INK = '#3a2e1f';
const VELLUM = '#f3e7de';
const FEATHER = '#f4efe4';
const FEATHER_DARK = '#b09c7c';

export default function DrolleryDefs() {
  return (
    <>
      {/* 0 — a hooded drollery, blowing a horn */}
      <g id="datool-drollery-0" strokeLinejoin="round" strokeLinecap="round">
        <path d="M8,22 L8,24 M14,22 L14,24" stroke={CORAL_DARK} strokeWidth="1.2" />
        <path d="M5,23 C4.6,15.6 8,13 11,13 C14,13 17,15.6 16.6,23 Z" fill={CORAL} stroke={CORAL_DARK} strokeWidth="0.8" />
        <path d="M6,18.4 L16,18.4" stroke={GOLD} strokeWidth="1.3" />
        <path d="M6,8.6 C6,4.6 8.4,2.6 11,2.6 C13.6,2.6 16,4.6 16,8.6 C16,11.6 13.6,13.4 11,13.4 C8.4,13.4 6,11.6 6,8.6 Z" fill={BLUE} stroke={BLUE_DARK} strokeWidth="0.8" />
        <path d="M8.4,9.2 C9.6,11.6 12.4,11.6 13.6,9.2 C13.6,6.8 8.4,6.8 8.4,9.2 Z" fill={VELLUM} stroke={BLUE_DARK} strokeWidth="0.6" />
        <circle cx="10" cy="8.2" r="0.75" fill={INK} />
        <path d="M13.6,9.6 L17.4,7" stroke={CORAL_DARK} strokeWidth="1.5" />
        <path d="M16.6,8.8 L24,2.4 L23,9 Z" fill={GOLD} stroke={GOLD_DARK} strokeWidth="0.7" />
      </g>

      {/* 1 — a knight, with a sword he has no quarrel for */}
      <g id="datool-drollery-1" strokeLinejoin="round" strokeLinecap="round">
        <path d="M8.6,21 L8,24 M13.6,21 L14.2,24" stroke={CORAL_DARK} strokeWidth="1.3" />
        <path d="M17.4,10.6 L23.4,3.2" stroke="#c3cad2" strokeWidth="2" />
        <path d="M15.6,8.4 L19.6,11.6" stroke={GOLD} strokeWidth="1.6" />
        <path d="M5.6,22.6 C5.6,14.4 16.6,14.4 16.6,22.6 Z" fill={CORAL} stroke={CORAL_DARK} strokeWidth="0.8" />
        <path d="M6.4,18.6 L16,18.6" stroke={GOLD} strokeWidth="1.4" />
        <path d="M14.4,15.2 L17.8,11" stroke={CORAL_DARK} strokeWidth="1.6" />
        <circle cx="11.1" cy="7.6" r="4.1" fill={BLUE} stroke={BLUE_DARK} strokeWidth="0.9" />
        <path d="M7.4,7.4 L14.8,7.4" stroke={BLUE_DARK} strokeWidth="1.4" />
        <path d="M11.1,3.6 L11.1,11.6" stroke={BLUE_DARK} strokeWidth="1" />
        <path d="M1.6,11.4 L8.2,10.2 L8.2,17.4 C8.2,20.6 4.9,22.2 4.9,22.2 C4.9,22.2 1.6,20.6 1.6,17.4 Z" fill={BLUE} stroke={BLUE_DARK} strokeWidth="0.9" />
        <path d="M4.9,10.8 L4.9,21.2 M1.9,14.6 L7.9,13.5" stroke={GOLD} strokeWidth="1.1" />
      </g>

      {/* 2 — a monk, reading something else */}
      <g id="datool-drollery-2" strokeLinejoin="round" strokeLinecap="round">
        <path d="M4.6,23 C4.6,13.2 17.4,13.2 17.4,23 Z" fill={GREEN} stroke={GREEN_DARK} strokeWidth="0.8" />
        <path d="M6,7.8 C6,3.8 8.4,1.8 11,1.8 C13.6,1.8 16,3.8 16,7.8 C16,10.4 14.8,12.6 13.2,13.6 L8.8,13.6 C7.2,12.6 6,10.4 6,7.8 Z" fill={GREEN} stroke={GREEN_DARK} strokeWidth="0.8" />
        <ellipse cx="11" cy="8.4" rx="2.9" ry="3.3" fill={VELLUM} stroke={GREEN_DARK} strokeWidth="0.6" />
        <circle cx="10" cy="7.8" r="0.7" fill={INK} />
        <circle cx="12.4" cy="7.8" r="0.7" fill={INK} />
        <path d="M6.4,15.6 L11,14.6 L11,20.6 L6.4,21.6 Z" fill={VELLUM} stroke={CORAL_DARK} strokeWidth="0.8" />
        <path d="M15.6,15.6 L11,14.6 L11,20.6 L15.6,21.6 Z" fill={VELLUM} stroke={CORAL_DARK} strokeWidth="0.8" />
        <path d="M7.6,17.2 L9.9,16.8 M7.6,19 L9.9,18.6 M12.1,16.8 L14.4,17.2 M12.1,18.6 L14.4,19" stroke={CORAL_DARK} strokeWidth="0.5" />
      </g>

      {/* 3 — a goose, entirely unbothered */}
      <g id="datool-drollery-3" strokeLinejoin="round" strokeLinecap="round">
        <path d="M9.4,20.6 L8.4,24 M13,20.6 L13.8,24" stroke="#e2a13a" strokeWidth="1.4" />
        <path d="M13.6,15.6 C16.9,12.6 16.2,7.8 15.3,5" stroke={FEATHER_DARK} strokeWidth="6.2" fill="none" />
        <path d="M13.6,15.6 C16.9,12.6 16.2,7.8 15.3,5" stroke={FEATHER} strokeWidth="4.8" fill="none" />
        <path d="M2.8,14 L0,11.2 L2.6,17.6 Z" fill={FEATHER} stroke={FEATHER_DARK} strokeWidth="0.8" />
        <ellipse cx="9.6" cy="16.6" rx="7.4" ry="5.3" fill={FEATHER} stroke={FEATHER_DARK} strokeWidth="0.9" />
        <path d="M5.4,15 C8,13 11.4,13.4 13.2,15.8 C11,17.8 7.4,17.6 5.4,15 Z" fill="#e8dfcd" stroke={FEATHER_DARK} strokeWidth="0.7" />
        <circle cx="15.6" cy="3.7" r="2.8" fill={FEATHER} stroke={FEATHER_DARK} strokeWidth="0.9" />
        <path d="M18.1,2.7 L23.4,4 L18.1,5.3 Z" fill="#e2a13a" stroke="#a9761d" strokeWidth="0.6" />
        <circle cx="16.4" cy="3" r="0.75" fill={INK} />
      </g>
    </>
  );
}
