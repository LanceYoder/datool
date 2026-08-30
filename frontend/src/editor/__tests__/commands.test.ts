// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import type { Editor } from '@tiptap/core';
import type { BracketNode, Document as AnalysisDocument, TreeNode } from '../../types';
import { buildTextById, documentToNode, nodeToDocument } from '../convert';
import { buildEditor } from '../editor';
import {
  addSectionBreak,
  clearConnections,
  connectUnits,
  deleteRelationship,
  disconnectRoot,
  findBrackets,
  findPropositionPos,
  flipStar,
  mergeBelow,
  removeSectionBreak,
  setRelationship,
  splitProposition,
  unzipToRoot,
} from '../commands';
import {
  CORPUS_WORDS,
  RAW_1JOHN_1_6E,
  TAXONOMY,
  WORD_MAP,
  disconnectedDoc,
  firstJohn16,
  flatDoc,
  looseDoc,
  nestedDoc,
  pairDoc,
} from './fixtures';

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function open(doc: AnalysisDocument, words = CORPUS_WORDS): Editor {
  editor = buildEditor([], documentToNode(doc, buildTextById(doc, words)));
  return editor;
}

function propPos(ed: Editor, pid: string): number {
  const pos = findPropositionPos(ed.state.doc, pid);
  if (pos === null) throw new Error(`no proposition '${pid}' in doc`);
  return pos;
}

function bracketPos(ed: Editor, rel: string, nth = 0): number {
  const hits = findBrackets(ed.state.doc).filter((b) => b.node.attrs.rel === rel);
  const hit = hits[nth];
  if (hit === undefined) throw new Error(`no bracket '${rel}' #${nth} in doc`);
  return hit.pos;
}

/** Position of the `index`-th top-level doc child (forest root). */
function rootPos(ed: Editor, index: number): number {
  let pos = 0;
  for (let i = 0; i < index; i += 1) pos += ed.state.doc.child(i).nodeSize;
  return pos;
}

function forestOf(ed: Editor, prior: AnalysisDocument): TreeNode[] {
  return nodeToDocument(ed.state.doc, prior).forest;
}

function labelsOf(ed: Editor, prior: AnalysisDocument): string[] {
  return nodeToDocument(ed.state.doc, prior).propositions.map((p) => p.label);
}

const prop = (ref: string): TreeNode => ({ kind: 'prop', ref });

// ---------------------------------------------------------------------------

describe('connectUnits', () => {
  it('wraps two adjacent roots in one binary coordinate bracket by default', () => {
    const doc = disconnectedDoc(); // [ a, Ser[b,c], d, e ]
    const ed = open(doc);

    const pos = connectUnits(ed, rootPos(ed, 0), rootPos(ed, 1), TAXONOMY);
    expect(pos).toBe(0);
    ed.state.doc.check();
    expect(ed.state.doc.nodeAt(pos!)?.type.name).toBe('bracket');

    const forest = forestOf(ed, doc);
    expect(forest).toHaveLength(3);
    expect(forest[0]).toEqual({
      kind: 'bracket',
      rel: 'Ser', // the default relationship
      prominent: null, // coordinate → no star
      children: [
        prop('a'),
        {
          kind: 'bracket',
          rel: 'Ser',
          prominent: null,
          children: [prop('b'), prop('c')],
        },
      ],
    });
    expect(forest[1]).toEqual(prop('d'));
    expect(forest[2]).toEqual(prop('e'));
    // No flag, no reversed key on a fresh coordinate bracket.
    expect(forest[0]).not.toHaveProperty('flag');
    expect(forest[0]).not.toHaveProperty('reversed');
  });

  it('accepts either argument order and always wraps in document order', () => {
    const doc = looseDoc();
    const ed = open(doc);
    // Pass the LATER root first: the bracket still reads a, b.
    const pos = connectUnits(ed, rootPos(ed, 1), rootPos(ed, 0), TAXONOMY, 'CndE');
    expect(pos).toBe(0);
    expect(forestOf(ed, doc)[0]).toMatchObject({
      rel: 'CndE',
      children: [prop('a'), prop('b')],
    });
  });

  it('applies the taxonomy default star and derives reversed for the new bracket', () => {
    let doc = looseDoc();
    let ed = open(doc);
    expect(connectUnits(ed, rootPos(ed, 0), rootPos(ed, 1), TAXONOMY, 'CndE')).toBe(0);
    // CndE starredLabel 1 → star on child 1, so the labels sit unreversed.
    expect(forestOf(ed, doc)[0]).toMatchObject({ prominent: 1 });
    expect(forestOf(ed, doc)[0]).not.toHaveProperty('reversed');
    ed.destroy();

    doc = looseDoc();
    ed = open(doc);
    expect(connectUnits(ed, rootPos(ed, 0), rootPos(ed, 1), TAXONOMY, 'Grnd')).toBe(0);
    expect(forestOf(ed, doc)[0]).toMatchObject({ rel: 'Grnd', prominent: 0 }); // starredLabel 0
    expect(forestOf(ed, doc)[0]).not.toHaveProperty('reversed');
  });

  it('rejects non-adjacent units, the same unit twice, containment and unknown rels', () => {
    const doc = disconnectedDoc(); // [ a, Ser[b,c], d, e ]
    const ed = open(doc);
    const before = ed.getJSON();

    expect(connectUnits(ed, rootPos(ed, 0), rootPos(ed, 2), TAXONOMY)).toBeNull(); // gap of 1
    expect(connectUnits(ed, rootPos(ed, 0), rootPos(ed, 3), TAXONOMY)).toBeNull(); // gap of 2
    expect(connectUnits(ed, rootPos(ed, 2), rootPos(ed, 2), TAXONOMY)).toBeNull(); // same root
    // Nested b to root d: unzipping b makes [a,b,c,d,e] — b and d are still a
    // gap apart, so nothing at all is dispatched (the unzip included).
    expect(connectUnits(ed, propPos(ed, 'b'), rootPos(ed, 2), TAXONOMY)).toBeNull();
    // The Ser bracket with its own child: containment is never a connection.
    expect(connectUnits(ed, rootPos(ed, 1), propPos(ed, 'b'), TAXONOMY)).toBeNull();
    expect(connectUnits(ed, rootPos(ed, 0), rootPos(ed, 1), TAXONOMY, 'Nope')).toBeNull();
    expect(connectUnits(ed, -1, rootPos(ed, 1), TAXONOMY)).toBeNull(); // out of range

    expect(ed.getJSON()).toEqual(before); // nothing dispatched
  });

  it('reconnects an already-connected pair: their bracket dissolves into the new one', () => {
    const doc = disconnectedDoc(); // [ a, Ser[b,c], d, e ]
    const ed = open(doc);
    // b and c both sit under the Ser bracket. Connecting them again dissolves
    // it and forms a fresh bracket with the requested relationship.
    const pos = connectUnits(ed, propPos(ed, 'b'), propPos(ed, 'c'), TAXONOMY, 'Grnd');
    expect(pos).not.toBeNull();
    ed.state.doc.check();
    const forest = forestOf(ed, doc);
    expect(forest).toEqual([
      prop('a'),
      { kind: 'bracket', rel: 'Grnd', prominent: 0, children: [prop('b'), prop('c')] },
      prop('d'),
      prop('e'),
    ]);
  });

  it('unzips nested units from different subtrees and connects them, in ONE undo step', () => {
    const doc = firstJohn16(); // CndE[ FtIn[p1, Adv[p2,p3]], Ser[p4,p5] ]
    const ed = open(doc);
    const before = ed.getJSON();
    // p3 (under CndE > FtIn > Adv) to p4 (under CndE > Ser): every bracket
    // above either one dissolves, then the two (now adjacent roots) connect.
    const pos = connectUnits(ed, propPos(ed, 'p3'), propPos(ed, 'p4'), TAXONOMY, 'CndE');
    expect(pos).not.toBeNull();
    ed.state.doc.check();
    expect(forestOf(ed, doc)).toEqual([
      prop('p1'),
      prop('p2'),
      { kind: 'bracket', rel: 'CndE', prominent: 1, children: [prop('p3'), prop('p4')] },
      prop('p5'),
    ]);
    expect(labelsOf(ed, doc)).toEqual(['6a', '6b', '6c', '6d', '6e']); // nothing relabeled

    expect(ed.commands.undo()).toBe(true); // unzips + connect are one step
    expect(ed.getJSON()).toEqual(before);
  });

  it('connects a nested BRACKET outward, keeping the bracket itself intact', () => {
    const doc = firstJohn16(); // CndE[ FtIn[p1, Adv[p2,p3]], Ser[p4,p5] ]
    const ed = open(doc);
    // The Adv bracket (nested under CndE > FtIn) to the Ser bracket (nested
    // under CndE): CndE and FtIn dissolve; Adv and Ser survive whole.
    const pos = connectUnits(ed, bracketPos(ed, 'Adv'), bracketPos(ed, 'Ser'), TAXONOMY, 'Inf');
    expect(pos).not.toBeNull();
    ed.state.doc.check();
    const forest = forestOf(ed, doc);
    expect(forest).toHaveLength(2);
    expect(forest[0]).toEqual(prop('p1'));
    expect(forest[1]).toMatchObject({
      kind: 'bracket',
      rel: 'Inf',
      children: [
        { kind: 'bracket', rel: 'Adv' },
        { kind: 'bracket', rel: 'Ser' },
      ],
    });
  });

  it('can rebuild a whole tree from loose roots, one adjacent pair at a time', () => {
    const doc = looseDoc();
    const ed = open(doc);
    expect(connectUnits(ed, rootPos(ed, 1), rootPos(ed, 2), TAXONOMY, 'CndE')).toBe(1);
    ed.state.doc.check();
    expect(ed.state.doc.childCount).toBe(2);
    expect(connectUnits(ed, rootPos(ed, 0), rootPos(ed, 1), TAXONOMY, 'Grnd')).toBe(0);
    ed.state.doc.check();

    expect(forestOf(ed, doc)).toEqual([
      {
        kind: 'bracket',
        rel: 'Grnd',
        prominent: 0,
        children: [
          prop('a'),
          { kind: 'bracket', rel: 'CndE', prominent: 1, children: [prop('b'), prop('c')] },
        ],
      },
    ]);
  });
});

describe('clearConnections', () => {
  it('leaves every proposition a root, in document order, in one undo step', () => {
    const doc = firstJohn16(); // CndE[ FtIn[p1, Adv[p2,p3]], Ser[p4,p5] ]
    const ed = open(doc);
    const propsBefore = nodeToDocument(ed.state.doc, doc).propositions;

    expect(clearConnections(ed)).toBe(true);
    ed.state.doc.check();

    const after = nodeToDocument(ed.state.doc, doc);
    expect(after.forest).toEqual(propsBefore.map((p) => ({ kind: 'prop', ref: p.id })));
    // The propositions themselves are untouched.
    expect(after.propositions).toEqual(propsBefore);

    ed.commands.undo();
    expect(nodeToDocument(ed.state.doc, doc).forest).toEqual(doc.forest);
  });

  it('does nothing when there is nothing connected', () => {
    const doc = looseDoc();
    const ed = open(doc);
    expect(clearConnections(ed)).toBe(false);
    expect(nodeToDocument(ed.state.doc, doc).forest).toEqual(doc.forest);
  });
});

describe('disconnectRoot', () => {
  it('replaces a root bracket with its children as adjacent roots', () => {
    const doc = disconnectedDoc();
    const ed = open(doc);
    expect(disconnectRoot(ed, rootPos(ed, 1))).toBe(true);
    ed.state.doc.check();

    expect(forestOf(ed, doc)).toEqual([
      prop('a'),
      prop('b'),
      prop('c'),
      prop('d'),
      prop('e'),
    ]);
  });

  it('dissolves only the outermost level, leaving inner brackets intact', () => {
    const doc = nestedDoc('Ser', null, 1); // CndE[ Ser[a,b], c ]
    const ed = open(doc);
    expect(disconnectRoot(ed, rootPos(ed, 0))).toBe(true);
    expect(forestOf(ed, doc)).toEqual([
      { kind: 'bracket', rel: 'Ser', prominent: null, children: [prop('a'), prop('b')] },
      prop('c'),
    ]);
  });

  it('refuses nested brackets and non-bracket positions', () => {
    const doc = firstJohn16();
    const ed = open(doc);
    const before = ed.getJSON();
    expect(disconnectRoot(ed, bracketPos(ed, 'FtIn'))).toBe(false); // nested
    expect(disconnectRoot(ed, bracketPos(ed, 'Adv'))).toBe(false); // deeper still
    expect(disconnectRoot(ed, propPos(ed, 'p1'))).toBe(false); // a proposition
    expect(ed.getJSON()).toEqual(before);
  });
});

describe('unzipToRoot', () => {
  it('dissolves every bracket above a proposition, in one undoable step', () => {
    const doc = firstJohn16();
    const ed = open(doc);
    const before = ed.getJSON();

    expect(unzipToRoot(ed, 'p2')).toBe(true);
    ed.state.doc.check();
    // CndE, FtIn and Adv are gone; the Ser packet never contained p2.
    expect(forestOf(ed, doc)).toEqual([
      prop('p1'),
      prop('p2'),
      prop('p3'),
      {
        kind: 'bracket',
        rel: 'Ser',
        prominent: null,
        flag: 'review',
        children: [prop('p4'), prop('p5')],
      },
    ]);
    expect(labelsOf(ed, doc)).toEqual(['6a', '6b', '6c', '6d', '6e']); // nothing relabeled

    expect(ed.commands.undo()).toBe(true);
    expect(ed.getJSON()).toEqual(before);
  });

  it('is a no-op on a proposition that is already a root, and false for unknown pids', () => {
    const doc = disconnectedDoc();
    const ed = open(doc);
    const before = ed.getJSON();
    expect(unzipToRoot(ed, 'a')).toBe(true);
    expect(ed.getJSON()).toEqual(before);
    expect(ed.can().undo()).toBe(false); // nothing dispatched
    expect(unzipToRoot(ed, 'nope')).toBe(false);
  });
});

describe('setRelationship', () => {
  it('derives reversed from the star and the taxonomy starred end', () => {
    const doc = pairDoc('Ser'); // coordinate
    const ed = open(doc);

    // Grnd stars label 0: the default star lands there → not reversed.
    expect(setRelationship(ed, 0, 'Grnd', TAXONOMY)).toBe(true);
    expect(ed.state.doc.child(0).attrs).toMatchObject({ prominent: 0, reversed: false });

    // CndE stars label 1 but the existing star (0) is kept → reversed.
    expect(setRelationship(ed, 0, 'CndE', TAXONOMY)).toBe(true);
    expect(ed.state.doc.child(0).attrs).toMatchObject({ prominent: 0, reversed: true });
    expect(forestOf(ed, doc)[0]).toMatchObject({ reversed: true });

    // Back to coordinate: no star, never reversed.
    expect(setRelationship(ed, 0, 'Ser', TAXONOMY)).toBe(true);
    expect(ed.state.doc.child(0).attrs).toMatchObject({ prominent: null, reversed: false });
    expect(forestOf(ed, doc)[0]).not.toHaveProperty('reversed');

    expect(setRelationship(ed, 0, 'Nope', TAXONOMY)).toBe(false);
  });

  it('clears reversed when the new relationship stars the same end', () => {
    const doc = pairDoc('Adv', 0); // Adv starredLabel 1, star on child 0 → reversed
    const ed = open(doc);
    expect(setRelationship(ed, 0, 'Grnd', TAXONOMY)).toBe(true); // starredLabel 0
    expect(ed.state.doc.child(0).attrs).toMatchObject({ prominent: 0, reversed: false });
  });

  it('never reverses a legacy n-ary bracket', () => {
    const doc = flatDoc('Ser'); // three children
    const ed = open(doc);
    expect(setRelationship(ed, 0, 'CndE', TAXONOMY)).toBe(true);
    expect(ed.state.doc.child(0).attrs).toMatchObject({ prominent: 1, reversed: false });
    // A star that is not the taxonomy's starred end still does not reverse.
    expect(setRelationship(ed, 0, 'Grnd', TAXONOMY)).toBe(true);
    expect(ed.state.doc.child(0).attrs).toMatchObject({ prominent: 1, reversed: false });
  });

  it('keeps a legacy review flag through relationship changes (no UI touches it)', () => {
    const doc = firstJohn16(); // the Ser packet carries flag: 'review'
    const ed = open(doc);
    const ser = bracketPos(ed, 'Ser');
    expect(setRelationship(ed, ser, 'Prog', TAXONOMY)).toBe(true);
    expect(ed.state.doc.nodeAt(ser)?.attrs.flag).toBe('review');
  });
});

describe('flipStar', () => {
  it('moves the star to the other child and re-derives reversed', () => {
    const doc = pairDoc('CndE', 1); // starredLabel 1, star there → not reversed
    const ed = open(doc);

    expect(flipStar(ed, 0, TAXONOMY)).toBe(true);
    expect(ed.state.doc.child(0).attrs).toMatchObject({ prominent: 0, reversed: true });
    expect(forestOf(ed, doc)[0]).toMatchObject({ prominent: 0, reversed: true });

    expect(flipStar(ed, 0, TAXONOMY)).toBe(true);
    expect(ed.state.doc.child(0).attrs).toMatchObject({ prominent: 1, reversed: false });
    expect(forestOf(ed, doc)[0]).not.toHaveProperty('reversed');
  });

  it('unreverses the fixture Adv bracket when the star returns to its starred end', () => {
    const doc = firstJohn16();
    const ed = open(doc);
    const adv = bracketPos(ed, 'Adv');
    expect(ed.state.doc.nodeAt(adv)?.attrs).toMatchObject({ prominent: 0, reversed: true });
    expect(flipStar(ed, adv, TAXONOMY)).toBe(true);
    expect(ed.state.doc.nodeAt(adv)?.attrs).toMatchObject({ prominent: 1, reversed: false });
  });

  it('refuses coordinate brackets, legacy n-ary brackets, props and unknown rels', () => {
    const coord = open(pairDoc('Ser'));
    expect(flipStar(coord, 0, TAXONOMY)).toBe(false); // coordinate: no star
    expect(flipStar(coord, propPos(coord, 'a'), TAXONOMY)).toBe(false); // a proposition
    coord.destroy();

    const nary = open(flatDoc('CndE', 1)); // three children
    const before = nary.getJSON();
    expect(flipStar(nary, 0, TAXONOMY)).toBe(false);
    expect(nary.getJSON()).toEqual(before);
    nary.destroy();

    const unknown = open(pairDoc('Nope', 1));
    expect(flipStar(unknown, 0, TAXONOMY)).toBe(false);
  });
});

describe('splitProposition', () => {
  it('splits a root proposition into two roots and re-letters the verse labels', () => {
    const doc = disconnectedDoc(); // [ a, Ser[b,c], d, e ]
    const ed = open(doc);
    // d = τῷ σκότει περιπατῶμεν, ψευδόμεθα (124780–124783): 2 words in the first half.
    expect(splitProposition(ed, propPos(ed, 'd'), 2, WORD_MAP)).toBe(true);
    ed.state.doc.check();

    const out = nodeToDocument(ed.state.doc, doc);
    expect(out.forest).toHaveLength(5); // one more root than before
    expect(out.forest[2]).toEqual(prop('d'));
    expect(out.forest[3]).toMatchObject({ kind: 'prop' });
    // Five corpus propositions now sit in verse 6, so the letters re-derive
    // a–e; the raw proposition keeps its own label.
    expect(out.propositions.map((p) => p.label)).toEqual(['6a', '6b', '6c', '6d', '6e', '6e']);
    expect(out.propositions[3]?.source).toEqual({ kind: 'corpus', start: 124780, end: 124781 });
    expect(out.propositions[4]?.source).toEqual({ kind: 'corpus', start: 124782, end: 124783 });
    expect(out.propositions[3]?.id).toBe('d'); // first half keeps the pid
    expect(new Set(out.propositions.map((p) => p.id)).size).toBe(6); // second is fresh
  });

  it('labels single-verse propositions with letters and cross-verse ones with spans', () => {
    const doc: AnalysisDocument = {
      schemaVersion: 2,
      propositions: [{
        id: 'x', label: '6–7',
        source: { kind: 'corpus', start: 124771, end: 124791 }, // spans 1:6–1:7
      }],
      forest: [{ kind: 'prop', ref: 'x' }],
    };
    const ed = open(doc);

    // First split: the head sits in verse 6 alone (unlettered), the rest
    // still spans into verse 7.
    expect(splitProposition(ed, propPos(ed, 'x'), 2, WORD_MAP)).toBe(true);
    let out = nodeToDocument(ed.state.doc, doc);
    expect(out.propositions.map((p) => p.label)).toEqual(['6', '6–7']);

    // Second split, still inside verse 6: the two verse-6 propositions
    // letter up while the tail keeps its span.
    const rest = out.propositions[1]!.id;
    expect(splitProposition(ed, propPos(ed, rest), 4, WORD_MAP)).toBe(true);
    out = nodeToDocument(ed.state.doc, doc);
    expect(out.propositions.map((p) => p.label)).toEqual(['6a', '6b', '6–7']);
  });

  it('unzips a nested proposition first: its ancestors dissolve, both halves are roots', () => {
    const doc = firstJohn16();
    const ed = open(doc);
    // p2 = ὅτι κοινωνίαν ἔχομεν μετ’ αὐτοῦ (124773–124777), buried under
    // CndE > FtIn > Adv.
    expect(splitProposition(ed, propPos(ed, 'p2'), 2, WORD_MAP)).toBe(true);
    ed.state.doc.check();

    const out = nodeToDocument(ed.state.doc, doc);
    // CndE, FtIn and Adv are gone; the untouched Ser packet survives.
    expect(out.forest).toHaveLength(5);
    expect(out.forest.slice(0, 4)).toEqual([
      prop('p1'),
      prop('p2'),
      { kind: 'prop', ref: out.propositions[2]!.id },
      prop('p3'),
    ]);
    expect(out.forest[4]).toMatchObject({ kind: 'bracket', rel: 'Ser', flag: 'review' });
    // The five corpus propositions re-letter a–e; the raw one keeps '6e'.
    expect(out.propositions.map((p) => p.label)).toEqual([
      '6a', '6b', '6c', '6d', '6e', '6e',
    ]);
    expect(out.propositions[1]?.source).toEqual({ kind: 'corpus', start: 124773, end: 124774 });
    expect(out.propositions[2]?.source).toEqual({ kind: 'corpus', start: 124775, end: 124777 });
    // p3 keeps its identity, source and colour — only its letter moved on.
    expect(out.propositions[3]).toEqual({ ...doc.propositions[2], label: '6d' });
  });

  it('splits a raw proposition by whitespace tokens', () => {
    const doc = firstJohn16();
    const ed = open(doc);
    // p5 raw: καὶ οὐ ποιοῦμεν τὴν ἀλήθειαν· → 2 tokens in the first half.
    expect(splitProposition(ed, propPos(ed, 'p5'), 2, WORD_MAP)).toBe(true);
    const out = nodeToDocument(ed.state.doc, doc);
    expect(out.propositions).toHaveLength(6);
    expect(out.propositions[4]?.source).toEqual({ kind: 'raw', text: 'καὶ οὐ' });
    expect(out.propositions[5]?.source).toEqual({ kind: 'raw', text: 'ποιοῦμεν τὴν ἀλήθειαν·' });
    expect(out.propositions[5]?.label).toBe('6e′');
    // Only the Ser packet holding p5 (and the root above it) came apart.
    expect(out.forest).toHaveLength(4);
    expect(out.forest[0]).toMatchObject({ kind: 'bracket', rel: 'FtIn' });
  });

  it('rejects out-of-range split points and non-propositions, dispatching nothing', () => {
    const doc = firstJohn16();
    const ed = open(doc);
    const before = ed.getJSON();
    expect(splitProposition(ed, propPos(ed, 'p4'), 1, WORD_MAP)).toBe(false); // single word
    expect(splitProposition(ed, propPos(ed, 'p2'), 0, WORD_MAP)).toBe(false);
    expect(splitProposition(ed, propPos(ed, 'p2'), 5, WORD_MAP)).toBe(false); // == total
    expect(splitProposition(ed, propPos(ed, 'p2'), 2, null)).toBe(false); // corpus needs words
    expect(splitProposition(ed, 0, 1, WORD_MAP)).toBe(false); // a bracket
    expect(ed.getJSON()).toEqual(before);
  });
});

describe('mergeBelow', () => {
  it('merges across two trees, unzipping both and re-joining contiguous ranges', () => {
    const doc = firstJohn16();
    const ed = open(doc);
    // p3 sits under CndE > FtIn > Adv; p4 under CndE > Ser. Their corpus
    // ranges are contiguous (…124782 | 124783…).
    expect(mergeBelow(ed, 'p3', WORD_MAP)).toBe(true);
    ed.state.doc.check();

    const out = nodeToDocument(ed.state.doc, doc);
    expect(out.forest).toEqual([prop('p1'), prop('p2'), prop('p3'), prop('p5')]);
    expect(out.propositions).toHaveLength(4);
    expect(out.propositions[2]).toMatchObject({
      id: 'p3', // the first proposition's identity survives
      label: '6c',
      color: '#1d4ed8',
      source: { kind: 'corpus', start: 124778, end: 124783 },
    });
    expect(out.propositions.map((p) => p.label)).toEqual(['6a', '6b', '6c', '6e']);
  });

  it('unzips only what needs it when one side is already a root', () => {
    const doc = disconnectedDoc(); // [ a, Ser[b,c], d, e ]
    const ed = open(doc);
    expect(mergeBelow(ed, 'a', WORD_MAP)).toBe(true);
    const out = nodeToDocument(ed.state.doc, doc);
    expect(out.forest).toEqual([prop('a'), prop('c'), prop('d'), prop('e')]);
    expect(out.propositions[0]?.source).toEqual({ kind: 'corpus', start: 124771, end: 124777 });
  });

  it('degrades to a raw source when the two sources are not contiguous', () => {
    const doc = firstJohn16();
    const ed = open(doc);
    // p4 is corpus, p5 is raw → no range to join.
    expect(mergeBelow(ed, 'p4', WORD_MAP)).toBe(true);
    const out = nodeToDocument(ed.state.doc, doc);
    expect(out.propositions).toHaveLength(4);
    expect(out.propositions[3]).toMatchObject({
      id: 'p4',
      label: '6d',
      source: { kind: 'raw', text: `ψευδόμεθα ${RAW_1JOHN_1_6E}` },
    });
  });

  it('degrades when corpus ranges leave a gap', () => {
    const doc = disconnectedDoc();
    doc.propositions[0]!.source = { kind: 'corpus', start: 124771, end: 124772 };
    doc.propositions[1]!.source = { kind: 'corpus', start: 124778, end: 124779 };
    const ed = open(doc);
    expect(mergeBelow(ed, 'a', WORD_MAP)).toBe(true);
    expect(nodeToDocument(ed.state.doc, doc).propositions[0]?.source.kind).toBe('raw');
  });

  it('refuses the last proposition and unknown pids', () => {
    const doc = firstJohn16();
    const ed = open(doc);
    const before = ed.getJSON();
    expect(mergeBelow(ed, 'p5', WORD_MAP)).toBe(false); // last in document order
    expect(mergeBelow(ed, 'nope', WORD_MAP)).toBe(false);
    expect(ed.getJSON()).toEqual(before);
  });
});

describe('addSectionBreak / removeSectionBreak', () => {
  it('is an ordinary transaction: one undo step, shared history', () => {
    const doc = looseDoc(); // props a, b, c
    const ed = open(doc);
    const breaks = () => nodeToDocument(ed.state.doc, doc).sections;
    expect(breaks()).toBeUndefined();

    expect(addSectionBreak(ed, 'b')).toBe(true);
    expect(breaks()).toEqual([{ start: 'b', color: 1 }]);

    expect(ed.commands.undo()).toBe(true);
    expect(breaks()).toBeUndefined();
    expect(ed.commands.redo()).toBe(true);
    expect(breaks()).toEqual([{ start: 'b', color: 1 }]);

    expect(removeSectionBreak(ed, 'b')).toBe(true);
    expect(breaks()).toBeUndefined();
    expect(ed.commands.undo()).toBe(true);
    expect(breaks()).toEqual([{ start: 'b', color: 1 }]);
  });

  it('touches only the proposition whose block start changed', () => {
    const doc = looseDoc();
    const ed = open(doc);
    const attrsOf = (pid: string) => ed.state.doc.nodeAt(propPos(ed, pid))?.attrs;
    const aBefore = attrsOf('a');
    const cBefore = attrsOf('c');
    expect(addSectionBreak(ed, 'b')).toBe(true);
    // Only 'b' carries a block start; its neighbours' attrs are untouched,
    // which is what keeps their rows from re-rendering.
    expect(attrsOf('b')?.blockColor).toBe(1);
    expect(attrsOf('a')).toEqual(aBefore);
    expect(attrsOf('c')).toEqual(cBefore);
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
    expect(splitProposition(ed, propPos(ed, 'b'), 1, null)).toBe(true);
    expect(nodeToDocument(ed.state.doc, doc).sections).toEqual([{ start: 'b', color: 1 }]);
  });

  it('merging across a break dissolves it on emit — and undoing the merge restores it', () => {
    const doc = looseDoc();
    const ed = open(doc);
    expect(addSectionBreak(ed, 'b')).toBe(true);
    expect(mergeBelow(ed, 'a', null)).toBe(true); // 'b' is gone: a absorbs it
    expect('sections' in nodeToDocument(ed.state.doc, doc)).toBe(false);
    // The attr still names 'b' (pruning is emit-only), so undo brings it back.
    expect(ed.commands.undo()).toBe(true);
    expect(nodeToDocument(ed.state.doc, doc).sections).toEqual([{ start: 'b', color: 1 }]);
  });

  it('a block keeps its color when the block above it is removed', () => {
    const doc = looseDoc(); // props a, b, c
    const ed = open(doc);
    expect(addSectionBreak(ed, 'b')).toBe(true); // block b takes color 1
    expect(addSectionBreak(ed, 'c')).toBe(true); // block c takes color 2
    expect(removeSectionBreak(ed, 'b')).toBe(true);
    // c's block still wears ITS color, not a re-derived one.
    expect(nodeToDocument(ed.state.doc, doc).sections).toEqual([{ start: 'c', color: 2 }]);
  });
});

describe('history', () => {
  it('undoes a connect in one step and redoes it', () => {
    const doc = looseDoc();
    const ed = open(doc);
    const before = ed.getJSON();

    expect(connectUnits(ed, rootPos(ed, 0), rootPos(ed, 1), TAXONOMY, 'CndE')).toBe(0);
    const after = ed.getJSON();
    expect(after).not.toEqual(before);

    expect(ed.commands.undo()).toBe(true);
    expect(ed.getJSON()).toEqual(before);
    expect(ed.commands.redo()).toBe(true);
    expect(ed.getJSON()).toEqual(after);
  });

  it('undoes a split (unzip included) in one step', () => {
    const doc = firstJohn16();
    const ed = open(doc);
    const before = ed.getJSON();
    expect(splitProposition(ed, propPos(ed, 'p2'), 2, WORD_MAP)).toBe(true);
    expect(ed.commands.undo()).toBe(true);
    expect(ed.getJSON()).toEqual(before);
    expect(nodeToDocument(ed.state.doc, doc)).toEqual(doc);
  });

  it('undoes a merge (both unzips included) in one step', () => {
    const doc = firstJohn16();
    const ed = open(doc);
    const before = ed.getJSON();
    expect(mergeBelow(ed, 'p3', WORD_MAP)).toBe(true);
    expect(ed.commands.undo()).toBe(true);
    expect(ed.getJSON()).toEqual(before);
    expect(nodeToDocument(ed.state.doc, doc)).toEqual(doc);
  });

  it('undoes a disconnect', () => {
    const doc = disconnectedDoc();
    const ed = open(doc);
    const before = ed.getJSON();
    expect(disconnectRoot(ed, rootPos(ed, 1))).toBe(true);
    expect(ed.commands.undo()).toBe(true);
    expect(ed.getJSON()).toEqual(before);
  });
});

describe('nodeToDocument after editing', () => {
  it('carries sources, labels and colors through connect + disconnect by pid', () => {
    const doc = firstJohn16();
    const ed = open(doc);

    // Take the passage apart down to loose propositions…
    expect(unzipToRoot(ed, 'p5')).toBe(true);
    expect(unzipToRoot(ed, 'p2')).toBe(true);
    expect(ed.state.doc.childCount).toBe(5);

    // …then reconnect two of them under a new relationship.
    const pos = connectUnits(ed, rootPos(ed, 3), rootPos(ed, 4), TAXONOMY, 'NegPos');
    expect(pos).not.toBeNull();
    ed.state.doc.check();

    const out = nodeToDocument(ed.state.doc, doc);
    expect(out.propositions).toEqual(doc.propositions); // untouched
    expect(out.schemaVersion).toBe(2);
    expect(out.forest).toEqual([
      prop('p1'),
      prop('p2'),
      prop('p3'),
      {
        kind: 'bracket',
        rel: 'NegPos',
        prominent: 1, // NegPos starredLabel = 1
        children: [prop('p4'), prop('p5')],
      },
    ]);
  });

  it('keeps a legacy n-ary bracket intact through unrelated edits', () => {
    const doc = flatDoc('CndE', 2);
    const ed = open(doc);
    expect(setRelationship(ed, 0, 'MEd', TAXONOMY)).toBe(true);
    const out = nodeToDocument(ed.state.doc, doc);
    expect((out.forest[0] as BracketNode).children).toHaveLength(3);
    expect(out.forest[0]).toMatchObject({ rel: 'MEd', prominent: 2 });
  });
});

describe('deleteRelationship', () => {
  it('leaves a hole where a nested relationship was, and everything above it', () => {
    const doc = firstJohn16(); // CndE[ FtIn[p1, Adv[p2,p3]], Ser[p4,p5] ]
    const ed = open(doc);
    expect(deleteRelationship(ed, bracketPos(ed, 'Adv'))).toBe(true);
    ed.state.doc.check();

    // Adv is gone; p2 and p3 wait unattached in its slot, and FtIn and CndE
    // — the structure the analyst wants to keep — are untouched.
    expect(forestOf(ed, doc)).toEqual([
      {
        kind: 'bracket',
        rel: 'CndE',
        prominent: 1,
        children: [
          {
            kind: 'bracket',
            rel: 'FtIn',
            prominent: 1,
            children: [prop('p1'), { kind: 'hole', children: [prop('p2'), prop('p3')] }],
          },
          { kind: 'bracket', rel: 'Ser', prominent: null, flag: 'review', children: [prop('p4'), prop('p5')] },
        ],
      },
    ]);
  });

  it('gives a root bracket no hole — its children are roots, already unattached', () => {
    const doc = disconnectedDoc();
    const ed = open(doc);
    expect(deleteRelationship(ed, rootPos(ed, 1))).toBe(true);
    expect(forestOf(ed, doc)).toEqual([prop('a'), prop('b'), prop('c'), prop('d'), prop('e')]);
  });

  it('re-connecting what waits in a hole makes the tree whole again', () => {
    const doc = firstJohn16();
    const ed = open(doc);
    const before = ed.getJSON();
    deleteRelationship(ed, bracketPos(ed, 'Adv'));
    // The two loose units are adjacent inside the hole: joining them fills the
    // slot, and the hole — now holding one unit — collapses into it.
    expect(connectUnits(ed, propPos(ed, 'p2'), propPos(ed, 'p3'), TAXONOMY, 'Adv')).not.toBeNull();
    ed.state.doc.check();
    const rebuilt = forestOf(ed, doc);
    // No hole left: the slot holds a bracket again, in the same place. The
    // star is the taxonomy's default — a re-connection is a NEW relationship,
    // not the old one restored (undo is what restores).
    expect(JSON.stringify(rebuilt)).not.toContain('"hole"');
    expect(rebuilt).toEqual([
      {
        kind: 'bracket',
        rel: 'CndE',
        prominent: 1,
        children: [
          {
            kind: 'bracket',
            rel: 'FtIn',
            prominent: 1,
            children: [
              prop('p1'),
              { kind: 'bracket', rel: 'Adv', prominent: 1, children: [prop('p2'), prop('p3')] },
            ],
          },
          {
            kind: 'bracket',
            rel: 'Ser',
            prominent: null,
            flag: 'review',
            children: [prop('p4'), prop('p5')],
          },
        ],
      },
    ]);

    ed.commands.undo();
    ed.commands.undo();
    expect(ed.getJSON()).toEqual(before);
  });
});
