import { describe, expect, it } from 'vitest';
import {
  SECTION_COLORS,
  addBreak,
  pruneBreaks,
  removeBreak,
  sectionColor,
  sectionIndexByPid,
  sectionsOf,
} from '../sections';

const PIDS = ['p1', 'p2', 'p3', 'p4', 'p5'];

describe('pruneBreaks', () => {
  it('drops breaks on propositions that are gone', () => {
    expect(pruneBreaks(['p2', 'gone', 'p4'], PIDS)).toEqual(['p2', 'p4']);
  });

  it('drops a break on the first proposition — the document already starts one', () => {
    expect(pruneBreaks(['p1', 'p3'], PIDS)).toEqual(['p3']);
  });

  it('drops duplicates and sorts into proposition order', () => {
    expect(pruneBreaks(['p4', 'p2', 'p4'], PIDS)).toEqual(['p2', 'p4']);
  });
});

describe('sectionsOf', () => {
  it('is one block holding everything when nothing is divided', () => {
    expect(sectionsOf(PIDS, [])).toEqual([{ index: 0, pids: PIDS }]);
  });

  it('starts a new block at each break', () => {
    expect(sectionsOf(PIDS, ['p2', 'p5'])).toEqual([
      { index: 0, pids: ['p1'] },
      { index: 1, pids: ['p2', 'p3', 'p4'] },
      { index: 2, pids: ['p5'] },
    ]);
  });

  it('maps every proposition to its block', () => {
    const byPid = sectionIndexByPid(PIDS, ['p3']);
    expect([...byPid.values()]).toEqual([0, 0, 1, 1, 1]);
  });
});

describe('addBreak / removeBreak', () => {
  it('adds in proposition order and ignores a repeat', () => {
    expect(addBreak(['p4'], PIDS, 'p2')).toEqual(['p2', 'p4']);
    expect(addBreak(['p2'], PIDS, 'p2')).toEqual(['p2']);
  });

  it('refuses to divide before the first proposition', () => {
    expect(addBreak([], PIDS, 'p1')).toEqual([]);
  });

  it('joins a block to the one above it', () => {
    expect(removeBreak(['p2', 'p4'], PIDS, 'p2')).toEqual(['p4']);
    expect(removeBreak(['p2'], PIDS, 'p3')).toEqual(['p2']);
  });
});

describe('sectionColor', () => {
  it('hands out the palette in order and then cycles', () => {
    expect(sectionColor(0)).toEqual(SECTION_COLORS[0]);
    expect(sectionColor(SECTION_COLORS.length)).toEqual(SECTION_COLORS[0]);
    expect(sectionColor(SECTION_COLORS.length + 2)).toEqual(SECTION_COLORS[2]);
  });
});
