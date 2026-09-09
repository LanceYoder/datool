/**
 * Fixture loading for the core suites: the analyst's real saved documents,
 * read through the REAL wire adapter (`../serialize`, spec §7.4). This module
 * is now a thin shell — fixture lookup, label↔pid tables, and the one
 * adaptation the older suites want: a `Forest` or a throw, where `fromWire`
 * answers with a typed refusal.
 *
 * The fixture JSONs live HERE (`./fixtures/`), copied from the editor suite:
 * these tests outlive `frontend/src/editor/` (spec §7.7 deletes most of it),
 * so they must not read through it.
 */

import type { TreeNode } from '../../types';
import type { Forest } from '../core';
import { fromWire } from '../serialize';

export type { TreeNode as WireNode };

export interface WireDoc {
  schemaVersion: number;
  propositions: { id: string; label: string }[];
  forest: TreeNode[];
}

export interface LoadedFixture {
  forest: Forest;
  /** Document leaf order — what `assertInvariants` is measured against. */
  order: string[];
  /** '41b' → 'p16'; the acceptance catalogue names propositions by label. */
  pid: (label: string) => string;
  /** 'p16' → '41b', for readable failure output. */
  label: (pid: string) => string;
  /** The stored document itself — what a round-trip is measured against. */
  doc: WireDoc;
}

/**
 * `fromWire` for callers that want the forest or nothing: the typed refusal
 * (which production code turns into the propositions-only fallback, §7.5)
 * becomes a throw carrying the same message.
 */
export function forestFromWire(doc: WireDoc): Forest {
  const loaded = fromWire(doc.forest, doc.propositions.map((p) => p.id));
  if (!loaded.ok) throw new Error(`wire fixture: ${loaded.reason.message}`);
  return loaded.forest;
}

export function loadFixture(doc: WireDoc): LoadedFixture {
  const forest = forestFromWire(doc);
  const byLabel = new Map(doc.propositions.map((p) => [p.label, p.id]));
  const byPid = new Map(doc.propositions.map((p) => [p.id, p.label]));
  return {
    forest,
    order: doc.propositions.map((p) => p.id),
    pid: (label) => {
      const hit = byLabel.get(label);
      if (hit === undefined) throw new Error(`wire fixture: no proposition labelled ${label}`);
      return hit;
    },
    label: (pid) => byPid.get(pid) ?? pid,
    doc,
  };
}

// Vite reads the JSON at transform time, so the tests need no fs and the repo
// needs no tsconfig change for `resolveJsonModule`.
const FIXTURES = import.meta.glob('./fixtures/*.fixture.json', {
  eager: true,
  import: 'default',
}) as Record<string, WireDoc>;

/** The stored document behind a fixture, unparsed. */
export function wireDoc(name: string): WireDoc {
  const key = Object.keys(FIXTURES).find((path) => path.endsWith(`/${name}.fixture.json`));
  if (key === undefined) {
    throw new Error(`wire fixture: ${name} not found in ${Object.keys(FIXTURES).join(', ')}`);
  }
  return FIXTURES[key];
}

/** The analyst's saved John 11:38–44 analysis. */
export const john1146 = (): LoadedFixture => loadFixture(wireDoc('john11-46'));
/** First pass, 15 flat roots, same 9-leaf Alt region. */
export const john11Min = (): LoadedFixture => loadFixture(wireDoc('john11-firstpass-min'));
/** First pass with the region embedded mid-spine as a COMMITTED Ser member. */
export const john11Max = (): LoadedFixture => loadFixture(wireDoc('john11-firstpass-max'));
