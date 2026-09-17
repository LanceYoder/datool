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
  /**
   * Whether the letter keys answer. False on a professor's read-only view of
   * a student's work: the menu's keyboard side-channel closes with its items,
   * so a lock is never one keystroke deep.
   */
  keyboard?: boolean;
}

export default function RelationshipMenu({
  taxonomy,
  current,
  onPick,
  keyboard = true,
}: RelationshipMenuProps) {
  const groups = groupByFamily(taxonomy);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const currentRef = useRef<HTMLButtonElement | null>(null);
  // The relationship whose description is open, if any, and where its box
  // stands: a SEPARATE box beside the menu (ruled 2026-09-17), not a drawer
  // in the column — the menu stays a narrow list to read down. Anchored to
  // the menu's own box (absolute, beside it, level with the row whose "i"
  // was pressed), so it goes wherever the menu goes. One at a time.
  const [explained, setExplained] = useState<{ code: string; top: number } | null>(null);

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
    if (!keyboard) return;
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
  }, [taxonomy, onPick, keyboard]);

  return (
    <div className="menu-body" role="menu" aria-label="Relationship" ref={bodyRef}>
      {groups.map((group) => (
        <div className="menu-group" key={group.family}>
          <div className="menu-heading">{group.name}</div>
          {group.entries.map((entry) => {
            const key = shortcutFor(entry.code);
            const isCurrent = entry.code === current;
            const open = explained?.code === entry.code;
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
                      if (open) {
                        setExplained(null);
                        return;
                      }
                      // Beside the "i" that was pressed: the row's top,
                      // measured against the menu the box is anchored to.
                      const line = event.currentTarget.closest('.menu-line') ?? event.currentTarget;
                      const menu = bodyRef.current?.closest('.popover') ?? bodyRef.current;
                      const menuTop = (menu ?? line).getBoundingClientRect().top;
                      setExplained({ code: entry.code, top: line.getBoundingClientRect().top - menuTop });
                    }}
                  >
                    i
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ))}
      {explained !== null && (() => {
        const entry = taxonomy.find((e) => e.code === explained.code);
        if (entry === undefined) return null;
        return (
          <div
            className="popover menu-explain"
            role="note"
            style={{ top: explained.top }}
          >
            {/* The full name lives here, not in the row (ruled 2026-09-17):
                the menu is kept narrow enough to stand beside the tree, and
                the "i" is where the name is. */}
            <strong className="menu-fullname">{entry.name}</strong>
            {entry.description?.trim() ||
              'No description — reload the page if this persists.'}
          </div>
        );
      })()}
    </div>
  );
}
