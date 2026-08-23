// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import type { Editor } from '@tiptap/core';
import { buildTextById, documentToNode } from '../convert';
import { buildEditor } from '../editor';
import { findPropositionPos } from '../commands';
import { unitRangeInfo } from '../selection';
import { CORPUS_WORDS, firstJohn16 } from './fixtures';

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function open(): Editor {
  const doc = firstJohn16();
  editor = buildEditor([], documentToNode(doc, buildTextById(doc, CORPUS_WORDS)));
  return editor;
}

function pos(ed: Editor, pid: string): number {
  const p = findPropositionPos(ed.state.doc, pid);
  if (p === null) throw new Error(`no proposition '${pid}'`);
  return p;
}

describe('unitRangeInfo', () => {
  it('a single clicked unit covers itself', () => {
    const ed = open();
    const p4 = pos(ed, 'p4');
    const info = unitRangeInfo(ed.state.doc, p4, p4);
    expect(info).not.toBeNull();
    expect(info?.count).toBe(1);
    expect(info?.pids).toEqual(['p4']);
  });

  it('two sibling props cover exactly themselves', () => {
    const ed = open();
    const info = unitRangeInfo(ed.state.doc, pos(ed, 'p4'), pos(ed, 'p5'));
    expect(info?.count).toBe(2);
    expect(info?.pids).toEqual(['p4', 'p5']);
  });

  it('a prop and a nested prop expand to the covering siblings', () => {
    const ed = open();
    // p1 is FtIn's first child; p3 lives inside the Adv bracket (FtIn's
    // second child): the covering run is FtIn's two children.
    const info = unitRangeInfo(ed.state.doc, pos(ed, 'p1'), pos(ed, 'p3'));
    expect(info?.count).toBe(2);
    expect(info?.pids).toEqual(['p1', 'p2', 'p3']);
  });

  it('props under different top-level packets cover the whole root', () => {
    const ed = open();
    // p3 (protasis side) + p4 (apodosis side) → the root CndE's two children.
    const info = unitRangeInfo(ed.state.doc, pos(ed, 'p3'), pos(ed, 'p4'));
    expect(info?.count).toBe(2);
    expect(info?.pids).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
  });

  it('order of clicks does not matter', () => {
    const ed = open();
    const forward = unitRangeInfo(ed.state.doc, pos(ed, 'p4'), pos(ed, 'p5'));
    const backward = unitRangeInfo(ed.state.doc, pos(ed, 'p5'), pos(ed, 'p4'));
    expect(backward).toEqual(forward);
  });

  it('returns null for positions not on a unit', () => {
    const ed = open();
    expect(unitRangeInfo(ed.state.doc, 10_000, 10_001)).toBeNull();
  });
});
