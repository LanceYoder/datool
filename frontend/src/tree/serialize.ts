/**
 * The WIRE ADAPTER — the only place the pure core (`./core`) and the stored
 * schemaVersion-2 document meet (spec §7.4).
 *
 * ─── Where this stands in the load pipeline (spec §7.5) ────────────────────
 *
 *     normalizeDocument  →  normalizeHoles  →  fromWire  →  assertInvariants
 *          (v1→v2)          (rooms settled)    (strict)      (I1–I7)
 *                                    ↓ any failure
 *                          withoutConnections + console warning
 *
 * `fromWire` composes AFTER `editor/convert.ts`'s tolerant loader and never
 * repeats its work. That division is deliberate:
 *
 *   - `normalizeDocument` owns the v1 `tree` → v2 `forest` conversion and the
 *     degenerate "no forest at all" case. A v1 document reaching `fromWire`
 *     directly is a caller bug, not a shape this module tolerates.
 *   - `normalizeHoles` owns the two placements a hole cannot have — a hole
 *     inside a hole flattens, a hole at the floor opens to roots. It NO LONGER
 *     settles anything (§10 A1, A4): a one-child hole is a one-lodger room and
 *     stays one, and a bracket with a hole at each end is a legal
 *     work-in-progress and stays one.
 *   - `fromWire` owns the MODEL: strictly binary brackets (ruling Q2), holes
 *     only where a side may hang, and I1–I7 afterwards. It settles nothing.
 *     It refuses — typed, never thrown — and the caller falls back to
 *     `withoutConnections` (propositions only) with a warning. The "I7"
 *     there is the whole of it only when a caller HANDS IT A TAXONOMY: the
 *     coordinate half of I7 is taxonomy knowledge the core does not hold, so
 *     without one the structural invariants bite and that half does not.
 *
 * So an illegal shape here means one of two things: the document predates the
 * model (an n-ary bracket — deletable per Q2), or the tolerant loader was
 * skipped. Both are worth a refusal a human can read, and neither is worth a
 * binarizer: "no code paths for situations impossible going forward" (Q2).
 *
 * ─── The wire attributes, matched against the server ──────────────────────
 *
 * `da/documents.py` (`_walk_tree`) is the authority; these are its rules:
 *
 *   - `kind` is 'prop' | 'bracket' | 'hole'; a prop carries `ref`.
 *   - `rel` is a taxonomy code, and one the taxonomy actually carries. A
 *     bracket with neither cannot be stored; see the two write paths below.
 *   - `prominent` is a CHILD INDEX (0 or 1 now that brackets are binary), and
 *     is null exactly for coordinate relationships. It is the wire's spelling
 *     of the core's `star`: 'left' → 0, 'right' → 1, null → null.
 *   - `reversed` is optional and boolean, and DERIVED (§1's follow-on ruling):
 *     written only when true, exactly as `convert.ts` normalizes it and
 *     exactly where the stored fixtures carry it — `prominent !== starredLabel`
 *     on a binary subordinate bracket, which is `reversedOf` on this side.
 *   - `flag` is optional and only ever 'review' (amber: "come back to this").
 *     §7.4 item 4 rules that flag normalization is KEPT across the adapter, so
 *     it is read into the core's `Bracket` and written back out — presentation
 *     riding along with rel/star, not structure the ops reason about.
 *
 * Ids are minted by the core and STRIPPED from the wire (§7.3): the document
 * carries structure, not the session's identities.
 *
 * ─── Two write paths, because §7.4 gives the snapshot two jobs ─────────────
 *
 * §7.4 item 4 takes ONE wire snapshot per docTick and hands it to onChange,
 * `mainPids` and the overlay (item 11). Under §10 A5 — which REVERSES Q6 —
 * every connect mints `rel: 'Ser'` and the menu opens preloaded on it, so there
 * is no unlabeled state left for a docTick to catch mid-gesture: the ordinary
 * tick is always storable.
 *
 * What remains unstorable is a DATA mismatch: a bracket whose `rel` the
 * supplied taxonomy does not carry. The derived `reversed` is then not
 * computable, so no faithful document can be written — and that can arrive from
 * a loaded document or a taxonomy that changed underfoot, at any tick.
 *
 * So the two jobs still get two entry points over one walk:
 *
 *   - `toWire` — the SAVE path. Throws rather than write a bracket it cannot
 *     spell (unknown rel — or, defensively, a null rel, which A5 leaves
 *     unreachable from the UI but the type still permits).
 *   - `tryToWire` — the per-docTick SNAPSHOT path. Same bytes when the state
 *     is storable; a typed `WireWriteProblem` when it is not, so a caller
 *     holds its last good snapshot instead of crashing the tick.
 *
 * Neither invents a wire spelling for a bracket it cannot name. There is none:
 * a hole cannot stand at the floor or inside another hole, and spilling the two
 * sides can leave the bracket above hanging at both ends.
 */

import type { BracketNode, TreeNode } from '../types';
import type { Bracket, Forest, TaxonomyFacts, Unit } from './core';
import { assertInvariants, leafOrder, leavesOf, loadForest, reversedOf } from './core';

// ---------------------------------------------------------------------------
// Reading: wire → core

/** Why a document could not be read as a forest. Each is a fallback trigger. */
export type WireProblemCode =
  /** A bracket with other than exactly two children (ruling Q2). */
  | 'n-ary'
  /** A hole standing as a forest root — a root is unattached already. */
  | 'root-hole'
  /** A hole inside a hole — what waits, waits together. */
  | 'nested-hole'
  /** A hole holding NOTHING — a side is never empty (I2). A hole of one is a
   *  one-lodger room and reads fine (§10 A1). */
  | 'thin-hole'
  /** A node the schema does not describe: bad kind, missing ref or rel. */
  | 'bad-node'
  /** A rel the supplied taxonomy does not carry (checked only when one is). */
  | 'unknown-rel'
  /** I7's coordinate half: `star` null iff coordinate (taxonomy-only, too). */
  | 'incoherent-star'
  /** No roots at all. */
  | 'empty-forest'
  /**
   * The shape parsed, but `assertInvariants` (or the document's leaf order)
   * says no — I1–I6 and the taxonomy-free half of I7. The coordinate half of
   * I7 is `incoherent-star` above, and only when a taxonomy was supplied.
   */
  | 'invariant';

export type WireProblem = { code: WireProblemCode; message: string };

/**
 * What the adapter needs to know about a relationship — the taxonomy's own
 * shape (`TaxonomyEntry` of `../types` satisfies it), narrowed to the facts
 * both directions turn on: whether the star may exist at all (I7), and which
 * end it sits on by default (from which `reversed` is derived).
 */
export type TaxonomyLike = {
  code: string;
  coordinate: boolean;
  starredLabel: number | null;
};

/** Typed, never thrown: the caller warns and opens propositions-only (§7.5). */
export type WireLoad = { ok: true; forest: Forest } | { ok: false; reason: WireProblem };

/** Internal control flow only; every escape is caught at `fromWire`'s edge. */
class WireError extends Error {
  constructor(readonly problem: WireProblem) {
    super(problem.message);
  }
}

function fail(code: WireProblemCode, message: string): never {
  throw new WireError({ code, message });
}

/**
 * Read a v2 document's `forest` as a core Forest — STRICT (spec §7.5, Q2).
 *
 * The mapping (§1, §7.4):
 *
 *     prop                 →  a leaf
 *     bracket [x, y]       →  left = side(x), right = side(y)
 *     hole as a side       →  a HANGING side: its children, in order, at any
 *                             count (one child = a one-lodger room, §10 A1)
 *
 * A bracket's two children are read as its two SIDES, not as two units: a
 * hole child contributes its own children as the side's lodger list, which is
 * how the stored waiting room becomes the model's hanging side, and TWO holes
 * on one bracket are legal (§10 A4). Anything else — an n-ary bracket, a hole
 * at the floor or inside another hole, an empty hole — is refused rather than
 * repaired.
 *
 * `propositionOrder` is the document's proposition ids in list order. Given,
 * it is what I4/I6 are measured against (so a forest that drops, duplicates or
 * reorders a proposition refuses here rather than surfacing later); omitted,
 * the forest's own leaf order is used and only the structural invariants bite.
 *
 * `taxonomy`, given, closes the gap §7.5's "assert I1–I7" leaves open. The
 * core knows no taxonomy (see `assertInvariants`), so the coordinate half of
 * I7 — `star` null iff coordinate — and "is this rel a rel at all" can only be
 * checked at an edge that holds one. With it, this loader makes the three
 * checks `da/documents.py`'s `_walk_tree` makes, and the refusal lands where
 * §7.5 designed for it: at LOAD, where the analyst gets `withoutConnections`
 * and a warning, rather than at save as an opaque server 400 on a document
 * they have already been editing. Without it, today's structural-only
 * behaviour stands, and a document whose taxonomy has since shifted under it
 * loads and writes back unchanged.
 */
export function fromWire(
  forest: readonly TreeNode[],
  propositionOrder?: readonly string[],
  taxonomy?: readonly TaxonomyLike[],
): WireLoad {
  try {
    if (!Array.isArray(forest) || forest.length === 0) {
      fail('empty-forest', 'the forest has no roots');
    }
    const known =
      taxonomy === undefined
        ? null
        : new Map(taxonomy.map((entry) => [entry.code, entry.coordinate]));
    let nextId = 1;

    /** One unit. `holder` is what the node hangs from, as in `_walk_tree`. */
    const unit = (node: TreeNode, holder: 'root' | 'bracket' | 'hole'): Unit => {
      if (node === null || typeof node !== 'object') {
        fail('bad-node', `a ${holder} node is not an object`);
      }
      if (node.kind === 'prop') {
        if (typeof node.ref !== 'string' || node.ref === '') {
          fail('bad-node', 'a prop node has no proposition id');
        }
        return { kind: 'leaf', pid: node.ref };
      }
      if (node.kind === 'hole') {
        if (holder === 'root') {
          fail('root-hole', 'a hole cannot be a forest root: roots are unattached');
        }
        fail('nested-hole', 'a hole cannot hold another hole: what waits, waits together');
      }
      if (node.kind !== 'bracket') {
        fail('bad-node', `unknown node kind '${String((node as { kind?: unknown }).kind)}'`);
      }
      const children = node.children;
      if (!Array.isArray(children) || children.length !== 2) {
        // Ruling Q2: no binarization, ever. The document is deletable.
        fail(
          'n-ary',
          `bracket '${String(node.rel)}' is not binary: ${
            Array.isArray(children) ? children.length : 0
          } children (the model relates exactly two sides)`,
        );
      }
      if (typeof node.rel !== 'string' || node.rel === '') {
        fail('bad-node', 'a bracket has no relationship');
      }
      const star = starOf(node);
      if (known !== null) {
        const coordinate = known.get(node.rel);
        if (coordinate === undefined) {
          fail('unknown-rel', `rel '${node.rel}' is not a known relationship`);
        }
        // The two halves of `_walk_tree`'s prominence rule, which is I7.
        if (coordinate && star !== null) {
          fail('incoherent-star', `prominent must be null for coordinate ${node.rel}`);
        }
        if (!coordinate && star === null) {
          fail('incoherent-star', `prominent must be a valid child index for ${node.rel}`);
        }
      }
      const id = nextId;
      nextId += 1;
      const left = side(children[0]);
      const right = side(children[1]);
      return {
        kind: 'bracket',
        id,
        rel: node.rel,
        star,
        ...(flagOf(node) === undefined ? {} : { flag: 'review' as const }),
        leftHanging: left.hanging,
        rightHanging: right.hanging,
        left: left.units,
        right: right.units,
      };
    };

    /**
     * One SIDE of a bracket: a hole is the side's lodgers — AT ANY COUNT (§10
     * A1: a one-lodger room is an ordinary state, and the wire spells it as a
     * one-child hole) — anything else is the side's committed unit.
     */
    const side = (node: TreeNode): { units: Unit[]; hanging: boolean } => {
      if (node !== null && typeof node === 'object' && node.kind === 'hole') {
        const waiting = node.children;
        if (!Array.isArray(waiting) || waiting.length < 1) {
          fail('thin-hole', 'a hole holds no units; a side is never empty (I2)');
        }
        return { units: waiting.map((child) => unit(child, 'hole')), hanging: true };
      }
      return { units: [unit(node, 'bracket')], hanging: false };
    };

    // `loadForest` mints from the ids present — safe here and only here: a
    // fresh load has retired no id (§7.3).
    const out = loadForest(forest.map((root) => unit(root, 'root')));
    try {
      assertInvariants(out, [...(propositionOrder ?? leafOrder(out))]);
    } catch (err) {
      fail('invariant', err instanceof Error ? err.message : String(err));
    }
    return { ok: true, forest: out };
  } catch (err) {
    if (err instanceof WireError) return { ok: false, reason: err.problem };
    throw err;
  }
}

/**
 * The stored review mark, normalized the way `convert.ts` normalizes it: only
 * ever 'review', and only when it is there. The server's rule is the same one
 * (`flag must be 'review' or absent`), so anything else is a refusal, not a
 * value to guess at.
 */
function flagOf(node: BracketNode): 'review' | undefined {
  // `unknown`, not the declared `'review' | undefined`: this is the boundary
  // where a stored document's word is taken, and the declaration is the claim
  // being checked, not a fact to lean on.
  const flag: unknown = node.flag;
  if (flag === undefined || flag === null) return undefined;
  if (flag === 'review') return 'review';
  return fail('bad-node', `bracket '${node.rel}' has flag '${String(flag)}'; only 'review' exists`);
}

/** The wire's child index as the core's star (null iff coordinate, I7). */
function starOf(node: BracketNode): 'left' | 'right' | null {
  const prominent = node.prominent;
  if (prominent === null || prominent === undefined) return null;
  if (prominent === 0) return 'left';
  if (prominent === 1) return 'right';
  return fail(
    'bad-node',
    `bracket '${node.rel}' has prominent ${String(prominent)}, which is not a child index`,
  );
}

// ---------------------------------------------------------------------------
// Writing: core → wire

/** Why a forest could not be written as a document. Both are UNSTORABLE
 *  brackets — states the core holds legally and the wire cannot spell. */
export type WireWriteProblemCode =
  /** `rel` is null. Not reachable from the UI any more — §10 A5 mints Ser on
   *  every connect — but the type permits it, so the write path names it. */
  | 'unlabeled'
  /** `rel` names no relationship the taxonomy carries, so `reversed` is not
   *  derivable — and §1's ruling makes `reversed` a function of rel + star. */
  | 'unknown-rel';

export type WireWriteProblem = {
  code: WireWriteProblemCode;
  message: string;
  /** The offending bracket's core id — what the UI addresses it by (§7.3). */
  bracketId: number;
};

/** `toWire`'s answer for the snapshot path: the document, or why there is none. */
export type WireWrite = { ok: true; forest: TreeNode[] } | { ok: false; reason: WireWriteProblem };

/** Internal control flow only; caught at `tryToWire`'s edge, thrown by `toWire`. */
class WireWriteError extends Error {
  constructor(readonly problem: WireWriteProblem) {
    super(`tree/serialize: ${problem.message}`);
  }
}

/**
 * A core Forest as the v2 document's `forest` — the exact JSON the server
 * validates (`da/documents.py`) and the fixtures store:
 *
 *   - a SETTLED side writes the unit itself as that child;
 *   - a HANGING side writes a `hole` holding its lodgers, in order — one
 *     lodger included (§10 A1), and both sides may write one (§10 A4);
 *   - ids are stripped (§7.3);
 *   - `reversed` is written as its DERIVED value (`reversedOf`), and only
 *     when true — the normalization `convert.ts` and the stored documents
 *     already follow;
 *   - `prominent` is the star as a child index: 'left' → 0, 'right' → 1, and
 *     null for a coordinate relationship;
 *   - `flag` is carried through as stored (§7.4 item 4's "flag normalization
 *     kept"): written only when the bracket carries the review mark.
 *
 * THE SAVE PATH. It throws on the two brackets it cannot spell: one whose
 * `rel` the taxonomy does not carry, and — defensively — an unlabeled one
 * (`rel` null), which §10 A5 leaves unreachable from the UI (every connect
 * mints Ser) but the type still permits. A throw here is a caller error: the
 * snapshot path, `tryToWire`, is what handles the mismatch as data.
 *
 * The unknown-rel case used to write the bracket with `reversed` silently
 * omitted. That is worse than either alternative: the server rejects the rel
 * anyway, so nothing was saved that a refusal would have cost — it only meant
 * the failure arrived without naming the bracket that caused it.
 */
export function toWire(f: Forest, taxonomy: readonly TaxonomyLike[]): TreeNode[] {
  const written = write(f, taxonomy);
  if (!written.ok) throw new WireWriteError(written.reason);
  return written.forest;
}

/**
 * THE PER-DOCTICK SNAPSHOT PATH (§7.4 item 4, item 11) — `toWire`'s bytes when
 * the state is storable, and a typed problem when it is not.
 *
 * Under §10 A5 every connect mints `rel: 'Ser'` (`core.ts`'s `connect`), so the
 * ordinary post-gesture tick is storable and this path exists for the DATA
 * mismatch alone: a bracket whose `rel` the supplied taxonomy does not carry —
 * a loaded document, or a taxonomy that changed underfoot. A snapshot consumer
 * holds its previous snapshot for such a tick; it must not take the save path's
 * throw. (Q6's unlabeled-bracket tick is gone with Q6.)
 */
export function tryToWire(f: Forest, taxonomy: readonly TaxonomyLike[]): WireWrite {
  return write(f, taxonomy);
}

function write(f: Forest, taxonomy: readonly TaxonomyLike[]): WireWrite {
  const facts = new Map<string, TaxonomyFacts>(
    taxonomy.map((entry) => [
      entry.code,
      { coordinate: entry.coordinate, starredLabel: entry.starredLabel ?? undefined },
    ]),
  );

  const refuse = (code: WireWriteProblemCode, u: Bracket, why: string): never => {
    throw new WireWriteError({
      code,
      bracketId: u.id,
      message: `bracket ${u.id} over [${leavesOf(u).join(' ')}] ${why}`,
    });
  };

  const unit = (u: Unit): TreeNode => {
    if (u.kind === 'leaf') return { kind: 'prop', ref: u.pid };
    if (u.rel === null) {
      return refuse(
        'unlabeled',
        u,
        'has no relationship; a bracket without one cannot be stored '
          + '(§10 A5: every connect mints a Ser, so this is data, not a gesture)',
      );
    }
    const entry = facts.get(u.rel);
    if (entry === undefined) {
      return refuse(
        'unknown-rel',
        u,
        `has rel '${u.rel}', which this taxonomy does not carry; `
          + 'its derived `reversed` cannot be computed, and the server rejects the rel too',
      );
    }
    const node: BracketNode = {
      kind: 'bracket',
      rel: u.rel,
      prominent: u.star === null ? null : u.star === 'left' ? 0 : 1,
      children: [side(u.left, u.leftHanging), side(u.right, u.rightHanging)],
    };
    if (reversedOf(f, u.id, entry)) node.reversed = true;
    if (u.flag !== undefined) node.flag = u.flag;
    return node;
  };

  // §10 A1/A4 on the wire: a HANGING side is a hole holding its lodgers, at any
  // count (a one-lodger room is a one-child hole), and a bracket may carry TWO
  // holes while the work is in progress. A settled side writes its unit.
  const side = (units: readonly Unit[], hanging: boolean): TreeNode =>
    hanging ? { kind: 'hole', children: units.map(unit) } : unit(units[0]!);

  try {
    return { ok: true, forest: f.roots.map(unit) };
  } catch (err) {
    if (err instanceof WireWriteError) return { ok: false, reason: err.problem };
    throw err;
  }
}
