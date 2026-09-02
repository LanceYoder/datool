import { describe, expect, it } from 'vitest';
import type { CorpusWord, TextFlow } from '../../types';
import {
  MAX_INDENT,
  embeddedAt,
  indentLine,
  initTextFlow,
  isAligned,
  isSentenceEnd,
  lineIndexOf,
  mergeWithNext,
  reconcileFlow,
  splitLineAfter,
  startsSentence,
  toggleEmbedded,
} from '../textflow';

/** A corpus word with only what the flow cares about. */
function word(index: number, text: string, verse = 1): CorpusWord {
  return {
    index,
    text,
    word: text,
    norm: text,
    lemma: text,
    pos: 'N-',
    parsing: '',
    book: 45,
    bookName: 'Romans',
    chapter: 1,
    verse,
    translit: null,
    gloss: null,
    eng: null,
    engOrd: null,
  };
}

/** Words from a space-separated string, starting at `from`. */
function passage(text: string, from = 100): CorpusWord[] {
  return text.split(' ').map((t, i) => word(from + i, t));
}

/** Every line's range, for the contiguity checks. */
function ranges(flow: TextFlow): [number, number][] {
  return flow.lines.map((l) => [l.start, l.end]);
}

function expectContiguous(flow: TextFlow): void {
  for (let i = 1; i < flow.lines.length; i += 1) {
    expect(flow.lines[i]!.start).toBe(flow.lines[i - 1]!.end + 1);
  }
}

describe('isSentenceEnd', () => {
  it('sees the three sentence-final marks', () => {
    expect(isSentenceEnd(word(0, 'θεοῦ.'))).toBe(true);
    expect(isSentenceEnd(word(0, 'σύ;'))).toBe(true);
    expect(isSentenceEnd(word(0, 'κυρίου·'))).toBe(true);
  });

  it('ignores marks that do not close a sentence', () => {
    expect(isSentenceEnd(word(0, 'θεοῦ'))).toBe(false);
    expect(isSentenceEnd(word(0, 'δέ,'))).toBe(false);
    expect(isSentenceEnd(word(0, 'ἀλλά'))).toBe(false);
  });

  it('looks past closing quotes and brackets', () => {
    expect(isSentenceEnd('εἶπεν."')).toBe(true);
    expect(isSentenceEnd('εἶπεν.”')).toBe(true);
    expect(isSentenceEnd('εἶπεν.)')).toBe(true);
    expect(isSentenceEnd('εἶπεν"')).toBe(false);
  });

  it('accepts a bare string as well as a word', () => {
    expect(isSentenceEnd('ναί·')).toBe(true);
    expect(isSentenceEnd('')).toBe(false);
  });
});

describe('initTextFlow', () => {
  it('makes one flush-left line per sentence', () => {
    const flow = initTextFlow(passage('α β γ. δ ε· ζ η θ;'));
    expect(ranges(flow)).toEqual([
      [100, 102],
      [103, 104],
      [105, 107],
    ]);
    expect(flow.lines.every((l) => l.indent === 0)).toBe(true);
    expectContiguous(flow);
  });

  it('gives an unclosed final sentence its own line', () => {
    const flow = initTextFlow(passage('α β. γ δ'));
    expect(ranges(flow)).toEqual([
      [100, 101],
      [102, 103],
    ]);
  });

  it('returns no lines for no words', () => {
    expect(initTextFlow([])).toEqual({ lines: [] });
  });

  it('covers the whole passage with no gap', () => {
    const words = passage('α β. γ δ ε· ζ');
    const flow = initTextFlow(words);
    expect(flow.lines[0]!.start).toBe(words[0]!.index);
    expect(flow.lines[flow.lines.length - 1]!.end).toBe(words[words.length - 1]!.index);
    expectContiguous(flow);
  });
});

describe('splitLineAfter', () => {
  const base = initTextFlow(passage('α β γ δ.'));

  it('divides the line and keeps the indent', () => {
    const indented = indentLine(base, 0, 2);
    const flow = splitLineAfter(indented, 101);
    expect(ranges(flow)).toEqual([
      [100, 101],
      [102, 103],
    ]);
    expect(flow.lines.map((l) => l.indent)).toEqual([2, 2]);
    expectContiguous(flow);
  });

  it('leaves the source flow untouched', () => {
    splitLineAfter(base, 101);
    expect(ranges(base)).toEqual([[100, 103]]);
  });

  it('is a no-op on the last word of a line', () => {
    expect(splitLineAfter(base, 103)).toBe(base);
  });

  it('is a no-op for a word outside the flow', () => {
    expect(splitLineAfter(base, 999)).toBe(base);
  });

  it('sends each embedding to the side it falls on', () => {
    const withEmb = toggleEmbedded(toggleEmbedded(base, 100, 100, 'paren'), 102, 103, 'bracket');
    const flow = splitLineAfter(withEmb, 101);
    expect(flow.lines[0]!.embedded).toEqual([{ start: 100, end: 100, style: 'paren' }]);
    expect(flow.lines[1]!.embedded).toEqual([{ start: 102, end: 103, style: 'bracket' }]);
  });

  it('refuses to cut an embedding in two', () => {
    const withEmb = toggleEmbedded(base, 101, 103, 'paren');
    expect(splitLineAfter(withEmb, 102)).toBe(withEmb);
  });
});

describe('mergeWithNext', () => {
  const base = initTextFlow(passage('α β. γ δ. ε.'));

  it('joins two lines, keeping the upper line’s indent', () => {
    const flow = mergeWithNext(indentLine(indentLine(base, 0, 1), 1, 4), 0);
    expect(ranges(flow)).toEqual([
      [100, 103],
      [104, 104],
    ]);
    expect(flow.lines[0]!.indent).toBe(1);
    expectContiguous(flow);
  });

  it('carries both lines’ embeddings across', () => {
    const withEmb = toggleEmbedded(toggleEmbedded(base, 100, 100, 'paren'), 102, 103, 'bracket');
    const flow = mergeWithNext(withEmb, 0);
    expect(flow.lines[0]!.embedded).toEqual([
      { start: 100, end: 100, style: 'paren' },
      { start: 102, end: 103, style: 'bracket' },
    ]);
  });

  it('is a no-op on the last line and out of range', () => {
    expect(mergeWithNext(base, base.lines.length - 1)).toBe(base);
    expect(mergeWithNext(base, 9)).toBe(base);
    expect(mergeWithNext(base, -1)).toBe(base);
  });

  it('undoes a split exactly', () => {
    const flow = mergeWithNext(splitLineAfter(base, 100), 0);
    expect(ranges(flow)).toEqual(ranges(base));
    expectContiguous(flow);
  });
});

describe('indentLine', () => {
  const base = initTextFlow(passage('α β. γ δ.'));

  it('moves a line in and out', () => {
    expect(indentLine(base, 0, 3).lines[0]!.indent).toBe(3);
    expect(indentLine(indentLine(base, 0, 3), 0, -2).lines[0]!.indent).toBe(1);
  });

  it('clamps at 0 and at MAX_INDENT', () => {
    expect(indentLine(base, 0, -5).lines[0]!.indent).toBe(0);
    expect(indentLine(base, 0, 99).lines[0]!.indent).toBe(MAX_INDENT);
    expect(indentLine(base, 0, 99).lines[1]!.indent).toBe(0);
  });

  it('is a no-op when the indent cannot move, or the line is not there', () => {
    expect(indentLine(base, 0, -1)).toBe(base);
    expect(indentLine(base, 5, 1)).toBe(base);
  });

  it('leaves the source flow untouched', () => {
    indentLine(base, 0, 2);
    expect(base.lines[0]!.indent).toBe(0);
  });
});

describe('toggleEmbedded', () => {
  const base = initTextFlow(passage('α β γ δ ε.'));

  it('adds a range, in either click order', () => {
    expect(toggleEmbedded(base, 101, 103, 'paren').lines[0]!.embedded).toEqual([
      { start: 101, end: 103, style: 'paren' },
    ]);
    expect(toggleEmbedded(base, 103, 101, 'bracket').lines[0]!.embedded).toEqual([
      { start: 101, end: 103, style: 'bracket' },
    ]);
  });

  it('removes an identical range', () => {
    const added = toggleEmbedded(base, 101, 102, 'paren');
    const removed = toggleEmbedded(added, 101, 102, 'paren');
    expect(removed.lines[0]!.embedded).toBeUndefined();
  });

  it('keeps ranges in start order', () => {
    const flow = toggleEmbedded(toggleEmbedded(base, 103, 104, 'paren'), 100, 101, 'bracket');
    expect(flow.lines[0]!.embedded!.map((e) => e.start)).toEqual([100, 103]);
  });

  it('refuses a range overlapping an existing one', () => {
    const added = toggleEmbedded(base, 101, 103, 'paren');
    expect(toggleEmbedded(added, 102, 104, 'bracket')).toBe(added);
    expect(toggleEmbedded(added, 100, 101, 'bracket')).toBe(added);
    // A nested range overlaps too.
    expect(toggleEmbedded(added, 102, 102, 'bracket')).toBe(added);
  });

  it('refuses a range crossing a line boundary', () => {
    const two = splitLineAfter(base, 102);
    expect(toggleEmbedded(two, 102, 103, 'paren')).toBe(two);
    expect(toggleEmbedded(two, 100, 104, 'paren')).toBe(two);
  });

  it('refuses a range outside the flow', () => {
    expect(toggleEmbedded(base, 900, 901, 'paren')).toBe(base);
  });

  it('leaves the source flow untouched', () => {
    toggleEmbedded(base, 101, 102, 'paren');
    expect(base.lines[0]!.embedded).toBeUndefined();
  });
});

describe('isAligned', () => {
  const props = [
    { start: 100, end: 101 },
    { start: 102, end: 104 },
  ];

  it('says yes only when the lines are the propositions, in order', () => {
    expect(isAligned({ lines: [
      { start: 100, end: 101, indent: 0 },
      { start: 102, end: 104, indent: 3 },
    ] }, props)).toBe(true);
  });

  it('says no to a different division, a different count, or no flow at all', () => {
    expect(isAligned({ lines: [{ start: 100, end: 104, indent: 0 }] }, props)).toBe(false);
    expect(isAligned({ lines: [
      { start: 100, end: 102, indent: 0 },
      { start: 103, end: 104, indent: 0 },
    ] }, props)).toBe(false);
    expect(isAligned(null, props)).toBe(false);
    expect(isAligned({ lines: [] }, props)).toBe(false);
  });

  it('calls an empty flow aligned with no propositions', () => {
    expect(isAligned({ lines: [] }, [])).toBe(true);
  });
});

describe('reconcileFlow', () => {
  /** The propositions a flow's own lines describe — an aligned starting point. */
  const propsOf = (flow: TextFlow) => flow.lines.map((l) => ({ start: l.start, end: l.end }));

  const base = initTextFlow(passage('α β γ. δ ε. ζ η.')); // 100-102, 103-104, 105-106

  it('gives every proposition a line, in order', () => {
    const props = [
      { start: 100, end: 103 },
      { start: 104, end: 106 },
    ];
    const flow = reconcileFlow(base, props);
    expect(ranges(flow)).toEqual([
      [100, 103],
      [104, 106],
    ]);
    expectContiguous(flow);
  });

  it('starts every line flush left with no flow to go on', () => {
    const flow = reconcileFlow(null, propsOf(base));
    expect(ranges(flow)).toEqual(ranges(base));
    expect(flow.lines.every((l) => l.indent === 0)).toBe(true);
    expect(reconcileFlow(null, [])).toEqual({ lines: [] });
  });

  it('changes nothing where the division already matches', () => {
    const indented = indentLine(base, 1, 2);
    expect(reconcileFlow(indented, propsOf(indented))).toEqual(indented);
  });

  it('gives BOTH halves of a divided line the indent it had', () => {
    const indented = indentLine(base, 1, 3);
    const props = propsOf(splitLineAfter(indented, 103));
    const flow = reconcileFlow(indented, props);
    expect(ranges(flow)).toEqual([
      [100, 102],
      [103, 103],
      [104, 104],
      [105, 106],
    ]);
    expect(flow.lines.map((l) => l.indent)).toEqual([0, 3, 3, 0]);
  });

  it('gives a joined line the FIRST line’s indent', () => {
    const indented = indentLine(indentLine(base, 0, 1), 1, 4);
    const flow = reconcileFlow(indented, propsOf(mergeWithNext(indented, 0)));
    expect(ranges(flow)).toEqual([
      [100, 104],
      [105, 106],
    ]);
    expect(flow.lines[0]!.indent).toBe(1);
  });

  it('leaves a line flush when nothing old covers its first word', () => {
    const short = { lines: [{ start: 100, end: 102, indent: 5 }] };
    const flow = reconcileFlow(short, propsOf(base));
    expect(flow.lines.map((l) => l.indent)).toEqual([5, 0, 0]);
  });

  it('carries an embedding that still fits inside one line', () => {
    const withEmb = toggleEmbedded(base, 100, 101, 'paren');
    const flow = reconcileFlow(withEmb, [
      { start: 100, end: 104 },
      { start: 105, end: 106 },
    ]);
    expect(flow.lines[0]!.embedded).toEqual([{ start: 100, end: 101, style: 'paren' }]);
    expect(flow.lines[1]!.embedded).toBeUndefined();
  });

  it('keeps both lines’ embeddings when two lines become one', () => {
    const withEmb = toggleEmbedded(toggleEmbedded(base, 101, 102, 'paren'), 103, 104, 'bracket');
    const flow = reconcileFlow(withEmb, [{ start: 100, end: 106 }]);
    expect(flow.lines[0]!.embedded).toEqual([
      { start: 101, end: 102, style: 'paren' },
      { start: 103, end: 104, style: 'bracket' },
    ]);
  });

  it('drops an embedding a new division would cut in two', () => {
    const withEmb = toggleEmbedded(base, 100, 102, 'paren');
    const flow = reconcileFlow(withEmb, [
      { start: 100, end: 101 },
      { start: 102, end: 106 },
    ]);
    expect(flow.lines[0]!.embedded).toBeUndefined();
    expect(flow.lines[1]!.embedded).toBeUndefined();
  });

  it('leaves the source flow untouched', () => {
    const withEmb = toggleEmbedded(base, 100, 101, 'paren');
    reconcileFlow(withEmb, [{ start: 100, end: 106 }]);
    expect(ranges(withEmb)).toEqual(ranges(base));
    expect(withEmb.lines[0]!.embedded).toEqual([{ start: 100, end: 101, style: 'paren' }]);
  });

  it('leaves what it makes aligned', () => {
    const props = [
      { start: 100, end: 100 },
      { start: 101, end: 105 },
      { start: 106, end: 106 },
    ];
    expect(isAligned(reconcileFlow(base, props), props)).toBe(true);
  });
});

describe('lookups', () => {
  const words = passage('α β. γ δ ε.');
  const byIndex = new Map(words.map((w) => [w.index, w]));
  const base = initTextFlow(words);

  it('finds the line a word sits on', () => {
    expect(lineIndexOf(base, 100)).toBe(0);
    expect(lineIndexOf(base, 104)).toBe(1);
    expect(lineIndexOf(base, 999)).toBe(-1);
  });

  it('finds the embedding covering a word', () => {
    const flow = toggleEmbedded(base, 102, 103, 'paren');
    expect(embeddedAt(flow, 103)).toEqual({ start: 102, end: 103, style: 'paren' });
    expect(embeddedAt(flow, 104)).toBeNull();
    expect(embeddedAt(flow, 100)).toBeNull();
  });

  it('marks the lines that open a sentence', () => {
    expect(startsSentence(base, 0, byIndex)).toBe(true);
    expect(startsSentence(base, 1, byIndex)).toBe(true);
    // Divide the second sentence: the tail no longer opens one.
    const split = splitLineAfter(base, 102);
    expect(startsSentence(split, 2, byIndex)).toBe(false);
  });
});
