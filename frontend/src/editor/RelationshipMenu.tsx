// The bracket dropdown: every relationship in the taxonomy, grouped by family,
// plus the two bracket-local actions that are only sometimes available —
// Confirm (a review-flagged bracket) and Disconnect (a forest ROOT bracket).
//
// It is a menu of commands, nothing more: picking an item runs exactly one
// core command and closes.

import type { TaxonomyEntry } from '../types';
import { groupByFamily } from './interaction';

export interface RelationshipMenuProps {
  taxonomy: readonly TaxonomyEntry[];
  /** The bracket's current relationship code (marked in the list). */
  current: string;
  /** Show "Confirm" — the bracket carries flag 'review'. */
  review: boolean;
  /** Show "Disconnect" — the bracket is a forest root. */
  root: boolean;
  onPick: (rel: string) => void;
  onConfirm: () => void;
  onDisconnect: () => void;
}

export default function RelationshipMenu({
  taxonomy,
  current,
  review,
  root,
  onPick,
  onConfirm,
  onDisconnect,
}: RelationshipMenuProps) {
  const groups = groupByFamily(taxonomy);
  return (
    <div className="menu-body" role="menu" aria-label="Relationship">
      {groups.map((group) => (
        <div className="menu-group" key={group.family}>
          <div className="menu-heading">{group.name}</div>
          {group.entries.map((entry) => (
            <button
              key={entry.code}
              type="button"
              role="menuitem"
              className={entry.code === current ? 'menu-item current' : 'menu-item'}
              onClick={() => onPick(entry.code)}
            >
              <span className="menu-symbol">{entry.symbol}</span>
              <span className="menu-name">{entry.name}</span>
            </button>
          ))}
        </div>
      ))}
      {(review || root) && <div className="menu-sep" />}
      {review && (
        <button
          type="button"
          role="menuitem"
          className="menu-item action confirm"
          onClick={onConfirm}
        >
          Confirm
        </button>
      )}
      {root && (
        <button type="button" role="menuitem" className="menu-item action" onClick={onDisconnect}>
          Disconnect
        </button>
      )}
    </div>
  );
}
