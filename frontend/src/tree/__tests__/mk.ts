/**
 * Test-only builders: the spec's notation, spelled as data. `br('Ser', a, b)`
 * is a settled/settled bracket; an ARRAY on either side is that side's ROOM —
 * `⟨a b⟩` of §1, and `[x]` is the one-lodger room `⟨x⟩` that §10 A1 made an
 * ordinary state. So the array brackets in a fixture are the ⟨…⟩ of the spec,
 * one for one, and hanging is written down rather than counted.
 */

import type { Bracket, Forest, Leaf, Star, Unit } from '../core';
import { leaf, leavesOf, loadForest } from '../core';

let seq = 1;

/** Ids are minted per builder call; reset per test so failures read simply. */
export function resetIds(from = 1): void {
  seq = from;
}

export function br(
  rel: string | null,
  left: Unit | Unit[],
  right: Unit | Unit[],
  star: Star | null = null,
): Bracket {
  const id = seq;
  seq += 1;
  return {
    kind: 'bracket',
    id,
    rel,
    star,
    leftHanging: Array.isArray(left),
    rightHanging: Array.isArray(right),
    left: Array.isArray(left) ? left : [left],
    right: Array.isArray(right) ? right : [right],
  };
}

export function L(pid: string): Leaf {
  return leaf(pid);
}

/** Several leaves at once, in reading order. */
export function Ls(...pids: string[]): Leaf[] {
  return pids.map(leaf);
}

/** A freshly built forest — no id has been retired, so `loadForest` is safe. */
export function forestOf(...roots: Unit[]): Forest {
  return loadForest(roots);
}

/** The bracket whose leaves are exactly these pids — how tests name brackets. */
export function bracketOver(f: Forest, pids: string[]): Bracket {
  const want = pids.join(' ');
  let found: Bracket | null = null;
  const walk = (u: Unit): void => {
    if (u.kind === 'leaf') return;
    if (leavesOf(u).join(' ') === want) found = u;
    u.left.forEach(walk);
    u.right.forEach(walk);
  };
  f.roots.forEach(walk);
  if (found === null) throw new Error(`no bracket over ${want}`);
  return found;
}

export function idOver(f: Forest, pids: string[]): number {
  return bracketOver(f, pids).id;
}

/**
 * Deep-freeze a forest: every unit, every side, the roots array, the forest.
 *
 * The core's central promise is that inputs are never mutated — untouched units
 * are SHARED between the input and the output forest, so an in-place write would
 * corrupt every snapshot holding them, including the pre-op state §7.2's atomic
 * undo restores, and including the state a refusal is supposed to leave
 * byte-identical (§5). Test modules are ES modules and therefore strict mode, so
 * a write through a frozen object THROWS. Driving the ops over frozen forests
 * turns that promise from an assertion into a proof: any in-place write, on the
 * refusal path or the success path, is a TypeError at the write site.
 */
export function freeze(f: Forest): Forest {
  const unit = (u: Unit): void => {
    if (u.kind === 'bracket') {
      Object.freeze(u.left);
      Object.freeze(u.right);
      u.left.forEach(unit);
      u.right.forEach(unit);
    }
    Object.freeze(u);
  };
  f.roots.forEach(unit);
  Object.freeze(f.roots);
  return Object.freeze(f);
}

/** Address helpers, so tests read as the dot grammar does (§7.3). */
export const P = (pid: string) => ({ kind: 'leaf', pid }) as const;
export const B = (id: number) => ({ kind: 'bracket', id }) as const;
