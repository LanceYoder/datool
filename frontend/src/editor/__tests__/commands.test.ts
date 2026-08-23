// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import type { Editor } from '@tiptap/core';
import type { Document as AnalysisDocument } from '../../types';
import { buildTextById, documentToNode, nodeToDocument } from '../convert';
import { buildEditor } from '../editor';
import {
  confirmFlag,
  findBrackets,
  findPropositionPos,
  liftBracket,
  setFlag,
  setProminent,
  setRelationship,
  toggleReversed,
  wrapUnits,
} from '../commands';
import { CORPUS_WORDS, TAXONOMY, firstJohn16, flatDoc, nestedDoc } from './fixtures';

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

/** [from, to] covering the props from pidStart through pidEnd inclusive. */
function propRange(ed: Editor, pidStart: string, pidEnd: string): [number, number] {
  return [propPos(ed, pidStart), propPos(ed, pidEnd) + 1];
}

describe('wrapUnits', () => {
  it('wraps two adjacent props with the taxonomy default prominent (subordinate)', () => {
    const doc = flatDoc('Ser');
    const ed = open(doc);
    const [from, to] = propRange(ed, 'a', 'b');

    expect(wrapUnits(ed, from, to, 'CndE', TAXONOMY)).toBe(true);
    ed.state.doc.check();

    const out = nodeToDocument(ed.state.doc, doc);
    expect(out.tree).toEqual({
      kind: 'bracket',
      rel: 'Ser',
      prominent: null,
      children: [
        {
          kind: 'bracket',
          rel: 'CndE',
          prominent: 1, // CndE starredLabel = 1
          children: [
            { kind: 'prop', ref: 'a' },
            { kind: 'prop', ref: 'b' },
          ],
        },
        { kind: 'prop', ref: 'c' },
      ],
    });
  });

  it('uses starredLabel 0 defaults and null for coordinate relationships', () => {
    const doc = flatDoc('Ser');
    let ed = open(doc);
    let [from, to] = propRange(ed, 'b', 'c');
    expect(wrapUnits(ed, from, to, 'Grnd', TAXONOMY)).toBe(true); // starredLabel 0
    let out = nodeToDocument(ed.state.doc, doc);
    expect(out.tree).toMatchObject({
      children: [
        { kind: 'prop', ref: 'a' },
        { kind: 'bracket', rel: 'Grnd', prominent: 0 },
      ],
    });
    ed.destroy();

    ed = open(doc);
    [from, to] = propRange(ed, 'b', 'c');
    expect(wrapUnits(ed, from, to, 'Alt', TAXONOMY)).toBe(true); // coordinate
    out = nodeToDocument(ed.state.doc, doc);
    expect(out.tree).toMatchObject({
      children: [
        { kind: 'prop', ref: 'a' },
        { kind: 'bracket', rel: 'Alt', prominent: null },
      ],
    });
  });

  it('expands to the covering siblings across nested brackets', () => {
    const doc = firstJohn16();
    const ed = open(doc);
    // p3 sits inside the FtIn packet, p4 in the flagged Ser: the covering
    // siblings are ALL children of the root CndE → rejected (root would be
    // left with a single child).
    const [from, to] = propRange(ed, 'p3', 'p4');
    expect(wrapUnits(ed, from, to, 'Adv', TAXONOMY)).toBe(false);

    // p1..p3 covers p1 + the Adv bracket — ALL children of FtIn → rejected.
    const [f2, t2] = propRange(ed, 'p1', 'p3');
    expect(wrapUnits(ed, f2, t2, 'Grnd', TAXONOMY)).toBe(false);
    const out = nodeToDocument(ed.state.doc, doc);
    expect(out).toEqual(doc); // nothing changed
  });

  it('re-indexes the parent star around the wrapped run', () => {
    // Star past the run shifts left: CndE[a, b, c*] → CndE[Grnd[a,b], c*].
    let doc = flatDoc('CndE', 2);
    let ed = open(doc);
    let [from, to] = propRange(ed, 'a', 'b');
    expect(wrapUnits(ed, from, to, 'Grnd', TAXONOMY)).toBe(true);
    ed.state.doc.check();
    expect(ed.state.doc.child(0).attrs.prominent).toBe(1);
    ed.destroy();

    // Star inside the run moves to the new packet: CndE[a, b*, c] → packet at 0.
    doc = flatDoc('CndE', 1);
    ed = open(doc);
    [from, to] = propRange(ed, 'a', 'b');
    expect(wrapUnits(ed, from, to, 'Grnd', TAXONOMY)).toBe(true);
    expect(ed.state.doc.child(0).attrs.prominent).toBe(0);
    ed.destroy();

    // Star before the run is untouched: CndE[a*, b, c] wrap b..c.
    doc = flatDoc('CndE', 0);
    ed = open(doc);
    [from, to] = propRange(ed, 'b', 'c');
    expect(wrapUnits(ed, from, to, 'Grnd', TAXONOMY)).toBe(true);
    expect(ed.state.doc.child(0).attrs.prominent).toBe(0);
  });

  it('rejects single, empty, inverted, unknown-rel, and whole-bracket selections', () => {
    const doc = flatDoc('Ser');
    const ed = open(doc);
    const before = ed.getJSON();
    const [fromA, toA] = propRange(ed, 'a', 'a');

    expect(wrapUnits(ed, fromA, toA, 'CndE', TAXONOMY)).toBe(false); // single prop
    expect(wrapUnits(ed, fromA, fromA, 'CndE', TAXONOMY)).toBe(false); // empty
    expect(wrapUnits(ed, toA, fromA, 'CndE', TAXONOMY)).toBe(false); // inverted
    expect(wrapUnits(ed, fromA, toA + 1, 'Nope', TAXONOMY)).toBe(false); // unknown rel
    const [f, t] = propRange(ed, 'a', 'c');
    expect(wrapUnits(ed, f, t, 'CndE', TAXONOMY)).toBe(false); // all children → parent left with 1
    expect(wrapUnits(ed, -1, 2, 'CndE', TAXONOMY)).toBe(false); // out of range

    expect(ed.getJSON()).toEqual(before); // nothing dispatched
  });
});

describe('liftBracket', () => {
  it('splices children into the parent and re-indexes prominent past the splice', () => {
    const doc = nestedDoc('Ser', null, 1); // CndE*[ Ser(a,b), c ], prominent = c
    const ed = open(doc);
    expect(liftBracket(ed, bracketPos(ed, 'Ser'))).toBe(true);
    ed.state.doc.check();

    const out = nodeToDocument(ed.state.doc, doc);
    expect(out.tree).toEqual({
      kind: 'bracket',
      rel: 'CndE',
      prominent: 2, // still points at c after the 2-for-1 splice
      children: [
        { kind: 'prop', ref: 'a' },
        { kind: 'prop', ref: 'b' },
        { kind: 'prop', ref: 'c' },
      ],
    });
    expect(out.propositions).toEqual(doc.propositions);
  });

  it('moves the star to the lifted bracket own prominent child when it was prominent', () => {
    const doc = nestedDoc('FtIn', 1, 0); // CndE[ FtIn(a, b*)…, c ], outer prominent = the FtIn bracket
    const ed = open(doc);
    expect(liftBracket(ed, bracketPos(ed, 'FtIn'))).toBe(true);
    const out = nodeToDocument(ed.state.doc, doc);
    expect(out.tree).toMatchObject({ rel: 'CndE', prominent: 1 }); // 0 + inner prominent 1
  });

  it('keeps prominent when a coordinate bracket in first position was prominent', () => {
    const doc = nestedDoc('Ser', null, 0);
    const ed = open(doc);
    expect(liftBracket(ed, bracketPos(ed, 'Ser'))).toBe(true);
    const out = nodeToDocument(ed.state.doc, doc);
    expect(out.tree).toMatchObject({ rel: 'CndE', prominent: 0 });
  });

  it('refuses to lift the root bracket or a non-bracket position', () => {
    const doc = flatDoc('Ser');
    const ed = open(doc);
    const before = ed.getJSON();
    expect(liftBracket(ed, 0)).toBe(false); // root bracket → >1 top-level units
    expect(liftBracket(ed, propPos(ed, 'a'))).toBe(false); // a proposition
    expect(ed.getJSON()).toEqual(before);
  });
});

describe('setRelationship / setProminent / toggleReversed / flags', () => {
  it('fixes prominent across coordinate↔subordinate changes', () => {
    const doc = flatDoc('Ser');
    const ed = open(doc);

    expect(setRelationship(ed, 0, 'CndE', TAXONOMY)).toBe(true);
    let root = ed.state.doc.child(0);
    expect(root.attrs.rel).toBe('CndE');
    expect(root.attrs.prominent).toBe(1); // default from starredLabel

    expect(setProminent(ed, 0, 2)).toBe(true);
    expect(setRelationship(ed, 0, 'CE', TAXONOMY)).toBe(true);
    root = ed.state.doc.child(0);
    expect(root.attrs.prominent).toBe(2); // subordinate→subordinate keeps it

    expect(setRelationship(ed, 0, 'Ser', TAXONOMY)).toBe(true);
    root = ed.state.doc.child(0);
    expect(root.attrs.prominent).toBeNull(); // coordinate → null

    expect(setRelationship(ed, 0, 'Nope', TAXONOMY)).toBe(false);
  });

  it('keeps the flag through relationship changes', () => {
    const doc = flatDoc('Ser');
    const ed = open(doc);
    expect(setFlag(ed, 0)).toBe(true);
    expect(setRelationship(ed, 0, 'CndE', TAXONOMY)).toBe(true);
    expect(ed.state.doc.child(0).attrs.flag).toBe('review');
    expect(confirmFlag(ed, 0)).toBe(true);
    expect(ed.state.doc.child(0).attrs.flag).toBeNull();
  });

  it('setProminent validates coordinate-ness and range', () => {
    const doc = flatDoc('Ser'); // coordinate root
    const ed = open(doc);
    expect(setProminent(ed, 0, 1)).toBe(false); // coordinate: no star allowed

    expect(setRelationship(ed, 0, 'CndE', TAXONOMY)).toBe(true);
    expect(setProminent(ed, 0, 3)).toBe(false); // out of range
    expect(setProminent(ed, 0, -1)).toBe(false);
    expect(setProminent(ed, 0, 0)).toBe(true);
    expect(ed.state.doc.child(0).attrs.prominent).toBe(0);
  });

  it('toggleReversed flips and survives conversion', () => {
    const doc = flatDoc('CndE', 1);
    const ed = open(doc);
    expect(toggleReversed(ed, 0)).toBe(true);
    expect(nodeToDocument(ed.state.doc, doc).tree).toMatchObject({ reversed: true });
    expect(toggleReversed(ed, 0)).toBe(true);
    expect((nodeToDocument(ed.state.doc, doc).tree as { reversed?: boolean }).reversed).toBeUndefined();
  });
});

describe('history', () => {
  it('undo after wrap restores the prior doc; redo re-applies it', () => {
    const doc = flatDoc('Ser');
    const ed = open(doc);
    const before = ed.getJSON();

    const [from, to] = propRange(ed, 'a', 'b');
    expect(wrapUnits(ed, from, to, 'CndE', TAXONOMY)).toBe(true);
    const after = ed.getJSON();
    expect(after).not.toEqual(before);

    expect(ed.commands.undo()).toBe(true);
    expect(ed.getJSON()).toEqual(before);

    expect(ed.commands.redo()).toBe(true);
    expect(ed.getJSON()).toEqual(after);
  });
});

describe('nodeToDocument after editing', () => {
  it('preserves sources, labels, and colors via pids through a lift + wrap', () => {
    const doc = firstJohn16();
    const ed = open(doc);
    const [from, to] = propRange(ed, 'p4', 'p5');
    // p4..p5 are the two children of the review-flagged Ser: wrapping ALL of
    // them is rejected (their parent would be left with one child).
    expect(wrapUnits(ed, from, to, 'NegPos', TAXONOMY)).toBe(false);

    // Restructure the protasis: dissolve the Adv bracket (FtIn becomes
    // p1,p2,p3 with the star following Adv's own prominent child p2)…
    expect(liftBracket(ed, bracketPos(ed, 'Adv'))).toBe(true);
    expect(ed.state.doc.child(0).child(0).attrs.prominent).toBe(1); // 1 + inner 0

    // …then wrap p2..p3 as Temporal (two of FtIn's three children → wraps).
    const [f2, t2] = propRange(ed, 'p2', 'p3');
    expect(wrapUnits(ed, f2, t2, 'Tmp', TAXONOMY)).toBe(true);
    ed.state.doc.check();

    const out = nodeToDocument(ed.state.doc, doc);
    expect(out.propositions).toEqual(doc.propositions); // carried over untouched
    expect(out.tree).toMatchObject({
      rel: 'CndE',
      prominent: 1,
      children: [
        {
          rel: 'FtIn',
          children: [
            { kind: 'prop', ref: 'p1' },
            {
              kind: 'bracket',
              rel: 'Tmp',
              prominent: 1, // Tmp starredLabel = 1
              children: [
                { kind: 'prop', ref: 'p2' },
                { kind: 'prop', ref: 'p3' },
              ],
            },
          ],
        },
        { rel: 'Ser', flag: 'review' },
      ],
    });
  });
});
