// @vitest-environment jsdom
//
// GATING in the editor (accounts-spec §5, §8), of two kinds:
//
// * READ-ONLY — a professor reading a student's work. Every gesture is gone,
//   and each claim is made twice: the CONTROL is gone, and the KEYBOARD OR
//   POINTER SIDE-CHANNEL that reaches the same command is gone with it. A
//   lock that only hides a button is not a lock — the analyst's ruling is that
//   hiding the control and closing its side-channel are one act.
// * The CLASS RULES — the reading aids a professor may withhold (the tiers are
//   the home page's, tested there). A withheld aid is not a switch turned off:
//   the switch is gone, and the aid is forced off whatever the browser
//   remembered.
//
// The gestures themselves are NEVER a class rule (ruled 2026-09-12): under the
// strictest policy there is, a student still connects, deletes, relabels,
// clears, splits, merges and makes blocks. The positive controls say so.
//
// The editor is rendered whole, against a mocked api, so what is asserted is
// the page a student — or a reading professor — would actually be looking at.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Document as AnalysisDocument, Policy } from '../../types';
import { DEFAULT_POLICY } from '../../types';
import { CORPUS_WORDS, TAXONOMY, firstJohn16 } from './fixtures';

vi.mock('../../api', () => ({
  errorMessages: (err: unknown) => [String(err)],
  getCorpusWords: () => Promise.resolve(CORPUS_WORDS),
  getCorpusVerses: () => Promise.resolve([]),
  getTaxonomy: () => Promise.resolve(TAXONOMY),
}));

const AnalysisEditor = (await import('../AnalysisEditor')).default;
const { PolicyScope, ReadOnlyScope } = await import('../../policy');

/** jsdom measures nothing; the layout needs a box to lay out against. */
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

/**
 * jsdom has no ResizeObserver, and the editor's first measurement pass is the
 * one the real one fires on observe(): without it the overlay never leaves its
 * "not measured yet" state and no dot is ever drawn.
 */
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

function withPolicy(patch: Partial<Policy>): Policy {
  return { ...DEFAULT_POLICY, ...patch };
}

/** The strictest class rules there are: one tier, every aid withheld. */
const STRICTEST: Policy = {
  firstPass: { allowed: ['minimal'] },
  aids: { english: false, verses: false, verbs: false, colorCoding: false },
};

let changes: AnalysisDocument[] = [];

/**
 * Render the editor under one policy — read-only if asked — and wait for its
 * rows to be measured.
 */
async function editor(policy: Policy, readOnly = false) {
  changes = [];
  const view = render(
    <PolicyScope policy={policy}>
      <ReadOnlyScope readOnly={readOnly}>
        <AnalysisEditor document={firstJohn16()} onChange={(doc) => changes.push(doc)} />
      </ReadOnlyScope>
    </PolicyScope>,
  );
  // The corpus and the taxonomy arrive first; the overlay follows once the
  // node views have painted their rows.
  await screen.findByText('ἐὰν', { exact: false });
  await waitFor(() => {
    expect(document.querySelectorAll('[data-dot]').length).toBeGreaterThan(0);
  });
  return view;
}

const readOnly = () => editor(DEFAULT_POLICY, true);

const dots = () => [...document.querySelectorAll<SVGGElement>('[data-dot]')];
const dot = (id: string) => document.querySelector(`[data-dot="${id}"]`)!;
const toolbar = () => document.querySelector('.editor-toolbar') as HTMLElement;

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', FiringResizeObserver);
  Element.prototype.getBoundingClientRect = () => RECT as DOMRect;
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

// ---------------------------------------------------------------------------
// Deleting — the right-click on a dot, and the Delete key on a selected one.

describe('deleting a relationship', () => {
  it('deletes on right-click', async () => {
    await editor(DEFAULT_POLICY);
    fireEvent.contextMenu(dots()[0]!);
    expect(changes.length).toBe(1);
  });

  it('deletes on the Delete key, on a dot that has been selected', async () => {
    await editor(DEFAULT_POLICY);
    fireEvent.click(dots()[0]!);
    expect(document.querySelector('.dot-group.selected')).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(changes.length).toBe(1);
  });

  it('is not a class rule: the strictest policy still deletes', async () => {
    await editor(STRICTEST);
    fireEvent.contextMenu(dots()[0]!);
    expect(changes.length).toBe(1);
  });

  it('closes BOTH the right-click and the Delete key when read-only', async () => {
    await readOnly();
    fireEvent.contextMenu(dots()[0]!);
    expect(changes).toEqual([]);

    fireEvent.click(dots()[0]!);
    fireEvent.keyDown(window, { key: 'Delete' });
    fireEvent.keyDown(window, { key: 'Backspace' });
    expect(changes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Connecting — arming a dot and landing it on another.

describe('connecting two propositions', () => {
  /**
   * A board two dots can actually be joined on.
   *
   * The fixture ships a FULLY CONNECTED tree, on which `connectUnits` refuses
   * every pair there is — so a test that clicks two of its dots and asserts
   * "nothing changed" passes just as well with the gate deleted. Clearing the
   * tree first leaves every proposition a root, and two roots are exactly
   * what connecting joins.
   */
  async function cleared(policy: Policy) {
    await editor(policy);
    fireEvent.click(screen.getByRole('button', { name: 'Clear tree' }));
    await waitFor(() => {
      expect(changes.length).toBe(1);
      expect(document.querySelector('[data-dot="prop:p1"]')).not.toBeNull();
      expect(document.querySelector('[data-dot="prop:p2"]')).not.toBeNull();
    });
  }

  it('joins two loose propositions', async () => {
    // The positive control, without which the read-only case below proves
    // nothing: this pair DOES connect.
    await cleared(DEFAULT_POLICY);
    fireEvent.click(dot('prop:p1'));
    fireEvent.click(dot('prop:p2'));
    await waitFor(() => {
      expect(changes.length).toBe(2);
    });
  });

  it('is not a class rule: the strictest policy still joins them', async () => {
    await cleared(STRICTEST);
    fireEvent.click(dot('prop:p1'));
    fireEvent.click(dot('prop:p2'));
    await waitFor(() => {
      expect(changes.length).toBe(2);
    });
  });

  it('joins them by DRAGGING from one dot to the other — the same gesture as two clicks', async () => {
    await cleared(DEFAULT_POLICY);
    fireEvent.mouseDown(dot('prop:p1'), { button: 0 });
    // The press arms the dot, as a click would.
    expect(document.querySelector('.dot-group.selected')).not.toBeNull();
    fireEvent.mouseUp(dot('prop:p2'), { button: 0 });
    await waitFor(() => {
      expect(changes.length).toBe(2);
    });
  });

  it('keeps a pressed-and-released dot armed, as a click leaves it', async () => {
    await cleared(DEFAULT_POLICY);
    const p1 = dot('prop:p1');
    fireEvent.mouseDown(p1, { button: 0 });
    fireEvent.mouseUp(p1, { button: 0 });
    fireEvent.click(p1);
    expect(document.querySelector('.dot-group.selected')).not.toBeNull();
    expect(changes.length).toBe(1); // only the clear: nothing joined yet
  });

  it('stops the dots arming at all when read-only', async () => {
    await readOnly();
    fireEvent.click(dots()[0]!);
    expect(document.querySelector('.dot-group.selected')).toBeNull();
    fireEvent.click(dots()[1]!);
    expect(changes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Relabeling — the label, the star, and the menu's letter keys.

describe('relabeling', () => {
  it('opens the relationship menu on a label', async () => {
    await editor(DEFAULT_POLICY);
    const label = document.querySelector('.label-hit');
    expect(label).not.toBeNull();
    fireEvent.click(label!);
    expect(await screen.findByRole('menu', { name: 'Relationship' })).toBeTruthy();
  });

  it('is not a class rule: the strictest policy still opens the menu', async () => {
    await editor(STRICTEST);
    fireEvent.click(document.querySelector('.label-hit')!);
    expect(await screen.findByRole('menu', { name: 'Relationship' })).toBeTruthy();
  });

  it('opens no menu — so its letter keys reach nothing — when read-only', async () => {
    await readOnly();
    const label = document.querySelector('.label-hit');
    if (label !== null) fireEvent.click(label);
    expect(screen.queryByRole('menu', { name: 'Relationship' })).toBeNull();
    // The letter key that would have picked a relationship changes nothing.
    fireEvent.keyDown(window, { key: 'g' });
    expect(changes).toEqual([]);
  });

  it('leaves the star alone when read-only', async () => {
    await readOnly();
    const star = document.querySelector('.star-hit');
    if (star !== null) fireEvent.click(star);
    expect(changes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Clearing — the toolbar button, which has no side-channel of its own.

describe('clearing the tree', () => {
  it('shows the Clear tree button', async () => {
    await editor(DEFAULT_POLICY);
    expect(screen.getByRole('button', { name: 'Clear tree' })).toBeTruthy();
  });

  it('is not a class rule: the strictest policy still shows it', async () => {
    await editor(STRICTEST);
    expect(screen.getByRole('button', { name: 'Clear tree' })).toBeTruthy();
  });

  it('removes it when read-only', async () => {
    await readOnly();
    expect(screen.queryByRole('button', { name: 'Clear tree' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Splitting and merging — the right-click on a word, and the affordance that
// says a word can be split at all.

describe('splitting and merging', () => {
  it('splits after a word on right-click', async () => {
    await editor(DEFAULT_POLICY);
    const word = document.querySelector('.word.splittable');
    expect(word).not.toBeNull();
    fireEvent.contextMenu(word!);
    expect(changes.length).toBe(1);
  });

  it('is not a class rule: the strictest policy still splits', async () => {
    await editor(STRICTEST);
    const word = document.querySelector('.word.splittable');
    expect(word).not.toBeNull();
    fireEvent.contextMenu(word!);
    expect(changes.length).toBe(1);
  });

  it('marks no word splittable, and refuses every right-click, when read-only', async () => {
    await readOnly();
    expect(document.querySelector('.word.splittable')).toBeNull();
    // Every word, so that a row's LAST word — the merge gesture — is covered
    // along with the splits.
    for (const word of document.querySelectorAll('.word')) {
      fireEvent.contextMenu(word);
    }
    expect(changes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Color blocks — the strip's + and −.

describe('color blocks', () => {
  it('offers a control on the strip', async () => {
    await editor(DEFAULT_POLICY);
    const strip = document.querySelector('.section-strip');
    expect(strip).not.toBeNull();
    fireEvent.mouseMove(strip!, { clientY: 10 });
    expect(document.querySelector('.section-control')).not.toBeNull();
  });

  it('is not a class rule: the strictest policy still offers it', async () => {
    await editor(STRICTEST);
    fireEvent.mouseMove(document.querySelector('.section-strip')!, { clientY: 10 });
    expect(document.querySelector('.section-control')).not.toBeNull();
  });

  it('offers none when read-only — the bands stay, the gesture goes', async () => {
    await readOnly();
    const strip = document.querySelector('.section-strip');
    expect(strip).not.toBeNull();
    fireEvent.mouseMove(strip!, { clientY: 10 });
    expect(document.querySelector('.section-control')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// aids.* — the reading helps: hidden switch AND the help itself forced off.

describe('reading aids', () => {
  it('shows every switch to an unrestricted account', async () => {
    await editor(DEFAULT_POLICY);
    expect(toolbar().textContent).toContain('English');
    expect(toolbar().textContent).toContain('Verses');
    expect(toolbar().textContent).toContain('Verbs');
    expect(toolbar().textContent).toContain('Color coding');
  });

  it('keeps every switch on a read-only page — reading is the point of the visit', async () => {
    await readOnly();
    expect(toolbar().textContent).toContain('English');
    expect(toolbar().textContent).toContain('Verses');
    expect(toolbar().textContent).toContain('Verbs');
    expect(toolbar().textContent).toContain('Color coding');
  });

  it('hides the English switch AND the English line, whatever was remembered', async () => {
    // The browser remembers the line ON; the policy withholds it.
    window.localStorage.setItem('datool.view', JSON.stringify({ english: true }));
    await editor(withPolicy({ aids: { ...DEFAULT_POLICY.aids, english: false } }));
    expect(toolbar().textContent).not.toContain('English');
    expect(document.querySelector('.english-line')).toBeNull();
  });

  it('hides the verse panel’s picker, and forces the panel off', async () => {
    window.localStorage.setItem('datool.view', JSON.stringify({ verses: 'bsb' }));
    await editor(withPolicy({ aids: { ...DEFAULT_POLICY.aids, verses: false } }));
    expect(toolbar().textContent).not.toContain('Verses');
    expect(document.querySelector('.verse-panel')).toBeNull();
  });

  it('hides the verb switch, and un-bolds the verbs', async () => {
    window.localStorage.setItem('datool.view', JSON.stringify({ verbs: true }));
    await editor(withPolicy({ aids: { ...DEFAULT_POLICY.aids, verbs: false } }));
    expect(toolbar().textContent).not.toContain('Verbs');
    expect(document.querySelector('.word.verb')).toBeNull();
  });

  it('hides the color-coding switch and its Colors… panel', async () => {
    window.localStorage.setItem('datool.view', JSON.stringify({ colorCoding: true }));
    await editor(withPolicy({ aids: { ...DEFAULT_POLICY.aids, colorCoding: false } }));
    expect(toolbar().textContent).not.toContain('Color coding');
    expect(screen.queryByRole('button', { name: 'Colors…' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The line that keeps a withheld aid from reading as a broken one.

describe('the Class rules line', () => {
  it('is absent for an account under no policy at all', async () => {
    await editor(DEFAULT_POLICY);
    expect(document.querySelector('.class-rules')).toBeNull();
  });

  it('names what the class has withheld', async () => {
    await editor(withPolicy({ aids: { ...DEFAULT_POLICY.aids, english: false, verbs: false } }));
    const line = document.querySelector('.class-rules');
    expect(line?.textContent).toBe('Class rules: English line off · verb highlighting off.');
  });

  it('is absent on a read-only page, where the reason for missing controls is a different one', async () => {
    await editor(STRICTEST, true);
    expect(document.querySelector('.class-rules')).toBeNull();
  });
});
