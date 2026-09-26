// @vitest-environment jsdom
//
// The tier picker under a class policy (accounts-spec §5, §8): which tiers are
// offered, what happens when only one is, and what actually goes on the wire.
//
// `none` is the tier that exists only because a policy can ask for it — every
// proposition a root — so it is the one this file watches hardest.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { DocumentV2, Policy } from '../../types';
import { DEFAULT_POLICY } from '../../types';

const DOC: DocumentV2 = { schemaVersion: 2, propositions: [], forest: [] };

const api = {
  firstPass: vi.fn(),
  createAnalysis: vi.fn(),
};

vi.mock('../../api', () => ({
  errorMessages: (err: unknown) => [String(err)],
  listAnalyses: () => Promise.resolve([]),
  listDeletedAnalyses: () => Promise.resolve([]),
  deleteAnalysis: () => Promise.resolve(),
  restoreAnalysis: () => Promise.resolve(),
  firstPass: (text: string, tier: string) => api.firstPass(text, tier),
  createAnalysis: (input: unknown) => api.createAnalysis(input),
}));

const HomePage = (await import('../HomePage')).default;
const { PolicyScope } = await import('../../policy');

function withPolicy(patch: Partial<Policy>): Policy {
  return { ...DEFAULT_POLICY, ...patch };
}

function mount(policy: Policy) {
  return render(
    <MemoryRouter>
      <PolicyScope policy={policy}>
        <HomePage />
      </PolicyScope>
    </MemoryRouter>,
  );
}

const picker = () => screen.queryByRole('radiogroup', { name: 'How much the auto-analysis proposes' });

beforeEach(() => {
  window.localStorage.clear();
  api.firstPass.mockReset();
  api.createAnalysis.mockReset();
  api.firstPass.mockResolvedValue({ document: DOC, alignment: null });
  api.createAnalysis.mockResolvedValue({ id: '7' });
});

afterEach(cleanup);

/**
 * Type a passage and wait for the locate debounce (450ms) to spend itself.
 * Real timers: the page's own debounce is what is being exercised.
 */
async function locate() {
  fireEvent.change(screen.getByPlaceholderText(/Paste a Greek passage/), {
    target: { value: 'Eph 1:3' },
  });
  await waitFor(() => {
    expect(api.firstPass).toHaveBeenCalled();
  });
  await screen.findByText('not aligned — raw mode');
}

describe('the tier picker', () => {
  it('offers all three tiers to an unrestricted account, `none` included', async () => {
    mount(DEFAULT_POLICY);
    const group = picker();
    expect(group).not.toBeNull();
    const names = [...group!.querySelectorAll('button')].map((b) => b.textContent);
    expect(names).toEqual(['Nothing', 'Minimal', 'Max']);
  });

  it('offers only the tiers the policy names', async () => {
    mount(withPolicy({ firstPass: { allowed: ['none', 'minimal'] } }));
    const names = [...picker()!.querySelectorAll('button')].map((b) => b.textContent);
    expect(names).toEqual(['Nothing', 'Minimal']);
  });

  it('DISAPPEARS when exactly one tier is allowed — a choice of one is no choice', () => {
    mount(withPolicy({ firstPass: { allowed: ['minimal'] } }));
    expect(picker()).toBeNull();
  });

  it('uses the single allowed tier without being told', async () => {
    mount(withPolicy({ firstPass: { allowed: ['minimal'] } }));
    await locate();
    expect(api.firstPass).toHaveBeenCalledWith('Eph 1:3', 'minimal');
  });

  it('sends `tier`, never the retired `maximal` boolean', async () => {
    mount(DEFAULT_POLICY);
    fireEvent.click(screen.getByRole('radio', { name: 'Max' }));
    await locate();
    expect(api.firstPass).toHaveBeenCalledWith('Eph 1:3', 'full');
  });

  it('starts from `none` when that is all the class allows', async () => {
    mount(withPolicy({ firstPass: { allowed: ['none'] } }));
    await locate();
    expect(api.firstPass).toHaveBeenCalledWith('Eph 1:3', 'none');
  });

  it('drops a remembered tier the policy no longer allows', async () => {
    window.localStorage.setItem('datool.analysisLevel', 'full');
    mount(withPolicy({ firstPass: { allowed: ['none', 'minimal'] } }));
    await locate();
    expect(api.firstPass).toHaveBeenCalledWith('Eph 1:3', 'none');
  });

  it('reads the retired `maximal` preference as `full`', async () => {
    window.localStorage.setItem('datool.analysisLevel', 'maximal');
    mount(DEFAULT_POLICY);
    await locate();
    expect(api.firstPass).toHaveBeenCalledWith('Eph 1:3', 'full');
  });

  it('records the tier on the analysis it creates', async () => {
    mount(withPolicy({ firstPass: { allowed: ['none'] } }));
    await locate();
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => {
      expect(api.createAnalysis).toHaveBeenCalledWith(
        expect.objectContaining({ firstPassTier: 'none' }),
      );
    });
  });
});
