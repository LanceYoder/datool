import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RELATION_COLORS,
  DEFAULT_VIEW_SETTINGS,
  NEUTRAL_LINE,
  coerceSettings,
  relationColor,
} from '../viewSettings';
import { TAXONOMY } from './fixtures';

describe('coerceSettings', () => {
  it('falls back to the defaults for anything missing or malformed', () => {
    expect(coerceSettings(null)).toEqual(DEFAULT_VIEW_SETTINGS);
    expect(coerceSettings('nonsense')).toEqual(DEFAULT_VIEW_SETTINGS);
    expect(coerceSettings({ english: 'yes', colorCoding: 1 })).toEqual(DEFAULT_VIEW_SETTINGS);
  });

  it('keeps stored booleans and valid colors, dropping invalid ones', () => {
    const settings = coerceSettings({
      english: false,
      colorCoding: true,
      colors: { Grnd: '#123456', Inf: 'rebeccapurple', Ser: '#abc' },
    });
    expect(settings.english).toBe(false);
    expect(settings.colorCoding).toBe(true);
    expect(settings.colors.Grnd).toBe('#123456');
    expect(settings.colors.Ser).toBe('#abc');
    expect(settings.colors.Inf).toBe(DEFAULT_RELATION_COLORS.Inf); // not a color
  });

  it('never returns a shared reference to the default colors', () => {
    const settings = coerceSettings(null);
    settings.colors.Grnd = '#000000';
    expect(DEFAULT_RELATION_COLORS.Grnd).not.toBe('#000000');
  });
});

describe('relationColor', () => {
  it('is neutral for every relationship while color coding is off', () => {
    const settings = coerceSettings(null);
    for (const entry of TAXONOMY) {
      expect(relationColor(settings, entry.code)).toBe(NEUTRAL_LINE);
    }
  });

  it('ships a distinct color for every relationship in the taxonomy', () => {
    const settings = coerceSettings({ colorCoding: true });
    const colors = TAXONOMY.map((entry) => relationColor(settings, entry.code));
    expect(colors).not.toContain(NEUTRAL_LINE);
    expect(new Set(colors).size).toBe(TAXONOMY.length);
  });

  it('is neutral for a relationship with no color assigned', () => {
    expect(relationColor(coerceSettings({ colorCoding: true }), 'Nope')).toBe(NEUTRAL_LINE);
  });
});
