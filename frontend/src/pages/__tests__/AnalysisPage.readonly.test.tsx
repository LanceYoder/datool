// @vitest-environment jsdom
//
// READ-ONLY: a professor opening a student's analysis (accounts-spec §2's
// default — "editing a student's work stays the student's", §8's "no Save, no
// gestures"). The page marks its whole subtree read-only (a page mode, not a
// policy — no class rule withholds a gesture), so every gesture handler in
// the editor, the flow and the notes answers to it without a second code
// path anywhere.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Analysis } from '../../types';
import { CORPUS_WORDS, TAXONOMY, firstJohn16 } from '../../editor/__tests__/fixtures';

const ANALYSIS: Analysis = {
  id: '1',
  title: 'Test analysis',
  passageRef: '1 John 1:6',
  updatedAt: '2026-09-09T12:00:00Z',
  document: firstJohn16(),
  notes: '<p>Some notes</p>',
};

// What `getAnalysis` answers with. A row carrying somebody else's `ownerId`
// is the second way the page learns it is read-only — the one that works for a
// bookmarked /analysis/:id, with no flag in the URL at all.
let served: Analysis = ANALYSIS;

const api = { updateAnalysis: vi.fn() };

vi.mock('../../api', () => ({
  ApiError: class extends Error {},
  errorMessages: (err: unknown) => [String(err)],
  setUnauthorizedHandler: () => () => {},
  fetchCsrf: () => Promise.resolve({ ok: true }),
  getMe: () => Promise.resolve({
    id: 9,
    email: 'prof@example.edu',
    name: 'Prof',
    memberships: [],
    policy: null,
    isStaff: false,
  }),
  logout: () => Promise.resolve(),
  getAnalysis: () => Promise.resolve(served),
  updateAnalysis: (...args: unknown[]) => api.updateAnalysis(...args),
  getTextFlow: () =>
    Promise.resolve({ lines: [{ start: 124771, end: 124783, indent: 0 }] }),
  getCorpusWords: () => Promise.resolve(CORPUS_WORDS),
  getCorpusVerses: () => Promise.resolve([]),
  getTaxonomy: () => Promise.resolve(TAXONOMY),
}));

const AnalysisPage = (await import('../AnalysisPage')).default;
const { SessionProvider } = await import('../../session');
const { UnsavedChangesProvider } = await import('../../unsavedChanges');

const RECT = {
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: 900,
  bottom: 30,
  width: 900,
  height: 30,
  toJSON: () => ({}),
};

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

function mount(at: string) {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <SessionProvider>
        <UnsavedChangesProvider>
          <Routes>
            <Route path="/analysis/:id" element={<AnalysisPage />} />
          </Routes>
        </UnsavedChangesProvider>
      </SessionProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', FiringResizeObserver);
  Element.prototype.getBoundingClientRect = () => RECT as DOMRect;
  window.localStorage.clear();
  served = ANALYSIS;
  api.updateAnalysis.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('an analysis opened read-only', () => {
  it('offers no Save, and says why', async () => {
    mount('/analysis/1?readonly=1');
    await screen.findByText('Read-only — this is your student’s work.');
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(api.updateAnalysis).not.toHaveBeenCalled();
  });

  it('withholds every tree gesture’s control', async () => {
    mount('/analysis/1?readonly=1');
    await waitFor(() => {
      expect(document.querySelectorAll('[data-dot]').length).toBeGreaterThan(0);
    });
    expect(screen.queryByRole('button', { name: 'Clear tree' })).toBeNull();
    expect(document.querySelector('.section-control')).toBeNull();
    expect(document.querySelector('.word.splittable')).toBeNull();
  });

  it('keeps every reading aid — reading is the whole point of the visit', async () => {
    mount('/analysis/1?readonly=1');
    await screen.findByText('Read-only — this is your student’s work.');
    await waitFor(() => {
      expect(document.querySelector('.editor-toolbar')).not.toBeNull();
    });
    const toolbar = document.querySelector('.editor-toolbar') as HTMLElement;
    expect(toolbar.textContent).toContain('English');
    expect(toolbar.textContent).toContain('Verses');
    expect(toolbar.textContent).toContain('Verbs');
    expect(toolbar.textContent).toContain('Color coding');
  });

  it('shows the notes without their writing tools', async () => {
    mount('/analysis/1?readonly=1');
    await screen.findByText('Some notes');
    expect(document.querySelector('.notes-tools')).toBeNull();
    expect(document.querySelector('.notes-editor.read-only')).not.toBeNull();
  });

  it('shows the text flow without its indent controls', async () => {
    mount('/analysis/1?readonly=1');
    await waitFor(() => {
      expect(document.querySelector('.textflow-panel.has-flow')).not.toBeNull();
    });
    expect(screen.queryByLabelText('Move line in')).toBeNull();
  });

  it('is the OWNER’s ordinary editable page without the flag', async () => {
    mount('/analysis/1');
    expect(await screen.findByRole('button', { name: 'Save' })).toBeTruthy();
    expect(screen.queryByText('Read-only — this is your student’s work.')).toBeNull();
  });

  it('locks itself on the row’s own ownerId, with nothing in the URL', async () => {
    // A professor who bookmarked the page, or simply reloaded it: the query
    // flag is gone, and the answer still has to be read-only.
    served = { ...ANALYSIS, ownerId: 42 };
    mount('/analysis/1');
    await screen.findByText('Read-only — this is your student’s work.');
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('stays editable when the row’s ownerId is the reader’s own', async () => {
    served = { ...ANALYSIS, ownerId: 9 };
    mount('/analysis/1');
    expect(await screen.findByRole('button', { name: 'Save' })).toBeTruthy();
    expect(screen.queryByText('Read-only — this is your student’s work.')).toBeNull();
  });
});
