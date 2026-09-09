// Pure helpers for the editor's interaction layer. No DOM, no editor instance —
// everything here is a plain function over data, so it is unit-testable and the
// React layer stays thin.
//
// The editor CORE (commands.ts, layout.ts) is untouched by this module: these
// are only the small lookups the UI needs on top of it — grouping the taxonomy
// for the relationship menu, reading a dot id back apart, and keeping a
// popover on screen.

import type { CorpusWord, TaxonomyEntry } from '../types';
import type { Forest, Side, Unit, UnitAddr } from '../tree/core';
import { bracketById, findUnit, hangsAt, leafOrder, leavesOf, spanOf } from '../tree/core';

/** Display names for the taxonomy's four families. */
export const FAMILY_NAMES: Record<string, string> = {
  coordinate: 'Coordinate',
  restatement: 'Restatement',
  distinct: 'Distinct statement',
  contrary: 'Contrary statement',
};

export interface RelationshipGroup {
  family: string;
  /** Display name (FAMILY_NAMES, falling back to the raw family key). */
  name: string;
  entries: TaxonomyEntry[];
}

/**
 * The taxonomy grouped by family, families in first-appearance order and
 * entries in taxonomy order — the order the relationship menu lists them in.
 */
export function groupByFamily(taxonomy: readonly TaxonomyEntry[]): RelationshipGroup[] {
  const order: string[] = [];
  const byFamily = new Map<string, TaxonomyEntry[]>();
  for (const entry of taxonomy) {
    const existing = byFamily.get(entry.family);
    if (existing === undefined) {
      byFamily.set(entry.family, [entry]);
      order.push(entry.family);
    } else {
      existing.push(entry);
    }
  }
  return order.map((family) => ({
    family,
    name: FAMILY_NAMES[family] ?? family,
    entries: byFamily.get(family) ?? [],
  }));
}

/**
 * Keyboard shortcut per relationship code — what the menu shows in parentheses
 * and what typing that key picks while the menu is open.
 *
 * Mnemonics follow the relationship's own name or SYMBOL — the symbol wins
 * where it is the more familiar handle ('/' Comparison for //, '?'
 * Conditional for C?/E), the name elsewhere (c Cause–Effect, g Ground,
 * i Inference, m Means–End, t Temporal, l Locative …). Where two names
 * competed for a letter the more common relationship kept it and the other
 * took its next distinctive letter (v adVersative, r situation–Response).
 * General–Specific is the one arbitrary key ('x'): every letter in its name
 * was already taken.
 */
export const RELATIONSHIP_KEYS: Record<string, string> = {
  Ser: 's',
  Prog: 'p',
  Alt: 'a',
  WEd: 'w',
  Cmp: '/',
  NegPos: 'n',
  GnSp: 'x',
  FtIn: 'f',
  Grnd: 'g',
  Inf: 'i',
  CE: 'c',
  CndE: '?',
  MEd: 'm',
  Tmp: 't',
  Loc: 'l',
  Adv: 'v',
  QA: 'q',
  SR: 'r',
};

/** The shortcut key for a relationship code, or null when it has none. */
export function shortcutFor(code: string): string | null {
  return RELATIONSHIP_KEYS[code] ?? null;
}

/**
 * The relationship a typed key selects, or null. Only codes actually present
 * in `taxonomy` can be picked, so a key for a retired relationship is inert.
 */
export function relationshipForKey(
  key: string,
  taxonomy: readonly TaxonomyEntry[],
): string | null {
  const wanted = key.toLowerCase();
  for (const entry of taxonomy) {
    if (RELATIONSHIP_KEYS[entry.code] === wanted) return entry.code;
  }
  return null;
}

/**
 * What a DotGeom id points at — the dot grammar of §7.3, extended by §10 A4: a
 * 'hang' ref names the BRACKET whose side hangs AND WHICH SIDE, because a
 * bracket may now hang at both ends and draw two pickup dots.
 *
 * A hang ref is not a unit — but it IS a connect endpoint (§10 A2): connecting
 * it with its room's sole lodger settles that side and finishes the bracket.
 */
export type DotRef =
  | { kind: 'prop'; pid: string }
  | { kind: 'bracket'; id: number }
  | { kind: 'hang'; id: number; side: Side };

/**
 * Read a dot id back apart: 'prop:<pid>' | 'bracket:<id>' | 'hang:<id>:<side>'.
 * A bare 'hang:<id>' is still accepted (it is what the pre-A4 layout wrote);
 * it names the left side, and callers that care resolve the real one off the
 * forest.
 */
export function parseDotId(id: string): DotRef | null {
  if (id.startsWith('prop:')) {
    const pid = id.slice('prop:'.length);
    return pid === '' ? null : { kind: 'prop', pid };
  }
  if (id.startsWith('hang:')) {
    const [raw, side] = id.slice('hang:'.length).split(':');
    const value = Number(raw);
    if (raw === undefined || raw === '' || !Number.isInteger(value) || value < 0) return null;
    if (side !== undefined && side !== 'left' && side !== 'right') return null;
    return { kind: 'hang', id: value, side: side ?? 'left' };
  }
  if (id.startsWith('bracket:')) {
    const raw = id.slice('bracket:'.length);
    const value = Number(raw);
    if (raw === '' || !Number.isInteger(value) || value < 0) return null;
    return { kind: 'bracket', id: value };
  }
  return null;
}

/**
 * The core address a dot names, for the ops that take one (§5.1's connect,
 * §5.3's delete). A room's pickup dot has none: it names a side being
 * assembled, and the ops address units. (Its own gesture, §10 A2's settle,
 * addresses the bracket and the side instead.)
 */
export function dotAddr(ref: DotRef): UnitAddr | null {
  if (ref.kind === 'prop') return { kind: 'leaf', pid: ref.pid };
  if (ref.kind === 'bracket') return { kind: 'bracket', id: ref.id };
  return null;
}

/**
 * What a pairing that involves a room's PICKUP DOT does (§10 A2) — decided
 * here, as data, so the rule is testable without a mounted editor.
 *
 *   - 'none'   — no pickup dot in the pair; the caller connects as usual.
 *   - 'settle' — the other dot names the room's SOLE lodger: that side is
 *                finished, in one undo step, with no new bracket and no menu.
 *   - 'refuse' — any other pairing with a pickup dot (a room still holding a
 *                group, some other unit, two pickup dots).
 *
 * `keepArmed` is the part §10 A6 rules on: A REFUSED GESTURE SHAKES AND THAT IS
 * ALL. Dropping the carried dot as well would be a second effect, and would
 * make aiming a pickup dot at the wrong lodger cost the pickup too — so a
 * refusal keeps the armed dot, exactly as a refused connect does.
 *
 * `lodger` is the room's sole lodger as the CORE reports it (`settleTargetFor`,
 * via `commands.ts`'s `settleLodger`), or null when that side is not settleable
 * at all.
 */
export type PickupGesture =
  | { kind: 'none' }
  | { kind: 'refuse'; keepArmed: true }
  | { kind: 'settle'; id: number; side: Side; keepArmed: false };

export function pickupGesture(
  armed: DotRef,
  target: DotRef,
  lodger: Unit | null,
): PickupGesture {
  const hang = armed.kind === 'hang' ? armed : target.kind === 'hang' ? target : null;
  if (hang === null) return { kind: 'none' };
  const other = hang === armed ? target : armed;
  const addr = other.kind === 'hang' ? null : dotAddr(other);
  const namesLodger =
    lodger !== null
    && addr !== null
    && (addr.kind === 'leaf'
      ? lodger.kind === 'leaf' && lodger.pid === addr.pid
      : lodger.kind === 'bracket' && lodger.id === addr.id);
  if (!namesLodger) return { kind: 'refuse', keepArmed: true };
  return { kind: 'settle', id: hang.id, side: hang.side, keepArmed: false };
}

/**
 * The propositions a dot's unit COVERS — §5.2's first signal: "hover a dot →
 * its unit's full span highlights", so what a dot means is answered before it
 * is armed. Q5 made every dot name exactly its own unit and abolished lifting,
 * which is only legible if the span is visible.
 *
 * Derived from the core's own `spanOf` and leaf order (§7.1's query surface),
 * so the highlight can never disagree with what a click would then take. A
 * room's pickup dot names no unit; it answers with its LODGERS' pids, because
 * the group being assembled is exactly what that handle is about.
 *
 * Empty for a dot whose unit is no longer in the forest — the caller then
 * highlights nothing rather than guessing.
 */
export function dotSpanPids(forest: Forest, ref: DotRef): string[] {
  if (ref.kind === 'hang') {
    const bracket = bracketById(forest, ref.id);
    if (bracket === null || !hangsAt(bracket, ref.side)) return [];
    return bracket[ref.side].flatMap((u) => leavesOf(u));
  }
  const addr = dotAddr(ref);
  if (addr === null || findUnit(forest, addr) === null) return [];
  const span = spanOf(forest, addr);
  return leafOrder(forest).slice(span.start, span.end);
}

/**
 * The brackets a gesture made WHOLE — §5.2's third signal: "completion is an
 * event, not an absence".
 *
 * Under §10 A1 nothing completes ITSELF any more, so in practice this fires on
 * exactly one gesture: the pickup dot's settle (A2), and the undo/redo that
 * moves across it. It stays a DIFF rather than a flag because that is what
 * makes undo emphasize the same bracket the gesture did.
 *
 * IDENTITY is the whole test, and it is sound because ids are stable across
 * ops and never reused (§7.3): a bracket still here under the same id is the
 * same relationship, one that broke is simply absent, and a fresh join has an
 * id `before` never saw.
 */
export function newlyAnchored(before: Forest, after: Forest): number[] {
  const hanging = new Set<number>();
  const mark = (u: Unit): void => {
    if (u.kind === 'leaf') return;
    if (u.leftHanging || u.rightHanging) hanging.add(u.id);
    for (const child of u.left) mark(child);
    for (const child of u.right) mark(child);
  };
  for (const root of before.roots) mark(root);
  if (hanging.size === 0) return [];

  const out: number[] = [];
  const check = (u: Unit): void => {
    if (u.kind === 'leaf') return;
    if (hanging.has(u.id) && !u.leftHanging && !u.rightHanging) out.push(u.id);
    for (const child of u.left) check(child);
    for (const child of u.right) check(child);
  };
  for (const root of after.roots) check(root);
  return out;
}

/**
 * The pids of the analysis's MAIN POINT — where the star walk from the top of
 * the tree lands — but only when the analysis is COMPLETE: exactly one forest
 * root, and that root a bracket (every proposition connected into one tree).
 * Otherwise empty.
 *
 * The walk follows the STARRED side through subordinate brackets and fans out
 * across a coordinate bracket's whole packet — Progression included (the Mark
 * 4:10–12 diagram highlights BOTH members of its final P). Mirrors the
 * server's main_point.
 */
export function mainPointRefs(forest: Forest): string[] {
  const root = forest.roots.length === 1 ? forest.roots[0] : undefined;
  if (root === undefined || root.kind !== 'bracket') return [];
  // A HANGING SIDE means an edit is half-made (§7.11: what used to be "while
  // any hole exists"): what the tree supports is not decided yet, so nothing
  // is the main point, and the server's main_point agrees.
  const hangs = (u: Unit): boolean =>
    u.kind === 'bracket'
    && (u.leftHanging || u.rightHanging || [...u.left, ...u.right].some(hangs));
  if (hangs(root)) return [];
  const out: string[] = [];
  const walk = (u: Unit): void => {
    if (u.kind === 'leaf') {
      out.push(u.pid);
      return;
    }
    if (u.star === 'left') walk(u.left[0]!);
    else if (u.star === 'right') walk(u.right[0]!);
    else for (const child of [...u.left, ...u.right]) walk(child); // coordinate
  };
  walk(root);
  return out;
}

/** One English rendering, and the corpus word it renders. */
export interface EnglishToken {
  text: string;
  /** Corpus index of the Greek word this renders — its card opens from here. */
  index: number;
}

/** One run of a row's English line: an optional verse marker, then words. */
export interface EnglishSegment {
  /** Verse number shown before the text — only where a verse BEGINS. */
  marker: number | null;
  tokens: EnglishToken[];
}

/**
 * The English reference line for one proposition, built from ITS OWN words'
 * contextual renderings (BSB `eng`), so the line matches the proposition
 * exactly however the verses were divided. Within each verse the words are
 * read in the BSB's OWN English word order (`engOrd`), so the line is the
 * BSB phrase for those words, not an interlinear in Greek order. A
 * verse-number marker opens a segment only where that verse's FIRST word
 * sits in this row — a row continuing mid-verse gets bare text. Words
 * without an aligned rendering are skipped; a row with none yields [].
 *
 * Each rendering keeps the index of the word it renders, so clicking an
 * English word can open that Greek word's card.
 */
export function rowEnglish(
  srcStart: number,
  srcEnd: number,
  words: ReadonlyMap<number, CorpusWord>,
): EnglishSegment[] {
  const out: EnglishSegment[] = [];
  let current:
    | { marker: number | null; parts: { ord: number; text: string; index: number }[] }
    | null = null;

  const flush = (): void => {
    if (current !== null && current.parts.length > 0) {
      const tokens = current.parts
        .slice()
        .sort((a, b) => a.ord - b.ord)
        .map((p) => ({ text: p.text, index: p.index }));
      out.push({ marker: current.marker, tokens });
    }
  };

  for (let i = srcStart; i <= srcEnd; i += 1) {
    const w = words.get(i);
    if (w === undefined) continue;
    const prev = words.get(i - 1);
    const verseInitial =
      prev === undefined ||
      prev.book !== w.book ||
      prev.chapter !== w.chapter ||
      prev.verse !== w.verse;
    if (current === null) {
      current = { marker: verseInitial ? w.verse : null, parts: [] };
    } else if (verseInitial) {
      flush();
      current = { marker: w.verse, parts: [] };
    }
    if (w.eng !== null && w.eng !== '') {
      // Unaligned words have no order key; Greek position keeps them from
      // being dropped and can only misplace them within their own verse.
      current.parts.push({ ord: w.engOrd ?? i, text: w.eng, index: i });
    }
  }
  flush();
  return out;
}

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/**
 * Keep a popover inside its container: the desired top-left is clamped so the
 * whole box (plus `margin`) fits in `bounds`, never going past the top-left
 * corner even when the box is bigger than the container.
 */
export function clampPopover(
  desired: Point,
  size: Size,
  bounds: Size,
  margin = 4,
): Point {
  const maxX = Math.max(margin, bounds.width - size.width - margin);
  const maxY = Math.max(margin, bounds.height - size.height - margin);
  return {
    x: Math.max(margin, Math.min(desired.x, maxX)),
    y: Math.max(margin, Math.min(desired.y, maxY)),
  };
}

/**
 * Whether a word offers "Split after": every word but the last one (there is
 * nothing to split off after the last). `firstCount` for splitProposition is
 * then `ordinal + 1`.
 */
export function canSplitAfter(ordinal: number, wordCount: number): boolean {
  return Number.isInteger(ordinal) && ordinal >= 0 && ordinal < wordCount - 1;
}
