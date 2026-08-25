import { describe, expect, it } from 'vitest';
import {
  SECTION_COLORS,
  addBreak,
  normalizeBreaks,
  pruneBreaks,
  removeBreak,
  sectionColor,
  sectionColorByPid,
  sectionsOf,
} from '../sections';

const PIDS = ['p1', 'p2', 'p3', 'p4', 'p5'];

const B = (start: string, color: number) => ({ start, color });

describe('normalizeBreaks', () => {
  it('passes {start, color} through and drops garbage', () => {
    expect(normalizeBreaks([B('p2', 3), null, 7, { start: 4 }, { color: 1 }])).toEqual([
      B('p2', 3),
    ]);
    expect(normalizeBreaks('nope')).toEqual([]);
  });

  it('freezes the old position-derived colors for legacy pid-string lists', () => {
    // The unstored first block is color 0, so stored breaks started at 1.
    expect(normalizeBreaks(['p3', 'p5'])).toEqual([B('p3', 1), B('p5', 2)]);
  });
});

describe('pruneBreaks', () => {
  it('drops breaks on propositions that are gone', () => {
    expect(pruneBreaks([B('p2', 1), B('gone', 2), B('p4', 3)], PIDS)).toEqual([
      B('p2', 1),
      B('p4', 3),
    ]);
  });

  it('drops a break on the first proposition — the document already starts one', () => {
    expect(pruneBreaks([B('p1', 1), B('p3', 2)], PIDS)).toEqual([B('p3', 2)]);
  });

  it('drops duplicates and sorts into proposition order', () => {
    expect(pruneBreaks([B('p4', 1), B('p2', 2), B('p4', 3)], PIDS)).toEqual([
      B('p2', 2),
      B('p4', 1),
    ]);
  });
});

describe('sectionsOf', () => {
  it('is one block holding everything (first palette color) when nothing is divided', () => {
    expect(sectionsOf(PIDS, [])).toEqual([{ color: 0, pids: PIDS }]);
  });

  it('starts a new block at each break, each wearing its STORED color', () => {
    expect(sectionsOf(PIDS, [B('p2', 4), B('p5', 1)])).toEqual([
      { color: 0, pids: ['p1'] },
      { color: 4, pids: ['p2', 'p3', 'p4'] },
      { color: 1, pids: ['p5'] },
    ]);
  });

  it('maps every proposition to its block color', () => {
    const byPid = sectionColorByPid(PIDS, [B('p3', 2)]);
    expect([...byPid.values()]).toEqual([0, 0, 2, 2, 2]);
  });
});

describe('addBreak / removeBreak', () => {
  it('gives a new block the first free color and keeps it in proposition order', () => {
    expect(addBreak([B('p4', 1)], PIDS, 'p2')).toEqual([B('p2', 2), B('p4', 1)]);
  });

  it('ignores a repeat and refuses the first proposition', () => {
    expect(addBreak([B('p2', 1)], PIDS, 'p2')).toEqual([B('p2', 1)]);
    expect(addBreak([], PIDS, 'p1')).toEqual([]);
  });

  it('blocks KEEP their color when others come and go', () => {
    // p4's block took color 1; removing it frees the color; p2's block keeps
    // color 2 forever, and the next new block re-uses the freed 1.
    let breaks = addBreak([], PIDS, 'p4'); // [{p4, 1}]
    breaks = addBreak(breaks, PIDS, 'p2'); // [{p2, 2}, {p4, 1}]
    breaks = removeBreak(breaks, PIDS, 'p4');
    expect(breaks).toEqual([B('p2', 2)]);
    expect(addBreak(breaks, PIDS, 'p5')).toEqual([B('p2', 2), B('p5', 1)]);
  });

  it('cycles the palette once every color is on screen', () => {
    const pids = Array.from({ length: 12 }, (_, i) => `p${i + 1}`);
    let breaks = pruneBreaks([], pids);
    for (let i = 2; i <= 9; i += 1) breaks = addBreak(breaks, pids, `p${i}`);
    // Blocks now wear colors 0..8; the palette has 8 entries, so color 8
    // draws the same hues as color 0.
    expect(breaks.map((b) => b.color)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(sectionColor(8)).toEqual(SECTION_COLORS[0]);
  });

  it('joins a block to the one above it, everything else untouched', () => {
    expect(removeBreak([B('p2', 1), B('p4', 2)], PIDS, 'p2')).toEqual([B('p4', 2)]);
    expect(removeBreak([B('p2', 1)], PIDS, 'p3')).toEqual([B('p2', 1)]);
  });
});
