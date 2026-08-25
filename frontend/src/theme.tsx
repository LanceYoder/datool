// The site's SKIN: which of the mocked-up designs the whole app is dressed in.
//
// A skin changes nothing about the analysis. The tree's geometry, the Greek
// and its English line, and the analyst's color blocks are the same in every
// one of them; what changes is the ground they sit on, the ink the tree is
// drawn in, and the chrome around them. So a skin is a `data-theme` on the
// document element plus a stylesheet (themes.css) — no component branches on
// it except BracketLayer, which draws with a pen in the notebook.
//
// The choice is the reader's and lives in localStorage, like the display
// switches: it must never look like the document was edited.

import { createContext, useCallback, useContext, useLayoutEffect, useState } from 'react';
import type { ReactNode } from 'react';

export const THEMES = [
  { id: 'original', name: 'Original', hint: 'The tool as it stands' },
  { id: 'book', name: 'Book', hint: 'An illuminated two-page spread' },
  { id: 'notebook', name: 'Notebook', hint: 'Graph paper, ruled paper, pen' },
  { id: 'slate', name: 'Slate', hint: 'Modern, borderless, monochrome' },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];

const STORAGE_KEY = 'datool.theme';

function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((t) => t.id === value);
}

export function loadTheme(): ThemeId {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isThemeId(raw) ? raw : 'original';
  } catch {
    return 'original';
  }
}

function saveTheme(theme: ThemeId): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Private mode or a full quota: the choice simply does not persist.
  }
}

interface ThemeContextValue {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
}

// The default matters: anything rendered outside a provider (a unit test, say)
// gets the original design rather than crashing.
const ThemeContext = createContext<ThemeContextValue>({
  theme: 'original',
  setTheme: () => {},
});

export function useTheme(): ThemeId {
  return useContext(ThemeContext).theme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(loadTheme);

  // Layout, not passive: the attribute must land before the browser paints,
  // or every reload flashes the original design first.
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const setTheme = useCallback((next: ThemeId) => {
    setThemeState(next);
    saveTheme(next);
  }, []);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

/** The design picker: one segmented control, always at the top of the page. */
export function ThemeSwitcher() {
  const { theme, setTheme } = useContext(ThemeContext);
  return (
    <div className="theme-switch" role="group" aria-label="Site design">
      {THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          className={t.id === theme ? 'theme-option on' : 'theme-option'}
          aria-pressed={t.id === theme}
          title={t.hint}
          onClick={() => setTheme(t.id)}
        >
          {t.name}
        </button>
      ))}
    </div>
  );
}
