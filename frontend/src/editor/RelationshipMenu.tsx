// The bracket dropdown: every relationship in the taxonomy, grouped by family,
// plus Disconnect for forest ROOT brackets.
//
// It is a menu of commands, nothing more: picking an item runs exactly one
// core command and closes. Every relationship also answers to its own key
// (shown in parentheses) while the menu is open.

import { useEffect, useLayoutEffect, useRef } from 'react';
import type { TaxonomyEntry } from '../types';
import { groupByFamily, relationshipForKey, shortcutFor } from './interaction';

export interface RelationshipMenuProps {
  taxonomy: readonly TaxonomyEntry[];
  /** The bracket's current relationship code (marked in the list). */
  current: string;
  /** Show "Disconnect" — the bracket is a forest root. */
  root: boolean;
  onPick: (rel: string) => void;
  onDisconnect: () => void;
}

export default function RelationshipMenu({
  taxonomy,
  current,
  root,
  onPick,
  onDisconnect,
}: RelationshipMenuProps) {
  const groups = groupByFamily(taxonomy);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const currentRef = useRef<HTMLButtonElement | null>(null);

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
            return (
              <button
                key={entry.code}
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
            );
          })}
        </div>
      ))}
      {root && (
        <>
          <div className="menu-sep" />
          <button type="button" role="menuitem" className="menu-item action" onClick={onDisconnect}>
            Disconnect
          </button>
        </>
      )}
    </div>
  );
}
