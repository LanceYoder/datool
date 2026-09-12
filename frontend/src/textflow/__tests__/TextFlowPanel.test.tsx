// @vitest-environment jsdom
//
// The panel's GESTURES, at the one place they differ from the tree's: a
// right-click on a word divides the propositions the lines are, and the panel
// only reports it — the division itself is made in the document.
//
// Which of the two gestures a word offers is the panel's to decide (it is the
// shape of the line under the pointer). WHETHER the gesture is legal is not:
// §5.4 and §5.5 belong to the engine, and the panel attempts and lets a
// refusal or a no-op happen rather than keeping a second copy of the rule. The
// last describe below closes that loop for real — panel right-click through
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

describe('TextFlowPanel right-click', () => {
  it('divides the line after a word that is not its last', async () => {
    const onSplitWord = vi.fn();
    const onMergeAfterLine = vi.fn();
    await panel({ onSplitWord, onMergeAfterLine });

    fireEvent.contextMenu(word('α'));
    expect(onSplitWord).toHaveBeenCalledWith(100);
    fireEvent.contextMenu(word('γ'));
    expect(onSplitWord).toHaveBeenCalledWith(102);
    expect(onMergeAfterLine).not.toHaveBeenCalled();
  });

  it('joins the line below on a line’s LAST word', async () => {
    const onSplitWord = vi.fn();
    const onMergeAfterLine = vi.fn();
    await panel({ onSplitWord, onMergeAfterLine });

    fireEvent.contextMenu(word('β'));
    expect(onMergeAfterLine).toHaveBeenCalledWith(101);
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

    fireEvent.contextMenu(word('δ'));
    expect(onSplitWord).not.toHaveBeenCalled();
    expect(onMergeAfterLine).toHaveBeenCalledWith(103);
  });

  it('opens no popover: a right-click is the whole gesture', async () => {
    await panel({ onSplitWord: () => {} });
    fireEvent.contextMenu(word('α'));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('TextFlowPanel left-click', () => {
  it('offers the embedding only — dividing is the right-click’s', async () => {
    await panel({});
    fireEvent.click(word('α'));
    const menu = screen.getByRole('menu');
    expect(menu.textContent).toContain('Embed from here');
    expect(menu.textContent).not.toContain('Split');
    expect(menu.textContent).not.toContain('Merge');
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
// the ◀ ▶ and the embedding — while DIVIDING the lines, which are
// propositions, is the page's: it withholds the two divisions by handing the
// panel no callbacks at all, and the panel takes it from there. No class rule
// touches either (§5): the flow is always the student's to edit.

describe('TextFlowPanel read-only', () => {
  it('draws no ◀ ▶, and refuses Tab, when the flow is read-only', async () => {
    const onChange = vi.fn();
    await panel({ editable: false, onChange });
    expect(screen.queryByLabelText('Move line in')).toBeNull();
    expect(screen.queryByLabelText('Move line out')).toBeNull();

    const line = word('α').closest('.textflow-line');
    expect(line).not.toBeNull();
    fireEvent.keyDown(line!, { key: 'Tab' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('opens no embedding popover when the flow is read-only', async () => {
    await panel({ editable: false });
    fireEvent.click(word('α'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('still READS: the lines and their words are all there', async () => {
    await panel({ editable: false });
    for (const w of ['α', 'β', 'γ', 'δ']) expect(word(w)).toBeTruthy();
  });

  it('divides nothing when the page hands it no split callback', async () => {
    // What AnalysisPage does on a read-only page — the prop is simply not
    // passed, so the right-click reaches nothing.
    await panel({ editable: true });
    fireEvent.contextMenu(word('α')); // would have split
    fireEvent.contextMenu(word('β')); // would have merged
    // Nothing to assert but the absence of a crash and of a popover: the
    // panel has no other way to change the document.
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('keeps indenting when only the DIVISIONS are withheld', async () => {
    const onChange = vi.fn();
    await panel({ editable: true, onChange });
    fireEvent.click(screen.getAllByLabelText('Move line in')[0]!);
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
// right-click and the tree's right-click are the same division of the same
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

  it('divides the proposition a right-click falls in, and re-labels from the verses', async () => {
    const ed = await wired();
    expect(rows(ed)).toEqual(['1a: α β', '1b: γ δ']);

    fireEvent.contextMenu(word('α'));
    // The division landed in the DOCUMENT: three propositions, the corpus
    // labels re-derived (one verse, so they letter a/b/c).
    expect(rows(ed)).toEqual(['1a: α', '1b: β', '1c: γ δ']);
  });

  it('joins the line below on a line’s last word', async () => {
    const ed = await wired();
    fireEvent.contextMenu(word('β')); // last word of line one -> merge
    expect(rows(ed)).toEqual(['1: α β γ δ']);
  });

  it('leaves the document untouched when the engine declines the final word', async () => {
    const ed = await wired();
    const before = rows(ed);
    const steps = ed.state.doc;
    fireEvent.contextMenu(word('δ')); // attempted, and refused: nothing below
    expect(rows(ed)).toEqual(before);
    expect(ed.state.doc).toBe(steps); // byte-identical: no transaction at all
    expect(ed.can().undo()).toBe(false);
  });

  it('is ONE undo step, text and tree together', async () => {
    const ed = await wired();
    fireEvent.contextMenu(word('α'));
    expect(rows(ed)).toHaveLength(3);
    ed.commands.undo();
    expect(rows(ed)).toEqual(['1a: α β', '1b: γ δ']);
  });
});
