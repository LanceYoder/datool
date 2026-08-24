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
  const valueRef = useRef<UnsavedChanges>({
    setDirty: (dirty) => {
      dirtyRef.current = dirty;
    },
    confirmDiscard: () => !dirtyRef.current || window.confirm(MESSAGE),
  });
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
