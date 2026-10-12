// The glide: after a delete, the tree's lines travel to where they now belong
// instead of jumping there, so the reader can see where each one went.
//
// It animates the overlay's GEOMETRY, not the SVG: every bracket and dot is
// matched to its old self by its stable id, and each number in it eases from
// the old value to the new. Whatever is new simply appears; whatever is gone
// (the deleted bracket) is gone at once.

import { useLayoutEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { BracketGeom, DotGeom } from './layout';

export const GLIDE_MS = 1000;

/** Keys that are identity or structure, never geometry: taken from the new
 *  value as they are. */
const FIXED = new Set([
  'bracket', 'bracketId', 'preorderIndex', 'rootIndex', 'root', 'column',
  'rel', 'starSide', 'id', 'kind', 'ref', 'side', 'text', 'placement',
  'star', 'hanging',
]);

/** `from` eased toward `to` by `t` (0..1): numbers interpolate, arrays of the
 *  same length and plain objects interpolate member by member, and anything
 *  else is `to`'s. */
export function lerpGeom<T>(from: T, to: T, t: number): T {
  if (typeof to === 'number' && typeof from === 'number') {
    return (from + (to - from) * t) as T;
  }
  if (Array.isArray(to)) {
    if (!Array.isArray(from) || from.length !== to.length) return to;
    return to.map((v, i) => lerpGeom(from[i], v, t)) as T;
  }
  if (to !== null && typeof to === 'object' && from !== null && typeof from === 'object') {
    const out: Record<string, unknown> = { ...(to as Record<string, unknown>) };
    const old = from as Record<string, unknown>;
    for (const key of Object.keys(out)) {
      if (!FIXED.has(key) && key in old) out[key] = lerpGeom(old[key], out[key], t);
    }
    return out as T;
  }
  return to;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

interface Drawn {
  brackets: BracketGeom[];
  dots: DotGeom[];
}

/** One frame of the glide from `from` to `to`. */
export function glideFrame<T extends Drawn>(from: Drawn, to: T, t: number): T {
  const e = ease(Math.min(1, Math.max(0, t)));
  const oldBrackets = new Map(from.brackets.map((b) => [b.bracketId, b]));
  const oldDots = new Map(from.dots.map((d) => [d.id, d]));
  return {
    ...to,
    brackets: to.brackets.map((b) => {
      const a = oldBrackets.get(b.bracketId);
      return a === undefined ? b : lerpGeom(a, b, e);
    }),
    dots: to.dots.map((d) => {
      const a = oldDots.get(d.id);
      return a === undefined ? d : lerpGeom(a, d, e);
    }),
  };
}

/**
 * What to draw: `target`, except that when `armed` is set as `target`
 * changes, the change glides in over GLIDE_MS from what was on screen.
 * `armed` is spent by the change it animates. A target that keeps updating
 * mid-glide (the overlay re-measures) is followed: every frame aims at the
 * latest one.
 */
export function useGlide<T extends Drawn>(
  target: T | null,
  armed: MutableRefObject<boolean>,
): T | null {
  const [frame, setFrame] = useState<T | null>(null);
  const shownRef = useRef<T | null>(null);
  const targetRef = useRef<T | null>(target);
  const rafRef = useRef(0);
  const prevTarget = useRef<T | null>(target);
  targetRef.current = target;

  useLayoutEffect(() => {
    if (prevTarget.current === target) return;
    const from = shownRef.current;
    prevTarget.current = target;
    if (!armed.current || from === null || target === null) return;
    armed.current = false;
    window.cancelAnimationFrame(rafRef.current);
    const start = performance.now();
    const step = (now: number) => {
      const to = targetRef.current;
      const t = (now - start) / GLIDE_MS;
      if (to === null || t >= 1) {
        setFrame(null);
        return;
      }
      setFrame(glideFrame(from, to, t));
      rafRef.current = window.requestAnimationFrame(step);
    };
    setFrame(glideFrame(from, target, 0));
    rafRef.current = window.requestAnimationFrame(step);
  }, [target, armed]);

  useLayoutEffect(() => () => window.cancelAnimationFrame(rafRef.current), []);

  const shown = target === null ? null : (frame ?? target);
  // What was on screen — recorded AFTER the effect above has read it, so a
  // glide starts from the previous frame, not from the new target.
  useLayoutEffect(() => {
    shownRef.current = shown;
  });
  return shown;
}
