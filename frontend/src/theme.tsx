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
//
// It is a SIGNED-IN reader's choice. The way in — sign-in, register, the two
// password pages — always wears the original design, and so does anyone who
// is not signed in: the picker is not offered until they are, and the choice
// they made last time waits for them behind the sign-in (ruled 2026-09-12).

import { createContext, useCallback, useContext, useLayoutEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useSession } from './session';

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

/** The pages that are the way in: always the original design (see above). */
const PUBLIC_PATHS = ['/login', '/register', '/forgot-password', '/reset-password'];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

interface ThemeContextValue {
  /** The reader's stored choice. */
  theme: ThemeId;
  /** Whether the choice may be made — and shown — here: signed in, and not on
   *  the way in. */
  chooser: boolean;
  setTheme: (theme: ThemeId) => void;
}

// The default matters: anything rendered outside a provider (a unit test, say)
// gets the original design rather than crashing.
const ThemeContext = createContext<ThemeContextValue>({
  theme: 'original',
  chooser: false,
  setTheme: () => {},
});

export function useTheme(): ThemeId {
  return useContext(ThemeContext).theme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(loadTheme);
  const { user, loading } = useSession();
  const { pathname } = useLocation();

  // Where the choice holds: a signed-in reader, off the public pages. While
  // the session is still being fetched the STORED choice stands, because a
  // reload by a signed-in reader is the common case and must not flash the
  // original design first; a stranger is sent to /login, which is original
  // whatever the session says.
  const chooser = !isPublicPath(pathname) && (loading || user !== null);
  const effective: ThemeId = chooser ? theme : 'original';

  // Layout, not passive: the attribute must land before the browser paints,
  // or every reload flashes the original design first.
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = effective;
  }, [effective]);

  const setTheme = useCallback((next: ThemeId) => {
    setThemeState(next);
    saveTheme(next);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, chooser: chooser && !loading, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

/** The design picker: one segmented control at the top of the page — for a
 *  signed-in reader only; the way in has no design to choose. */
export function ThemeSwitcher() {
  const { theme, chooser, setTheme } = useContext(ThemeContext);
  if (!chooser) return null;
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
