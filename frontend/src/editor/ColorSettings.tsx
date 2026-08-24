// The color-coding panel: one swatch per relationship, grouped exactly as the
// relationship menu groups them. Editing a swatch changes only the reader's
// own settings (viewSettings), never the analysis.

import type { TaxonomyEntry } from '../types';
import { groupByFamily } from './interaction';
import { DEFAULT_RELATION_COLORS, NEUTRAL_LINE } from './viewSettings';
import type { ViewSettings } from './viewSettings';

export interface ColorSettingsProps {
  taxonomy: readonly TaxonomyEntry[];
  view: ViewSettings;
  onChange: (colors: Record<string, string>) => void;
  onClose: () => void;
}

export default function ColorSettings({ taxonomy, view, onChange, onClose }: ColorSettingsProps) {
  const groups = groupByFamily(taxonomy);
  const set = (code: string, color: string) => {
    onChange({ ...view.colors, [code]: color });
  };
  return (
    <div className="color-settings" role="dialog" aria-label="Bracket colors">
      <div className="color-settings-head">
        <strong>Bracket colors</strong>
        <button type="button" onClick={() => onChange({ ...DEFAULT_RELATION_COLORS })}>
          Reset
        </button>
        <button type="button" onClick={onClose}>
          Done
        </button>
      </div>
      <div className="color-settings-body">
        {groups.map((group) => (
          <div className="color-group" key={group.family}>
            <div className="menu-heading">{group.name}</div>
            {group.entries.map((entry) => (
              <label className="color-row" key={entry.code}>
                <input
                  type="color"
                  value={view.colors[entry.code] ?? NEUTRAL_LINE}
                  onChange={(event) => set(entry.code, event.target.value)}
                  aria-label={`${entry.name} color`}
                />
                <span className="menu-symbol">{entry.symbol}</span>
                <span className="menu-name">{entry.name}</span>
              </label>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
