// @vitest-environment jsdom
//
// The panel's GESTURES, at the one place they differ from the tree's: a
// right-click on a word divides the propositions the lines are, and the panel
// only reports it — the division itself is made in the document.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { CorpusWord, TextFlow } from '../../types';

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
}) {
  render(
    <TextFlowPanel
      flow={flow}
      range={{ start: 100, end: 103 }}
      onChange={() => {}}
      {...handlers}
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

  it('does nothing on the passage’s final word', async () => {
    const onSplitWord = vi.fn();
    const onMergeAfterLine = vi.fn();
    await panel({ onSplitWord, onMergeAfterLine });

    fireEvent.contextMenu(word('δ'));
    expect(onSplitWord).not.toHaveBeenCalled();
    expect(onMergeAfterLine).not.toHaveBeenCalled();
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
