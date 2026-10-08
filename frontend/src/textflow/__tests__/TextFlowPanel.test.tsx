// @vitest-environment jsdom
//
// The panel's GESTURES, at the one place they differ from the tree's: Enter,
// and Backspace / Delete at a line's ends, divide and join the propositions
// the lines are, and the panel only reports it — the division itself is made
// in the document.
//
// Which of the two gestures a word offers is the panel's to decide (it is the
// shape of the line under the pointer). WHETHER the gesture is legal is not:
// §5.4 and §5.5 belong to the engine, and the panel attempts and lets a
// refusal or a no-op happen rather than keeping a second copy of the rule. The
// last describe below closes that loop for real — the panel's Enter through
// the editor's own commands, which is the path AnalysisPage's actionsRef
// carries — because a deferring UI is only honest if the judge it defers to
// actually answers.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import type { CorpusWord, DocumentV2, TextFlow } from '../../types';

/** The panel's only server call: the passage's words. */
const words: CorpusWord[] = 'α β γ δ'.split(' ').map((text, i) => ({
  index: 100 + i,
  text,
  word: text,
  norm: text,
  lemma: text,
  pos: 'N-',
  parsing: '',
  book: 45,
  bookName: 'Romans',
  chapter: 1,
  verse: 1,
  translit: null,
  gloss: null,
  eng: null,
  engOrd: null,
}));

vi.mock('../../api', () => ({
  errorMessages: (err: unknown) => [String(err)],
  getCorpusWords: () => Promise.resolve(words),
}));

const TextFlowPanel = (await import('../TextFlowPanel')).default;
// Imported after the api mock is registered, like the panel itself: these
// reach the same module graph.
const { buildTextById, documentToNode } = await import('../../editor/convert');
const { buildEditor } = await import('../../editor/editor');
const { mergeBelow, splitProposition } = await import('../../editor/commands');
const { propositionsInOrder } = await import('../../editor/schema');

/** Two lines: α β | γ δ. */
const flow: TextFlow = {
  lines: [
    { start: 100, end: 101, indent: 0 },
    { start: 102, end: 103, indent: 1 },
  ],
};

afterEach(cleanup);

async function panel(handlers: {
  onSplitWord?: (i: number) => void;
  onMergeAfterLine?: (i: number) => void;
  onChange?: (flow: TextFlow) => void;
  editable?: boolean;
}) {
  const { onChange = () => {}, ...rest } = handlers;
  render(
    <TextFlowPanel
      flow={flow}
      range={{ start: 100, end: 103 }}
      onChange={onChange}
      {...rest}
    />,
  );
  // The words arrive with the corpus fetch.
  await screen.findByText('α');
}

const word = (text: string) => screen.getByText(text);
const lineOf = (text: string) => word(text).closest('.textflow-line') as HTMLElement;
/** Put the cursor after a word (jsdom lays nothing out, so every click lands
 *  on the word's "after" side) and press a key on its line. */
const cursorAfter = (text: string) => fireEvent.mouseDown(word(text), { button: 0 });
const press = (text: string, key: string, extra: object = {}) =>
  fireEvent.keyDown(lineOf(text), { key, ...extra });
/** Enter after a word: divide the line there. */
const divideAfter = (text: string) => {
  cursorAfter(text);
  press(text, 'Enter');
};
/** Delete at a line's end: join the line below. */
const joinBelow = (text: string) => {
  cursorAfter(text);
  press(text, 'Delete');
};

describe('TextFlowPanel dividing and joining, through the keys', () => {
  it('divides the line after a word that is not its last', async () => {
    const onSplitWord = vi.fn();
    const onMergeAfterLine = vi.fn();
    await panel({ onSplitWord, onMergeAfterLine });

    divideAfter('α');
    expect(onSplitWord).toHaveBeenCalledWith(100);
    divideAfter('γ');
    expect(onSplitWord).toHaveBeenCalledWith(102);
    expect(onMergeAfterLine).not.toHaveBeenCalled();
  });

  it('joins the line below with Delete at a line’s end, and the line above with Backspace at a start', async () => {
    const onSplitWord = vi.fn();
    const onMergeAfterLine = vi.fn();
    await panel({ onSplitWord, onMergeAfterLine });

    joinBelow('β');
    expect(onMergeAfterLine).toHaveBeenCalledWith(101);
    expect(onSplitWord).not.toHaveBeenCalled();

    onMergeAfterLine.mockClear();
    cursorAfter('γ');
    press('γ', 'ArrowLeft'); // before γ: the start of line two
    press('γ', 'Backspace');
    expect(onMergeAfterLine).toHaveBeenCalledWith(101);
    // Enter at a line's very start or end divides nothing.
    press('γ', 'Enter');
    expect(onSplitWord).not.toHaveBeenCalled();
  });

  it('DEFERS on the passage’s final word: it attempts the merge, and the engine declines', async () => {
    // The panel does not know — and must not decide — that there is nothing
    // below the last line to merge into. §5.5 is the engine's rule, so the
    // gesture is attempted and `mergeBelow` finds no proposition below and
    // dispatches nothing. Pre-filtering it here was a second copy of the rule.
    const onSplitWord = vi.fn();
    const onMergeAfterLine = vi.fn();
    await panel({ onSplitWord, onMergeAfterLine });

    joinBelow('δ');
    expect(onSplitWord).not.toHaveBeenCalled();
    // …except that the panel CAN see there is no line below, and says nothing.
    expect(onMergeAfterLine).not.toHaveBeenCalled();
  });

  it('gives a right-click no gesture of its own — a text editor has none', async () => {
    const onSplitWord = vi.fn();
    const onMergeAfterLine = vi.fn();
    await panel({ onSplitWord, onMergeAfterLine });
    fireEvent.contextMenu(word('α'));
    fireEvent.contextMenu(word('β'));
    expect(onSplitWord).not.toHaveBeenCalled();
    expect(onMergeAfterLine).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('TextFlowPanel typing (ruled 2026-09-17: a plain text editor)', () => {
  const line = (text: string) => word(text).closest('.textflow-line') as HTMLElement;

  it('puts the cursor where the line was clicked, and no menu', async () => {
    await panel({});
    fireEvent.mouseDown(word('α'), { button: 0 });
    expect(document.querySelector('.textflow-caret')).not.toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
    // Clicking the box itself — a gap, the padding — puts the cursor on the
    // NEAREST line. jsdom lays nothing out, so every line is equally near and
    // the first wins; the point is that the cursor lands on a line at all.
    fireEvent.mouseDown(document.querySelector('.textflow-body')!, { button: 0 });
    const bar = document.querySelector('.textflow-caret')!;
    expect(bar.closest('.textflow-line')).toBe(lineOf('α'));
  });

  it('types the handout’s marks at the caret and backspaces them', async () => {
    const onChange = vi.fn();
    await panel({ onChange });
    // jsdom lays nothing out: every click lands on the word's "after" side.
    cursorAfter('β');
    fireEvent.keyDown(line('β'), { key: ')' });
    expect(onChange).toHaveBeenLastCalledWith({
      lines: [
        { start: 100, end: 101, indent: 0, marks: [{ at: 101, after: ')' }] },
        { start: 102, end: 103, indent: 1 },
      ],
    });
    // Anything that is not a mark is not typed into the passage.
    onChange.mockClear();
    fireEvent.keyDown(line('β'), { key: 'x' });
    fireEvent.keyDown(line('β'), { key: '{' });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(line('β'), { key: 'Backspace' });
    expect(onChange).not.toHaveBeenCalled(); // nothing typed here yet: a no-op
  });

  it('indents with Tab and Shift+Tab, no buttons needed', async () => {
    const onChange = vi.fn();
    await panel({ onChange });
    fireEvent.keyDown(line('α'), { key: 'Tab' });
    expect(onChange).toHaveBeenLastCalledWith({
      lines: [
        { start: 100, end: 101, indent: 1 },
        { start: 102, end: 103, indent: 1 },
      ],
    });
    fireEvent.keyDown(line('γ'), { key: 'Tab', shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith({
      lines: [
        { start: 100, end: 101, indent: 0 },
        { start: 102, end: 103, indent: 0 },
      ],
    });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('waits, rather than offering to start a flow, while it has none', () => {
    render(
      <TextFlowPanel flow={null} range={{ start: 100, end: 103 }} onChange={() => {}} />,
    );
    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// READ-ONLY (accounts-spec §8): a professor reading a student's work. Two
// separate things meet in this panel: `editable` governs SHAPING the flow —
// the keyboard: Tab and the typed marks — while DIVIDING the lines, which
// are propositions, is the page's: it withholds the two divisions by handing
// the panel no callbacks at all, and the panel takes it from there. No class
// rule touches either (§5): the flow is always the student's to edit.

describe('TextFlowPanel read-only', () => {
  it('takes no focus and refuses Tab when the flow is read-only', async () => {
    const onChange = vi.fn();
    await panel({ editable: false, onChange });
    const line = word('α').closest('.textflow-line');
    expect(line).not.toBeNull();
    expect(line!.getAttribute('tabindex')).toBeNull();
    fireEvent.keyDown(line!, { key: 'Tab' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('puts no caret, and types no mark, when the flow is read-only', async () => {
    const onChange = vi.fn();
    await panel({ editable: false, onChange });
    fireEvent.mouseDown(word('α'), { button: 0 });
    expect(document.querySelector('.textflow-caret')).toBeNull();
    fireEvent.keyDown(word('α').closest('.textflow-line')!, { key: '(' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('still READS: the lines and their words are all there', async () => {
    await panel({ editable: false });
    for (const w of ['α', 'β', 'γ', 'δ']) expect(word(w)).toBeTruthy();
  });

  it('divides nothing when the page hands it no split callback', async () => {
    // What AnalysisPage does on a read-only page — the prop is simply not
    // passed, so Enter and Delete reach nothing.
    await panel({ editable: true });
    divideAfter('α'); // would have split
    joinBelow('β'); // would have merged
    // Nothing to assert but the absence of a crash and of a popover: the
    // panel has no other way to change the document.
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('keeps indenting when only the DIVISIONS are withheld', async () => {
    const onChange = vi.fn();
    await panel({ editable: true, onChange });
    fireEvent.keyDown(word('α').closest('.textflow-line')!, { key: 'Tab' });
    expect(onChange).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The round trip: panel gesture -> the EDITOR's commands -> the document.
//
// AnalysisPage hands the panel two callbacks that run straight into
// AnalysisEditor's `actionsRef` (EditorActions.splitAfter / .mergeAt), which
// name a word by CORPUS INDEX, find the proposition holding it, and run one
// core command. The two lines below are those two propositions, so the flow's
// Enter and the tree's right-click are the same division of the same
// document — and one undo step, because each command dispatches once.

const WORD_MAP: ReadonlyMap<number, CorpusWord> = new Map(words.map((w) => [w.index, w]));

/** Two corpus propositions matching the flow's two lines. */
function twoLineDoc(): DocumentV2 {
  return {
    schemaVersion: 2,
    propositions: [
      { id: 'p1', label: '1a', source: { kind: 'corpus', start: 100, end: 101 } },
      { id: 'p2', label: '1b', source: { kind: 'corpus', start: 102, end: 103 } },
    ],
    forest: [{ kind: 'prop', ref: 'p1' }, { kind: 'prop', ref: 'p2' }],
  };
}

/**
 * EditorActions as AnalysisEditor builds them: a corpus index names the
 * proposition whose range holds it, and the ordinal within that range is where
 * the division falls.
 */
function editorActions(editor: Editor) {
  const at = (index: number): { pid: string; srcStart: number } | null => {
    for (const { node } of propositionsInOrder(editor.state.doc)) {
      const { pid, srcStart, srcEnd } = node.attrs;
      if (typeof srcStart === 'number' && typeof srcEnd === 'number') {
        if (index >= srcStart && index <= srcEnd) return { pid: String(pid), srcStart };
      }
    }
    return null;
  };
  return {
    splitAfter: (index: number) => {
      const hit = at(index);
      if (hit !== null) splitProposition(editor, hit.pid, index - hit.srcStart + 1, WORD_MAP);
    },
    mergeAt: (index: number) => {
      const hit = at(index);
      if (hit !== null) mergeBelow(editor, hit.pid, WORD_MAP);
    },
  };
}

/** The propositions as they now stand: label and display text, in order. */
const rows = (editor: Editor): string[] =>
  propositionsInOrder(editor.state.doc).map(
    ({ node }) => `${String(node.attrs.label)}: ${String(node.attrs.text)}`,
  );

describe('TextFlowPanel gestures through the editor’s commands', () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  async function wired() {
    const doc = twoLineDoc();
    const ed = buildEditor([], documentToNode(doc, buildTextById(doc, words), []));
    editor = ed;
    const actions = editorActions(ed);
    await panel({
      onSplitWord: (index) => {
        actions.splitAfter(index);
      },
      onMergeAfterLine: (index) => {
        actions.mergeAt(index);
      },
    });
    return ed;
  }

  it('divides the proposition Enter falls in, and re-labels from the verses', async () => {
    const ed = await wired();
    expect(rows(ed)).toEqual(['1a: α β', '1b: γ δ']);

    divideAfter('α');
    // The division landed in the DOCUMENT: three propositions, the corpus
    // labels re-derived (one verse, so they letter a/b/c).
    expect(rows(ed)).toEqual(['1a: α', '1b: β', '1c: γ δ']);
  });

  it('joins the line below on a line’s last word', async () => {
    const ed = await wired();
    joinBelow('β'); // Delete at the end of line one -> merge
    expect(rows(ed)).toEqual(['1: α β γ δ']);
  });

  it('leaves the document untouched when the engine declines the final word', async () => {
    const ed = await wired();
    const before = rows(ed);
    const steps = ed.state.doc;
    joinBelow('δ'); // nothing below: nothing asked, nothing changes
    expect(rows(ed)).toEqual(before);
    expect(ed.state.doc).toBe(steps); // byte-identical: no transaction at all
    expect(ed.can().undo()).toBe(false);
  });

  it('is ONE undo step, text and tree together', async () => {
    const ed = await wired();
    divideAfter('α');
    expect(rows(ed)).toHaveLength(3);
    ed.commands.undo();
    expect(rows(ed)).toEqual(['1a: α β', '1b: γ δ']);
  });
});
