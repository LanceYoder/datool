// @vitest-environment jsdom
//
// The walkthrough: offered once to a new reader, remembered when skipped, and
// its card placed beside the control it points at.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useEffect } from 'react';
import { TourProvider, placeCard, useTour } from '../Tour';

function Offer() {
  const { offer } = useTour();
  useEffect(() => offer(), [offer]);
  return null;
}

function mount() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <TourProvider>
        <Offer />
      </TourProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe('the tour', () => {
  it('offers itself to a reader who has never seen it', () => {
    mount();
    expect(screen.getByRole('dialog', { name: 'Welcome to DaTool' })).toBeTruthy();
    expect(screen.getByText(/helps analyze Biblical texts/)).toBeTruthy();
  });

  it('is not offered again once skipped', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Skip tour' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.localStorage.getItem('datool.tour')).toBe('done');
    cleanup();
    mount();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('resumes at the remembered step', () => {
    const area = document.createElement('textarea');
    area.className = 'paste-area';
    document.body.appendChild(area);
    window.localStorage.setItem('datool.tour', JSON.stringify({ step: 1 }));
    mount();
    expect(screen.getByRole('dialog', { name: 'Choose a passage' })).toBeTruthy();
    // Next waits for a passage.
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
    area.remove();
  });
});

describe('placeCard', () => {
  const card = { width: 300, height: 150 };

  it('centers a card with nothing to point at', () => {
    expect(placeCard(null, card, 1000, 800)).toEqual({ left: 350, top: 325 });
  });

  it('puts the card below a control when it fits', () => {
    const pos = placeCard({ left: 100, top: 100, width: 200, height: 40 }, card, 1000, 800);
    expect(pos).toEqual({ left: 100, top: 154 });
  });

  it('beside a control too tall to go above or below', () => {
    const pos = placeCard({ left: 0, top: 0, width: 400, height: 800 }, card, 1000, 800);
    expect(pos.left).toBe(414);
  });
});
