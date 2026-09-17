import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';

const MESSAGE = 'This analysis has unsaved changes. Leave and discard them?';

type UnsavedChanges = {
  /** Report whether the current page holds unsaved edits. */
  setDirty: (dirty: boolean) => void;
  /** True when navigation may proceed — either nothing is dirty or the user
   * confirmed discarding. */
  confirmDiscard: () => boolean;
};

const UnsavedChangesContext = createContext<UnsavedChanges | null>(null);

/** Tracks unsaved edits app-wide so header links can guard in-app navigation.
 * The value is a stable ref-held object: updating dirtiness never re-renders. */
export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const dirtyRef = useRef(false);
  // The browser's BACK button (ruled 2026-09-17: it must ask too). BrowserRouter
  // navigates on popstate before anyone can object, so the guard is a SENTINEL
  // history entry pushed when the page becomes dirty — same URL, so nothing
  // shows. Back then pops the sentinel first, which changes nothing on screen,
  // and the popstate handler below asks; declining pushes the sentinel back,
  // agreeing goes back once more for real. When the page becomes clean again
  // the sentinel is popped quietly, so Back needs no second press.
  const sentinelRef = useRef(false);
  const guarded = () => window.history.state?.datoolUnsavedGuard === true;
  const arm = () => {
    window.history.pushState({ datoolUnsavedGuard: true }, '');
    sentinelRef.current = true;
  };
  const valueRef = useRef<UnsavedChanges>({
    setDirty: (dirty) => {
      if (typeof window === 'undefined' || typeof window.history?.pushState !== 'function') {
        dirtyRef.current = dirty;
        return;
      }
      if (dirty && !dirtyRef.current) {
        arm();
      } else if (!dirty && dirtyRef.current && sentinelRef.current && guarded()) {
        sentinelRef.current = false;
        window.history.back();
      }
      dirtyRef.current = dirty;
    },
    confirmDiscard: () => !dirtyRef.current || window.confirm(MESSAGE),
  });

  useEffect(() => {
    const onPop = () => {
      if (!dirtyRef.current) return;
      // Back popped the sentinel (or something else while dirty): ask.
      sentinelRef.current = false;
      if (window.confirm(MESSAGE)) {
        dirtyRef.current = false;
        window.history.back();
      } else {
        arm();
      }
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
    };
  }, []);

  return (
    <UnsavedChangesContext.Provider value={valueRef.current}>
      {children}
    </UnsavedChangesContext.Provider>
  );
}

/** Publish this page's dirty state; clears automatically when the page unmounts. */
export function useUnsavedChanges(dirty: boolean): void {
  const ctx = useContext(UnsavedChangesContext);
  useEffect(() => {
    if (ctx === null) return;
    ctx.setDirty(dirty);
    return () => ctx.setDirty(false);
  }, [ctx, dirty]);
}

export function useConfirmDiscard(): () => boolean {
  const ctx = useContext(UnsavedChangesContext);
  return ctx === null ? () => true : ctx.confirmDiscard;
}
