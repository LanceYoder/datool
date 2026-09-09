// The structural law of an editor document, in one place so every suite that
// asserts it asserts the SAME thing.
//
// There is no second law here. Since the rebuild (spec §7.1, §7.7) the model
// lives in `src/tree/core.ts` and NOWHERE else: the ProseMirror document is
// flat `proposition+`, and I1–I7 are `assertInvariants`'. So this file is a
// thin wrapper over the core rather than a second opinion about brackets and
// waiting rooms — a second opinion is exactly what §0.5 says went wrong last
// time, and a copy of the law that can only ever be more permissive than the
// core is worse than no check at all.
//
// What it adds — the one thing the core cannot check for itself — is the JOIN
// between the two halves of the state. Every op asserts I4/I6 against the leaf
// order of the forest it was HANDED, so no op can notice that the forest and
// the document have drifted apart: a split whose ReplaceStep landed but whose
// tree attribute did not (or the reverse) leaves both halves internally
// consistent and the pair meaningless. Here the document's own propositions,
// in document order, are the order the forest is judged against.

import { expect } from 'vitest';
import type { Editor } from '@tiptap/core';
import { assertInvariants } from '../../tree/core';
import { pidsInOrder, readTree } from '../schema';

/**
 * Everything wrong with `ed`'s state, as sentences — empty when it is well
 * formed. Collected rather than thrown, so a sweep can run this tens of
 * thousands of times and a failure names the complaint rather than the frame.
 *
 *  - the schema still accepts the document;
 *  - I1–I7 hold over the forest on `doc.attrs.tree` (§2), judged against the
 *    propositions the DOCUMENT holds, in document order;
 *  - and, when `leaves` is given, those propositions are the ones expected —
 *    in that order, the order no command may disturb (I6).
 */
export function malformations(ed: Editor, leaves?: readonly string[]): string[] {
  const out: string[] = [];
  try {
    ed.state.doc.check();
  } catch (e) {
    out.push(`the schema rejects the document: ${String(e)}`);
  }

  const pids = pidsInOrder(ed.state.doc);
  try {
    assertInvariants(readTree(ed.state.doc), pids);
  } catch (e) {
    out.push(String(e instanceof Error ? e.message : e));
  }

  if (leaves !== undefined && pids.join(',') !== leaves.join(',')) {
    out.push(`the leaves read ${pids.join(',')}, not ${leaves.join(',')}`);
  }
  return out;
}

/** Assert the document and its tree keep the whole law (see malformations). */
export function expectWellFormed(ed: Editor, leaves?: readonly string[]): void {
  expect(malformations(ed, leaves)).toEqual([]);
}
