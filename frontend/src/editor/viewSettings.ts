// Display options that belong to the READER, not to the analysis: whether the
// English reference line shows, whether the Greek verbs are bold, whether
// brackets are colored by relationship, and which color each gets.
//
// They live in localStorage, never in the document — two people opening the
// same analysis may want different colors, and a color choice must never make
// an analysis look edited. Pure functions plus one storage read/write, so the
// whole module is unit-testable.

/** The colors a fresh install ships with: one hue family per relationship
 * family, so a glance at a page separates coordinate from support, and
 * neighbouring relationships inside a family stay distinguishable. */
export const DEFAULT_RELATION_COLORS: Readonly<Record<string, string>> = {
  // Coordinate — teal/green.
  Ser: '#0f766e',
  Prog: '#059669',
  Alt: '#65a30d',
  // Restatement — blue/indigo.
  WEd: '#1d4ed8',
  Cmp: '#0284c7',
  NegPos: '#4f46e5',
  GnSp: '#7c3aed',
  FtIn: '#0e7490',
  // Distinct statement — amber/orange/brown.
  Grnd: '#b45309',
  Inf: '#d97706',
  CE: '#ea580c',
  CndE: '#c2410c',
  MEd: '#a16207',
  Tmp: '#92400e',
  Loc: '#854d0e',
  // Contrary statement — red/magenta.
  Adv: '#be123c',
  QA: '#9d174d',
  SR: '#a21caf',
};

/** The color of anything not colored by relationship (and every bracket while
 * color coding is off). */
export const NEUTRAL_LINE = '#374151';

/** Verse-text panel source: hidden, local BSB, or the live ESV API. */
export type VersesSource = 'off' | 'bsb' | 'esv';

export interface ViewSettings {
  /** Show the English reference line above each proposition. */
  english: boolean;
  /** The verse-text panel above the tree: off, or which translation. */
  verses: VersesSource;
  /** Set the Greek verbs in bold — the clause backbone, at a glance. */
  verbs: boolean;
  /** Show the analyst's color blocks, and the strip that makes them. */
  blocks: boolean;
  /** Draw each bracket in its relationship's color. */
  colorCoding: boolean;
  /** Relationship code → color. Missing codes fall back to NEUTRAL_LINE. */
  colors: Record<string, string>;
}

export const DEFAULT_VIEW_SETTINGS: ViewSettings = {
  english: true,
  verses: 'off',
  verbs: true,
  blocks: true,
  colorCoding: false,
  colors: { ...DEFAULT_RELATION_COLORS },
};

const STORAGE_KEY = 'datool.view';

/** #rgb / #rrggbb — what <input type="color"> produces and CSS accepts. */
function isColor(value: unknown): value is string {
  return typeof value === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value);
}

/**
 * Settings from an arbitrary parsed value, field by field: anything missing or
 * malformed falls back to the default, so a hand-edited or outdated stored
 * value can never leave the editor without colors.
 */
export function coerceSettings(raw: unknown): ViewSettings {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const colors: Record<string, string> = { ...DEFAULT_RELATION_COLORS };
  const stored = source.colors;
  if (typeof stored === 'object' && stored !== null) {
    for (const [code, value] of Object.entries(stored)) {
      if (isColor(value)) colors[code] = value;
    }
  }
  return {
    english: typeof source.english === 'boolean' ? source.english : DEFAULT_VIEW_SETTINGS.english,
    verses:
      source.verses === 'off' || source.verses === 'bsb' || source.verses === 'esv'
        ? source.verses
        : DEFAULT_VIEW_SETTINGS.verses,
    verbs: typeof source.verbs === 'boolean' ? source.verbs : DEFAULT_VIEW_SETTINGS.verbs,
    blocks: typeof source.blocks === 'boolean' ? source.blocks : DEFAULT_VIEW_SETTINGS.blocks,
    colorCoding:
      typeof source.colorCoding === 'boolean'
        ? source.colorCoding
        : DEFAULT_VIEW_SETTINGS.colorCoding,
    colors,
  };
}

/** The relationship's color, or the neutral line when it has none. */
export function relationColor(settings: ViewSettings, rel: string): string {
  if (!settings.colorCoding) return NEUTRAL_LINE;
  return settings.colors[rel] ?? NEUTRAL_LINE;
}

export function loadViewSettings(): ViewSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return coerceSettings(raw === null ? null : JSON.parse(raw));
  } catch {
    return { ...DEFAULT_VIEW_SETTINGS, colors: { ...DEFAULT_RELATION_COLORS } };
  }
}

export function saveViewSettings(settings: ViewSettings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private mode or a full quota: the settings simply do not persist.
  }
}
