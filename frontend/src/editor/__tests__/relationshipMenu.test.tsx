// @vitest-environment jsdom
//
// The relationship menu's KEYBOARD, which is the one side-channel that reaches
// a relabel without a click. §8 names it explicitly: a read-only page closes
// it — the letter keys stop answering, not merely the list being hidden.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import RelationshipMenu from '../RelationshipMenu';
import { shortcutFor } from '../interaction';
import { TAXONOMY } from './fixtures';

afterEach(cleanup);

/** The letter that picks Ground, straight from the shortcut table. */
const GROUND_KEY = shortcutFor('Grnd');

describe('RelationshipMenu keys', () => {
  it('picks a relationship by its letter while the menu is open', () => {
    const onPick = vi.fn();
    render(<RelationshipMenu taxonomy={TAXONOMY} current="Ser" onPick={onPick} />);
    expect(GROUND_KEY).not.toBeNull();
    fireEvent.keyDown(window, { key: GROUND_KEY! });
    expect(onPick).toHaveBeenCalledWith('Grnd');
  });

  it('answers no key at all when the class fixes the labels', () => {
    const onPick = vi.fn();
    render(
      <RelationshipMenu taxonomy={TAXONOMY} current="Ser" onPick={onPick} keyboard={false} />,
    );
    fireEvent.keyDown(window, { key: GROUND_KEY! });
    expect(onPick).not.toHaveBeenCalled();
  });

  it('never steals a keystroke meant for a text field', () => {
    const onPick = vi.fn();
    render(
      <>
        <input aria-label="somewhere to type" />
        <RelationshipMenu taxonomy={TAXONOMY} current="Ser" onPick={onPick} />
      </>,
    );
    fireEvent.keyDown(screen.getByLabelText('somewhere to type'), { key: GROUND_KEY! });
    expect(onPick).not.toHaveBeenCalled();
  });
});
