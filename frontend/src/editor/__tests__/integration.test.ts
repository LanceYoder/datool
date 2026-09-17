// @vitest-environment jsdom
//
// The engine INSIDE a live editor (spec §7.2, §7.5, §7.10). Everything below
// this line has been proved pure elsewhere — the core's algebra in
// `src/tree/__tests__`, the wire adapter's bytes in `serialize.test.ts`, the
// geometry in `layout.test.ts`. What only a real Tiptap instance can show is
// the claim those suites cannot make:
//
//   ONE GESTURE IS ONE TRANSACTION, AND ONE TRANSACTION IS ONE UNDO STEP —
//   text and tree together, with the tree's IDS restored exactly.
//
// That is the whole reason the core state rides a DECLARED doc attribute
// rather than a plugin's own store: an AttrStep is a real, invertible step, so
// prosemirror-history inverts it for free. If it ever stops being true, undo
// starts handing back a tree whose brackets have new identities, and every
// popover, dot and command addressing them by id is aimed at nothing.

import { afterEach, describe, expect, it } from 'vitest';
import type { Editor } from '@tiptap/core';
import type { Document as AnalysisDocument, DocumentV2 } from '../../types';
import type { Bracket, Forest } from '../../tree/core';
import { bracketById, formatForest, leafOrder } from '../../tree/core';
import { buildTextById, documentToNode, nodeToDocument } from '../convert';
import { buildEditor } from '../editor';
import { findPropositionPos, pidsInOrder, readTree } from '../schema';
import {
  PRIME,
  addSectionBreak,
  clearConnections,
  connectUnits,
  deleteAt,
  flipStar,
  mergeBelow,
  removeSectionBreak,
  setRelationship,
  settleHang,
  settleLodger,
  splitProposition,
} from '../commands';
import { expectWellFormed } from './wellFormed';
import {
  CORPUS_WORDS,
  RAW_1JOHN_1_6E,
  TAXONOMY,
  WORD_MAP,
  disconnectedDoc,
  firstJohn16,
  hangingFtDoc,
  looseDoc,
} from './fixtures';

// Vite reads the JSON at transform time, so the tests need no fs.
const FIXTURES = import.meta.glob('./*.fixture.json', {
  eager: true,
  import: 'default',
}) as Record<string, DocumentV2>;

/** A stored analysis, freshly cloned so a test can edit it in place. */
function fixture(name: string): DocumentV2 {
  const key = Object.keys(FIXTURES).find((path) => path.endsWith(`/${name}.fixture.json`));
  if (key === undefined) throw new Error(`no fixture ${name}`);
  return structuredClone(FIXTURES[key]!);
}

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function open(doc: AnalysisDocument): Editor {
  editor = buildEditor([], documentToNode(doc, buildTextById(doc, CORPUS_WORDS), TAXONOMY));
  return editor;
}

const treeOf = (ed: Editor): Forest => readTree(ed.state.doc);
const shape = (ed: Editor): string => formatForest(treeOf(ed));
const labels = (ed: Editor): string[] => {
  const out: string[] = [];
  ed.state.doc.forEach((node) => {
    if (node.type.name === 'proposition') out.push(String(node.attrs.label));
  });
  return out;
};

/** What a save would write, without the flow the page carries separately. */
function saved(ed: Editor, prior: AnalysisDocument): DocumentV2 {
  return nodeToDocument(ed.state.doc, prior, TAXONOMY);
}

/** One proposition's attrs, for asserting what a command did NOT touch. */
function attrsOf(ed: Editor, pid: string): Record<string, unknown> {
  const pos = findPropositionPos(ed.state.doc, pid);
  if (pos === null) throw new Error(`no proposition '${pid}' in doc`);
  const node = ed.state.doc.nodeAt(pos);
  if (node === null) throw new Error(`no node at ${pos}`);
  return node.attrs;
}

describe('loading a stored analysis', () => {
  it('opens analysis 46 as a FLAT doc with the tree on its attribute', () => {
    const doc = fixture('john11-46');
    const ed = open(doc);

    // The tree's carrier, then one child per proposition, in reading order —
    // the tree itself is not in there.
    expect(ed.state.doc.childCount).toBe(doc.propositions.length + 1);
    expect(pidsInOrder(ed.state.doc)).toEqual(doc.propositions.map((p) => p.id));
    // ...it is here, over the same leaves in the same order (I4/I6).
    expect(leafOrder(treeOf(ed))).toEqual(doc.propositions.map((p) => p.id));
    expect(treeOf(ed).roots).toHaveLength(doc.forest.length);
    // Ids are minted, monotonic, and editor-internal.
    expect(treeOf(ed).nextId).toBeGreaterThan(1);
  });

  it.each(['john11-46', 'john11-firstpass-min', 'john11-firstpass-max'])(
    'round-trips %s back to the stored document, unchanged',
    (name) => {
      const doc = fixture(name);
      const ed = open(doc);
      const out = saved(ed, doc);
      // The text flow is the PAGE's to carry (AnalysisPage.onDocumentChange),
      // and always was; everything the editor owns comes back identical —
      // propositions, forest, sections, and the DERIVED `reversed` on the two
      // brackets that carry it.
      const { textFlow: _flow, ...stored } = doc;
      expect(out).toEqual(stored);
      expect(JSON.stringify(out.forest)).toBe(JSON.stringify(stored.forest));
    },
  );

  it('gives the propositions-only fallback its own flat doc (§7.5, Q2)', () => {
    const doc = fixture('john11-46');
    // An n-ary bracket: deletable per Q2, so the loader refuses the forest.
    doc.forest = [{
      kind: 'bracket',
      rel: 'Ser',
      prominent: null,
      children: doc.propositions.map((p) => ({ kind: 'prop', ref: p.id })),
    }];
    const warned: unknown[] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => warned.push(args);
    try {
      const ed = open(doc);
      expect(ed.state.doc.childCount).toBe(doc.propositions.length + 1);
      expect(treeOf(ed).roots.every((u) => u.kind === 'leaf')).toBe(true);
    } finally {
      console.warn = warn;
    }
    expect(warned).toHaveLength(1);
  });
});

describe('connect: one transaction, one undo step', () => {
  it('joins two roots, mints a SER (§10 A5), and undoes in ONE step', () => {
    const doc = disconnectedDoc(); // [ a, Ser[b,c], d, e ]
    const ed = open(doc);
    const before = treeOf(ed);
    expect(shape(ed)).toBe('[a, Ser[b, c], d, e]');
    const serId = (before.roots[1] as { id: number }).id;

    const out = connectUnits(ed, { kind: 'leaf', pid: 'a' }, { kind: 'bracket', id: serId });
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    // §10 A5: the join is real and it is a Ser — there is no unlabeled state.
    expect(shape(ed)).toBe('[Ser[a, Ser[b, c]], d, e]');
    expect(bracketById(treeOf(ed), out.bracketId)?.rel).toBe('Ser');
    expect(treeOf(ed).nextId).toBe(before.nextId + 1);
    expect(out.bracketId).toBe(before.nextId);
    expect(out.editedInPlace).toBe(false);
    // The propositions never moved: only the doc ATTRIBUTE changed.
    expect(pidsInOrder(ed.state.doc)).toEqual(['a', 'b', 'c', 'd', 'e']);

    // ...and exactly one undo puts the whole thing back, ids included.
    expect(ed.can().undo()).toBe(true);
    ed.commands.undo();
    expect(treeOf(ed)).toEqual(before);
    expect(ed.can().undo()).toBe(false); // it was ONE step, not two
  });

  it('breaks the bracket that CLAIMS an endpoint (ruling Q1), reversibly', () => {
    const doc = disconnectedDoc();
    const ed = open(doc);
    const before = treeOf(ed);

    // c is committed in the Ser, so connecting it to d breaks the Ser.
    const out = connectUnits(ed, { kind: 'leaf', pid: 'c' }, { kind: 'leaf', pid: 'd' });
    expect(out.ok).toBe(true);
    expect(shape(ed)).toBe('[a, b, Ser[c, d], e]');

    ed.commands.undo();
    expect(treeOf(ed)).toEqual(before);
    expect(shape(ed)).toBe('[a, Ser[b, c], d, e]');
  });

  it('refuses non-adjacent units with the CORE’s own message, changing nothing', () => {
    const doc = disconnectedDoc();
    const ed = open(doc);
    const before = treeOf(ed);

    const out = connectUnits(ed, { kind: 'leaf', pid: 'a' }, { kind: 'leaf', pid: 'd' });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.refusal.code).toBe('not-adjacent');
    expect(out.refusal.message).toMatch(/not next to each other/);
    // A refusal changes nothing (§5): same state, and nothing to undo.
    expect(treeOf(ed)).toBe(before);
    expect(ed.can().undo()).toBe(false);
  });

  it('re-connecting an existing pair edits it IN PLACE and dispatches nothing', () => {
    // §5.1 step 1's exception: the two clicked units are the two committed
    // members of one bracket. The menu opens on it preloaded, and there is no
    // join to undo.
    const doc = disconnectedDoc();
    const ed = open(doc);
    const before = treeOf(ed);
    const serId = (before.roots[1] as { id: number }).id;

    const out = connectUnits(ed, { kind: 'leaf', pid: 'b' }, { kind: 'leaf', pid: 'c' });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.editedInPlace).toBe(true);
    expect(out.bracketId).toBe(serId);
    expect(treeOf(ed)).toBe(before);
    expect(ed.can().undo()).toBe(false);
  });

  it('relabels the fresh join by ID; the Ser it landed as is one undo below', () => {
    const doc = disconnectedDoc();
    const ed = open(doc);
    const before = treeOf(ed);

    const out = connectUnits(ed, { kind: 'leaf', pid: 'c' }, { kind: 'leaf', pid: 'd' });
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    // The pick is a SECOND gesture and a second undo step.
    expect(setRelationship(ed, out.bracketId, 'Grnd', TAXONOMY)).toBe(true);
    expect(shape(ed)).toBe('[a, b, Grnd[c, d], e]');
    // Grnd stars labels[0], so the star lands on the left end.
    expect(saved(ed, doc).forest[2]).toMatchObject({ rel: 'Grnd', prominent: 0 });

    expect(flipStar(ed, out.bracketId, TAXONOMY)).toBe(true);
    const flipped = saved(ed, doc).forest[2];
    // `reversed` is DERIVED: moving the star to the other end is what sets it.
    expect(flipped).toMatchObject({ rel: 'Grnd', prominent: 1, reversed: true });

    ed.commands.undo(); // the flip
    ed.commands.undo(); // the label
    expect(shape(ed)).toBe('[a, b, Ser[c, d], e]');
    ed.commands.undo(); // the join itself
    expect(treeOf(ed)).toEqual(before);
  });
});

/** hangingFtDoc's Ft/In: the left member of its second root, the Inf. */
function innerFtIn(ed: Editor): Bracket | null {
  const inf = treeOf(ed).roots[1];
  if (inf === undefined || inf.kind !== 'bracket') return null;
  const ft = inf.left[0];
  return ft !== undefined && ft.kind === 'bracket' ? ft : null;
}

describe('§10 — rooms are where assembly happens', () => {
  it('A1: a join inside a room LEAVES THE SIDE HANGING, however few are left', () => {
    // hangingFtDoc: Inf[ FtIn[41d, ⟨42a 42b 42c 42d⟩], 42e ]. Join the room
    // down to a single lodger and the Ft/In is still unfinished — the analyst
    // has not said otherwise.
    const doc = hangingFtDoc();
    const ed = open(doc);
    let out = connectUnits(ed, { kind: 'leaf', pid: '42a' }, { kind: 'leaf', pid: '42b' });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    out = connectUnits(ed, { kind: 'bracket', id: out.bracketId }, { kind: 'leaf', pid: '42c' });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    out = connectUnits(ed, { kind: 'bracket', id: out.bracketId }, { kind: 'leaf', pid: '42d' });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(shape(ed)).toBe(
      '[Ser[41a, 41b], Inf[FtIn[41d, ⟨Ser[Ser[Ser[42a, 42b], 42c], 42d]⟩], 42e]]',
    );
    expect(innerFtIn(ed)?.rightHanging).toBe(true);
    // …and it SAVES that way: a one-child hole on the wire (§10 A1, A4).
    const wire = saved(ed, doc).forest[1] as { children: { children: unknown[] }[] };
    const inner = wire.children[0] as { children: { kind: string; children: unknown[] }[] };
    expect(inner.children[1]).toMatchObject({ kind: 'hole' });
    expect((inner.children[1] as { children: unknown[] }).children).toHaveLength(1);
  });

  it('A2: the pickup dot settles the side — one undo step, no menu, no new bracket', () => {
    const doc = hangingFtDoc();
    const ed = open(doc);
    // Assemble the room into one unit first (three in-room joins).
    let out = connectUnits(ed, { kind: 'leaf', pid: '42a' }, { kind: 'leaf', pid: '42b' });
    if (!out.ok) return;
    out = connectUnits(ed, { kind: 'bracket', id: out.bracketId }, { kind: 'leaf', pid: '42c' });
    if (!out.ok) return;
    out = connectUnits(ed, { kind: 'bracket', id: out.bracketId }, { kind: 'leaf', pid: '42d' });
    if (!out.ok) return;

    const ftIn = innerFtIn(ed)!.id;
    const before = treeOf(ed);
    const nextId = before.nextId;

    // The gesture: the room's SOLE lodger is what the pickup dot pairs with.
    const lodger = settleLodger(ed, ftIn, 'right');
    expect(lodger).toMatchObject({ kind: 'bracket', id: out.bracketId });
    expect(settleHang(ed, ftIn, 'right')).toBeNull();

    expect(shape(ed)).toBe(
      '[Ser[41a, 41b], Inf[FtIn[41d, Ser[Ser[Ser[42a, 42b], 42c], 42d]], 42e]]',
    );
    expect(treeOf(ed).nextId).toBe(nextId); // no new bracket was minted
    expect(bracketById(treeOf(ed), ftIn)?.rightHanging).toBe(false);
    // ONE undo step, and the room is back.
    ed.commands.undo();
    expect(treeOf(ed)).toEqual(before);
  });

  it('A2: refuses to settle a room that still holds a group, dispatching nothing', () => {
    const ed = open(hangingFtDoc());
    const ftIn = innerFtIn(ed)!.id;
    const before = treeOf(ed);
    expect(settleLodger(ed, ftIn, 'right')).toBeNull(); // four lodgers, not one
    expect(settleHang(ed, ftIn, 'right')?.code).toBe('not-settleable');
    expect(settleHang(ed, ftIn, 'left')?.code).toBe('not-settleable'); // settled side
    expect(treeOf(ed)).toBe(before);
    expect(ed.can().undo()).toBe(false);
  });

  it('A4: a delete takes ONE relationship and never cascades', () => {
    // firstJohn16: CndE[ FtIn[p1, Adv[p2,p3]], Ser[p4,p5] ]. Delete the Ft/In,
    // then the Ser: v3 brought the CndE down behind the second delete. It
    // stands now, hanging at both ends, and saves that way.
    const doc = firstJohn16();
    const ed = open(doc);
    const cndE = (treeOf(ed).roots[0] as { id: number }).id;

    expect(deleteAt(ed, { kind: 'leaf', pid: 'p1' })).toBeNull();
    expect(shape(ed)).toBe('[CndE[⟨p1 Adv[p2, p3]⟩, Ser[p4, p5]]]');
    expect(deleteAt(ed, { kind: 'leaf', pid: 'p4' })).toBeNull();
    expect(shape(ed)).toBe('[CndE[⟨p1 Adv[p2, p3]⟩, ⟨p4 p5⟩]]');
    expect(bracketById(treeOf(ed), cndE)).not.toBeNull();

    // A TWO-HANGING bracket round-trips through the save path: two holes on
    // the wire, and the same forest when it is opened again (§10 A4).
    const written = saved(ed, doc);
    expect(written.forest[0]).toMatchObject({
      kind: 'bracket',
      rel: 'CndE',
      children: [{ kind: 'hole' }, { kind: 'hole' }],
    });
    const reopened = open(written);
    expect(shape(reopened)).toBe('[CndE[⟨p1 Adv[p2, p3]⟩, ⟨p4 p5⟩]]');
    expect(saved(reopened, written).forest).toEqual(written.forest);
  });
});

describe('delete', () => {
  it('takes down the relationship a dot names and restores it on undo', () => {
    const doc = disconnectedDoc();
    const ed = open(doc);
    const before = treeOf(ed);

    // A leaf's dot names the bracket owning the side that holds it (§5.3).
    expect(deleteAt(ed, { kind: 'leaf', pid: 'b' })).toBeNull();
    expect(shape(ed)).toBe('[a, b, c, d, e]');

    ed.commands.undo();
    expect(treeOf(ed)).toEqual(before);
  });

  it('refuses a ROOT proposition’s dot-delete with a message, dispatching nothing', () => {
    const ed = open(disconnectedDoc());
    const before = treeOf(ed);
    const refusal = deleteAt(ed, { kind: 'leaf', pid: 'a' });
    expect(refusal?.code).toBe('root-delete');
    expect(refusal?.message).toMatch(/hangs from nothing/);
    expect(treeOf(ed)).toBe(before);
    expect(ed.can().undo()).toBe(false);
  });

  it('clears every connection at once, and one undo brings the tree back', () => {
    const doc = fixture('john11-46');
    const ed = open(doc);
    const before = treeOf(ed);

    expect(clearConnections(ed)).toBe(true);
    expect(treeOf(ed).roots).toHaveLength(doc.propositions.length);
    expect(treeOf(ed).roots.every((u) => u.kind === 'leaf')).toBe(true);

    ed.commands.undo();
    expect(treeOf(ed)).toEqual(before);
    // A second clear on an already-flat forest is not an empty undo step.
    clearConnections(ed);
    ed.commands.undo();
    expect(clearConnections(ed)).toBe(true);
  });
});

describe('split and merge: the propositions and the tree, together', () => {
  it('splits a committed leaf into a HANGING side (ruling Q4), relabelling as it goes', () => {
    const doc = disconnectedDoc();
    const ed = open(doc);
    const before = treeOf(ed);
    const beforeLabels = labels(ed);

    expect(splitProposition(ed, 'b', 2, WORD_MAP)).toBe(true);

    // The document grew a proposition...
    expect(pidsInOrder(ed.state.doc)).toEqual(['a', 'b', 'p1', 'c', 'd', 'e']);
    // ...the Ser's left side now holds ⟨b p1⟩ and hangs, awaiting reassembly...
    expect(shape(ed)).toBe('[a, Ser[⟨b p1⟩, c], d, e]');
    // ...and the corpus labels were re-derived from the verses (§7.10).
    expect(beforeLabels).toEqual(['6a', '6b', '6c', '6d', '6e']);
    expect(labels(ed)).toEqual(['6a', '6b', '6c', '6d', '6e', '6e']);
    // The halves divide the source at the chosen word; w1 keeps the pid.
    expect(saved(ed, doc).propositions.slice(0, 3)).toEqual([
      { id: 'a', label: '6a', source: { kind: 'corpus', start: 124771, end: 124772 } },
      { id: 'b', label: '6b', source: { kind: 'corpus', start: 124773, end: 124774 } },
      { id: 'p1', label: '6c', source: { kind: 'corpus', start: 124775, end: 124777 } },
    ]);

    // ONE undo takes the text, the labels and the tree back together.
    ed.commands.undo();
    expect(pidsInOrder(ed.state.doc)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(labels(ed)).toEqual(beforeLabels);
    expect(treeOf(ed)).toEqual(before);
    expect(ed.can().undo()).toBe(false);
  });

  it('merges two leaves, removing the MINIMAL set of brackets', () => {
    const doc = disconnectedDoc();
    const ed = open(doc);
    const before = treeOf(ed);

    // a is a root; b is committed in the Ser, so the Ser gives way and c
    // spills beside the fused leaf.
    expect(mergeBelow(ed, 'a', WORD_MAP)).toBe(true);
    expect(pidsInOrder(ed.state.doc)).toEqual(['a', 'c', 'd', 'e']);
    expect(shape(ed)).toBe('[a, c, d, e]');
    // The fused leaf keeps the upper one's pid and concatenates the spans.
    expect(saved(ed, doc).propositions[0]).toEqual({
      id: 'a',
      label: '6a',
      source: { kind: 'corpus', start: 124771, end: 124777 },
    });

    ed.commands.undo();
    expect(pidsInOrder(ed.state.doc)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(treeOf(ed)).toEqual(before);
    expect(ed.can().undo()).toBe(false);
  });

  it('refuses to merge past the end of the document', () => {
    const ed = open(disconnectedDoc());
    const before = treeOf(ed);
    expect(mergeBelow(ed, 'e', WORD_MAP)).toBe(false);
    expect(mergeBelow(ed, 'nope', WORD_MAP)).toBe(false);
    expect(treeOf(ed)).toBe(before);
    expect(ed.can().undo()).toBe(false);
  });

  it('splits a RAW proposition by whitespace tokens, priming the second label', () => {
    // commands.ts's raw branch: no corpus range to divide, so the display text
    // is tokenized and the tail takes the head's label with a prime. Nothing
    // in relabelCorpusInTransaction touches it — the corpus is what knows
    // where verses fall, and a raw proposition has none.
    const doc = firstJohn16();
    const ed = open(doc);
    expect(splitProposition(ed, 'p5', 2, WORD_MAP)).toBe(true);

    const out = saved(ed, doc);
    expect(out.propositions).toHaveLength(6);
    expect(out.propositions[4]).toMatchObject({
      id: 'p5',
      label: '6e',
      source: { kind: 'raw', text: 'καὶ οὐ' },
    });
    expect(out.propositions[5]).toMatchObject({
      label: `6e${PRIME}`,
      source: { kind: 'raw', text: 'ποιοῦμεν τὴν ἀλήθειαν·' },
    });
    // p5 was committed in the Ser, so (ruling Q4) that side now HANGS.
    const tail = out.propositions[5]!.id;
    expect(shape(ed)).toBe(`[CndE[FtIn[p1, Adv[p2, p3]], Ser[p4, ⟨p5 ${tail}⟩]]]`);
    expectWellFormed(ed);
  });

  it('rejects out-of-range split points and unknown pids, dispatching nothing', () => {
    const doc = firstJohn16();
    const ed = open(doc);
    const before = ed.getJSON();

    expect(splitProposition(ed, 'p4', 1, WORD_MAP)).toBe(false); // one word only
    expect(splitProposition(ed, 'p2', 0, WORD_MAP)).toBe(false); // nothing before
    expect(splitProposition(ed, 'p2', 5, WORD_MAP)).toBe(false); // == the whole
    expect(splitProposition(ed, 'p2', 2, null)).toBe(false); // corpus needs words
    expect(splitProposition(ed, 'p5', 9, WORD_MAP)).toBe(false); // past the tokens
    expect(splitProposition(ed, 'nope', 1, WORD_MAP)).toBe(false);

    expect(ed.getJSON()).toEqual(before);
    expect(ed.can().undo()).toBe(false);
  });

  it('degrades a merge to a RAW source when the two ranges are not contiguous', () => {
    // Corpus + raw: there is no range to join, so the two display texts are.
    const doc = firstJohn16();
    const ed = open(doc);
    expect(mergeBelow(ed, 'p4', WORD_MAP)).toBe(true);
    expect(saved(ed, doc).propositions[3]).toMatchObject({
      id: 'p4',
      source: { kind: 'raw', text: `ψευδόμεθα ${RAW_1JOHN_1_6E}` },
    });
    expectWellFormed(ed, ['p1', 'p2', 'p3', 'p4']);
  });

  it('degrades a merge when two corpus ranges leave a GAP between them', () => {
    const doc = disconnectedDoc();
    doc.propositions[0]!.source = { kind: 'corpus', start: 124771, end: 124772 };
    doc.propositions[1]!.source = { kind: 'corpus', start: 124778, end: 124779 };
    const ed = open(doc);
    expect(mergeBelow(ed, 'a', WORD_MAP)).toBe(true);
    // a.srcEnd + 1 !== b.srcStart, so the fused leaf keeps no corpus range.
    expect(saved(ed, doc).propositions[0]?.source.kind).toBe('raw');
    expectWellFormed(ed, ['a', 'c', 'd', 'e']);
  });

  it('labels cross-verse and cross-chapter propositions as SPANS, not letters', () => {
    // relabelCorpusInTransaction's other two arms: a proposition inside one
    // verse letters up among its neighbours, one crossing verses writes the
    // span, and one crossing chapters writes both chapters.
    const doc: AnalysisDocument = {
      schemaVersion: 2,
      propositions: [
        { id: 'x', label: '6–7', source: { kind: 'corpus', start: 124771, end: 124791 } },
      ],
      forest: [{ kind: 'prop', ref: 'x' }],
    };
    const ed = open(doc);

    // The head now sits in verse 6 alone — unlettered, because it is the only
    // proposition there; the tail still reaches into verse 7.
    expect(splitProposition(ed, 'x', 2, WORD_MAP)).toBe(true);
    expect(labels(ed)).toEqual(['6', '6–7']);

    // A second split inside verse 6 makes the two of them letter up, while
    // the tail keeps its span.
    const tail = pidsInOrder(ed.state.doc)[1]!;
    expect(splitProposition(ed, tail, 4, WORD_MAP)).toBe(true);
    expect(labels(ed)).toEqual(['6a', '6b', '6–7']);
  });

  it('labels a CROSS-CHAPTER proposition with both chapters', () => {
    const crossing = new Map(
      [...WORD_MAP].map(([i, w]) =>
        i >= 124789 ? ([i, { ...w, chapter: 2, verse: 3 }] as const) : ([i, w] as const),
      ),
    );
    const ed = open({
      schemaVersion: 2,
      propositions: [
        { id: 'z', label: '?', source: { kind: 'corpus', start: 124771, end: 124772 } },
        { id: 'y', label: '?', source: { kind: 'corpus', start: 124782, end: 124791 } },
      ],
      forest: [{ kind: 'prop', ref: 'z' }, { kind: 'prop', ref: 'y' }],
    });
    // Splitting z is what runs the relabel over the whole document, y included.
    expect(splitProposition(ed, 'z', 1, crossing)).toBe(true);
    expect(labels(ed)[2]).toBe('1:6–2:3');
  });

  it('splits and merges INSIDE the stored analysis and still saves a valid document', () => {
    const doc = fixture('john11-46');
    const ed = open(doc);
    const pid = doc.propositions[5]!.id;

    // This passage's own corpus words, so the relabelling has verses to read.
    const words = new Map(
      doc.propositions.flatMap((p) =>
        p.source.kind === 'corpus'
          ? [...Array(p.source.end - p.source.start + 1).keys()].map((i) => {
              const index = (p.source as { start: number }).start + i;
              return [index, { ...CORPUS_WORDS[0]!, index, verse: 38, text: `w${index}` }] as const;
            })
          : [],
      ),
    );
    expect(splitProposition(ed, pid, 1, words)).toBe(true);
    expect(ed.state.doc.childCount).toBe(doc.propositions.length + 2);
    // Whatever the split did to the tree, the result is still storable.
    const out = saved(ed, doc);
    expect(out.propositions).toHaveLength(doc.propositions.length + 1);
    expect(leafOrder(treeOf(ed))).toEqual(out.propositions.map((p) => p.id));

    ed.commands.undo();
    const { textFlow: _flow, ...stored } = doc;
    expect(saved(ed, doc)).toEqual(stored);
  });
});

describe('attribute edits: the guards, not just the happy path', () => {
  /** The bracket the fixture's Ser (coordinate) and CndE (subordinate) are. */
  const idsOf = (ed: Editor) => {
    const root = treeOf(ed).roots[0]!;
    if (root.kind !== 'bracket') throw new Error('expected a bracket root');
    const ser = root.right[0]!;
    if (ser.kind !== 'bracket') throw new Error('expected the Ser');
    return { cndE: root.id, ser: ser.id };
  };

  it('refuses to flip a star that is not there, dispatching nothing', () => {
    const doc = firstJohn16();
    const ed = open(doc);
    const { cndE, ser } = idsOf(ed);
    const before = treeOf(ed);

    expect(flipStar(ed, 9999, TAXONOMY)).toBe(false); // no such bracket
    expect(flipStar(ed, ser, TAXONOMY)).toBe(false); // Ser is coordinate (I7)
    expect(flipStar(ed, cndE, TAXONOMY)).toBe(true); // ...and the happy path
    ed.commands.undo();

    // A FRESH JOIN is a Ser (§10 A5), and Ser is coordinate — so it has no
    // star to flip either, for the ordinary I7 reason rather than for want of
    // a relationship. p3 and p4 are committed in DIFFERENT brackets, so both
    // claimers break (ruling Q3) and the join is a plain new bracket.
    const fresh = connectUnits(ed, { kind: 'leaf', pid: 'p3' }, { kind: 'leaf', pid: 'p4' });
    expect(fresh.ok).toBe(true);
    if (!fresh.ok) return;
    expect(fresh.editedInPlace).toBe(false);
    expect(bracketById(treeOf(ed), fresh.bracketId)?.rel).toBe('Ser');
    expect(bracketById(treeOf(ed), fresh.bracketId)?.star).toBeNull();
    expect(flipStar(ed, fresh.bracketId, TAXONOMY)).toBe(false);

    // Only the join itself is in the history; every refusal dispatched nothing.
    ed.commands.undo();
    expect(treeOf(ed)).toEqual(before);
    expect(ed.can().undo()).toBe(false);
  });

  it('refuses a relationship the taxonomy does not carry', () => {
    const doc = firstJohn16();
    const ed = open(doc);
    const { cndE } = idsOf(ed);
    const before = treeOf(ed);

    expect(setRelationship(ed, cndE, 'NoSuchRel', TAXONOMY)).toBe(false);
    expect(setRelationship(ed, 9999, 'Ser', TAXONOMY)).toBe(false);
    expect(treeOf(ed)).toBe(before);
    expect(ed.can().undo()).toBe(false);
  });

  it('re-picking the relationship a bracket already has spends NO history step', () => {
    // The core rebuilds the bracket either way, so without the command's own
    // guard this would land a real DocAttrStep — a dead entry in the undo
    // stack for a gesture that changed nothing. The pick still succeeds: the
    // menu closes because closing it is UI state, not a document change.
    const doc = firstJohn16();
    const ed = open(doc);
    const { cndE, ser } = idsOf(ed);
    const before = treeOf(ed);

    expect(setRelationship(ed, cndE, 'CndE', TAXONOMY)).toBe(true);
    expect(setRelationship(ed, ser, 'Ser', TAXONOMY)).toBe(true);
    expect(treeOf(ed)).toBe(before);
    expect(ed.can().undo()).toBe(false);

    // A real change still commits, and still undoes in one step.
    expect(setRelationship(ed, ser, 'Grnd', TAXONOMY)).toBe(true);
    expect(ed.can().undo()).toBe(true);
    ed.commands.undo();
    expect(treeOf(ed)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Color blocks. Not tree structure — a break is the blockColor attr of the
// proposition that begins its block — so these are ORDINARY transactions
// sharing the same history, and the point of the suite is that they behave
// like every other command: one undo step each, and no step at all for a
// no-op. commands.ts's setBreaks/addSectionBreak/removeSectionBreak came
// through the rebuild unchanged, and this is the only place they are exercised
// through a live editor (sections.test.ts covers the pure helpers beneath).

describe('addSectionBreak / removeSectionBreak', () => {
  const breaksOf = (ed: Editor, prior: AnalysisDocument) => saved(ed, prior).sections;

  it('is an ordinary transaction: one undo step, shared history', () => {
    const doc = looseDoc(); // props a, b, c
    const ed = open(doc);
    expect(breaksOf(ed, doc)).toBeUndefined();

    expect(addSectionBreak(ed, 'b')).toBe(true);
    expect(breaksOf(ed, doc)).toEqual([{ start: 'b', color: 1 }]);

    expect(ed.commands.undo()).toBe(true);
    expect(breaksOf(ed, doc)).toBeUndefined();
    expect(ed.commands.redo()).toBe(true);
    expect(breaksOf(ed, doc)).toEqual([{ start: 'b', color: 1 }]);

    expect(removeSectionBreak(ed, 'b')).toBe(true);
    expect(breaksOf(ed, doc)).toBeUndefined();
    expect(ed.commands.undo()).toBe(true);
    expect(breaksOf(ed, doc)).toEqual([{ start: 'b', color: 1 }]);
  });

  it('touches only the proposition whose block start changed', () => {
    const doc = looseDoc();
    const ed = open(doc);
    const aBefore = attrsOf(ed, 'a');
    const cBefore = attrsOf(ed, 'c');
    expect(addSectionBreak(ed, 'b')).toBe(true);
    // Only 'b' carries a block start; its neighbours' attrs are untouched,
    // which is what keeps their rows from re-rendering.
    expect(attrsOf(ed, 'b').blockColor).toBe(1);
    expect(attrsOf(ed, 'a')).toEqual(aBefore);
    expect(attrsOf(ed, 'c')).toEqual(cBefore);
  });

  it('dispatches nothing for a no-op: first proposition, unknown pid, repeat', () => {
    const doc = looseDoc();
    const ed = open(doc);
    expect(addSectionBreak(ed, 'a')).toBe(false); // the document already starts a block
    expect(addSectionBreak(ed, 'nope')).toBe(false);
    expect(removeSectionBreak(ed, 'b')).toBe(false); // no break there
    expect(addSectionBreak(ed, 'b')).toBe(true);
    expect(addSectionBreak(ed, 'b')).toBe(false); // already a break
    expect(ed.can().redo()).toBe(false);
  });

  it('a break survives splitting its own start row (the head keeps the pid)', () => {
    const doc = looseDoc();
    const ed = open(doc);
    expect(addSectionBreak(ed, 'b')).toBe(true);
    expect(splitProposition(ed, 'b', 1, null)).toBe(true);
    expect(breaksOf(ed, doc)).toEqual([{ start: 'b', color: 1 }]);
  });

  it('merging across a break dissolves it on emit — and undoing the merge restores it', () => {
    const doc = looseDoc();
    const ed = open(doc);
    expect(addSectionBreak(ed, 'b')).toBe(true);
    expect(mergeBelow(ed, 'a', null)).toBe(true); // 'b' is gone: a absorbs it
    expect('sections' in saved(ed, doc)).toBe(false);
    // The attr still names 'b' (pruning is emit-only), so undo brings it back.
    expect(ed.commands.undo()).toBe(true);
    expect(breaksOf(ed, doc)).toEqual([{ start: 'b', color: 1 }]);
  });

  it('a block keeps its color when the block above it is removed', () => {
    const doc = looseDoc(); // props a, b, c
    const ed = open(doc);
    expect(addSectionBreak(ed, 'b')).toBe(true); // block b takes color 1
    expect(addSectionBreak(ed, 'c')).toBe(true); // block c takes color 2
    expect(removeSectionBreak(ed, 'b')).toBe(true);
    // c's block still wears ITS color, not a re-derived one.
    expect(breaksOf(ed, doc)).toEqual([{ start: 'c', color: 2 }]);
  });
});
