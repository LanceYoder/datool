// The bracket dropdown: every relationship in the taxonomy, grouped by family.
// Removing a connection is not in here — that is a double click on its dot.
//
// It is a menu of commands, nothing more: picking an item runs exactly one
// core command and closes. Every relationship also answers to its own key
// (shown in parentheses) while the menu is open.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TaxonomyEntry } from '../types';
import { groupByFamily, relationshipForKey, shortcutFor } from './interaction';

export interface RelationshipMenuProps {
  taxonomy: readonly TaxonomyEntry[];
  /** The bracket's current relationship code (marked in the list). */
  current: string;
  onPick: (rel: string) => void;
}

export default function RelationshipMenu({ taxonomy, current, onPick }: RelationshipMenuProps) {
  const groups = groupByFamily(taxonomy);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const currentRef = useRef<HTMLButtonElement | null>(null);
  // The relationship whose description is open, if any. One at a time: the
  // menu is a list to read down, not a stack of open drawers.
  const [explained, setExplained] = useState<string | null>(null);

  // Open on the relationship the bracket already has: scroll it to the middle
  // of the list rather than making the reader hunt for the marked row.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    const item = currentRef.current;
    if (body === null || item === null) return;
    body.scrollTop = item.offsetTop - body.clientHeight / 2 + item.offsetHeight / 2;
  }, [current]);

  // Typing a relationship's key picks it. The menu owns the keystroke only
  // while it is open, and never steals one meant for a text field.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable === true) return;
      const rel = relationshipForKey(event.key, taxonomy);
      if (rel === null) return;
      event.preventDefault();
      onPick(rel);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [taxonomy, onPick]);

  return (
    <div className="menu-body" role="menu" aria-label="Relationship" ref={bodyRef}>
      {groups.map((group) => (
        <div className="menu-group" key={group.family}>
          <div className="menu-heading">{group.name}</div>
          {group.entries.map((entry) => {
            const key = shortcutFor(entry.code);
            const isCurrent = entry.code === current;
            const open = explained === entry.code;
            return (
              <div key={entry.code} className="menu-row">
                {/* The line is the positioning context for the "i", so the
                    open description below never pulls it off center. */}
                <div className={isCurrent ? 'menu-line current' : 'menu-line'}>
                  <button
                    type="button"
                    role="menuitem"
                    ref={isCurrent ? currentRef : undefined}
                    className={isCurrent ? 'menu-item current' : 'menu-item'}
                    onClick={() => onPick(entry.code)}
                  >
                    <span className="menu-symbol">{entry.symbol}</span>
                    <span className="menu-name">{entry.name}</span>
                    {key !== null && <span className="menu-key muted">({key})</span>}
                  </button>
                  <button
                    type="button"
                    className={open ? 'menu-info on' : 'menu-info'}
                    aria-label={`What ${entry.name} means`}
                    aria-expanded={open}
                    title={`What ${entry.name} means`}
                    onClick={(event) => {
                      // Reading about a relationship is not choosing it.
                      event.stopPropagation();
                      setExplained(open ? null : entry.code);
                    }}
                  >
                    i
                  </button>
                </div>
                {open && (
                  <p className="menu-description">
                    {entry.description?.trim() ||
                      'No description — reload the page if this persists.'}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
