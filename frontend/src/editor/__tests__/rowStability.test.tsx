// @vitest-environment jsdom
//
// A connect or a delete must not rebuild the rows. The tree rides a hidden
// node of its own (schema.ts's treeState) precisely so that a gesture's
// AttrStep touches nothing else: when it rode the doc's attributes, the view
// destroyed and re-created every row on every gesture, the page collapsed to
// nothing for a task and grew back, and the reader saw the page jump.
//
// The claim is made on DOM identity: the very same row elements are in the
// document after the gesture as before it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Document as AnalysisDocument } from '../../types';
import { CORPUS_WORDS, TAXONOMY, firstJohn16 } from './fixtures';

vi.mock('../../api', () => ({
  errorMessages: (err: unknown) => [String(err)],
  getCorpusWords: () => Promise.resolve(CORPUS_WORDS),
  getCorpusVerses: () => Promise.resolve([]),
  getTaxonomy: () => Promise.resolve(TAXONOMY),
}));

const AnalysisEditor = (await import('../AnalysisEditor')).default;

const RECT = { x: 0, y: 0, top: 0, left: 0, right: 900, bottom: 30, width: 900, height: 30, toJSON: () => ({}) };

class FiringResizeObserver {
  private readonly cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
  }
  observe() {
    setTimeout(() => this.cb([], this as unknown as ResizeObserver), 0);
  }
  unobserve() {}
  disconnect() {}
}

let changes: AnalysisDocument[] = [];

async function editor() {
  changes = [];
  render(<AnalysisEditor document={firstJohn16()} onChange={(doc) => changes.push(doc)} />);
  await screen.findByText('ἐὰν', { exact: false });
  await waitFor(() => {
    expect(document.querySelectorAll('[data-dot]').length).toBeGreaterThan(0);
  });
}

const rows = () => [...document.querySelectorAll<HTMLElement>('.prop-row')];

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', FiringResizeObserver);
  Element.prototype.getBoundingClientRect = () => RECT as DOMRect;
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('the rows survive a gesture', () => {
  it('keeps every row element through a delete', async () => {
    await editor();
    const before = rows();
    expect(before.length).toBeGreaterThan(1);
    fireEvent.contextMenu(document.querySelector('[data-dot^="bracket:"]')!);
    expect(changes.length).toBe(1);
    const after = rows();
    expect(after.length).toBe(before.length);
    after.forEach((row, i) => expect(row).toBe(before[i]));
  });

  it('keeps every row element through a connect, and through its undo', async () => {
    await editor();
    fireEvent.click(screen.getByRole('button', { name: 'Clear tree' }));
    await waitFor(() => {
      expect(document.querySelector('[data-dot="prop:p1"]')).not.toBeNull();
    });
    const before = rows();
    fireEvent.click(document.querySelector('[data-dot="prop:p1"]')!);
    fireEvent.click(document.querySelector('[data-dot="prop:p2"]')!);
    await waitFor(() => {
      expect(changes.length).toBe(2);
    });
    rows().forEach((row, i) => expect(row).toBe(before[i]));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => {
      expect(changes.length).toBe(3);
    });
    rows().forEach((row, i) => expect(row).toBe(before[i]));
  });

  it('carries the tree on a hidden treeState node, never a row', async () => {
    await editor();
    const carrier = document.querySelector('[data-tree-state]');
    expect(carrier).not.toBeNull();
    expect(carrier!.classList.contains('prop-row')).toBe(false);
    expect(carrier!.textContent).toBe('');
  });
});
