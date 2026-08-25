// The color-block strip down the right edge: one saturated band per block.
//
// It is also where blocks are made and unmade. Hovering the strip finds the
// nearest boundary between two propositions and offers it: a "+" where the
// passage is not yet divided, a "−" on a division that already exists. The
// bands themselves are inert.

import { useState } from 'react';
import type { SectionBreak } from '../types';
import type { RowBox } from './layout';
import type { Section } from './sections';
import { sectionColor } from './sections';

export interface SectionStripProps {
  /** Blocks in order, from sectionsOf. */
  sections: readonly Section[];
  /** Propositions in document order. */
  pids: readonly string[];
  /** Measured rows, by pid — what gives each band its top and bottom. */
  rowBoxes: ReadonlyMap<string, RowBox>;
  /** The breaks that currently begin a block. */
  breaks: readonly SectionBreak[];
  height: number;
  onAdd: (pid: string) => void;
  onRemove: (pid: string) => void;
}

/** Top and bottom of a block, from its first and last measured row. */
function bandBox(section: Section, rowBoxes: ReadonlyMap<string, RowBox>): RowBox | null {
  const boxes = section.pids.map((pid) => rowBoxes.get(pid)).filter((b): b is RowBox => b !== undefined);
  if (boxes.length === 0) return null;
  const top = Math.min(...boxes.map((b) => b.top));
  const bottom = Math.max(...boxes.map((b) => b.bottom));
  return { top, bottom, y: (top + bottom) / 2 };
}

export default function SectionStrip({
  sections,
  pids,
  rowBoxes,
  breaks,
  height,
  onAdd,
  onRemove,
}: SectionStripProps) {
  // The boundary the pointer is nearest: the pid the next block would begin
  // at, and the y to draw the control at.
  const [hover, setHover] = useState<{ pid: string; y: number } | null>(null);

  // Every place a block could begin — the top of every row but the first.
  const boundaries = pids
    .slice(1)
    .map((pid) => ({ pid, y: rowBoxes.get(pid)?.top }))
    .filter((b): b is { pid: string; y: number } => b.y !== undefined);

  const onMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (boundaries.length === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const y = event.clientY - rect.top;
    let nearest = boundaries[0]!;
    for (const boundary of boundaries) {
      if (Math.abs(boundary.y - y) < Math.abs(nearest.y - y)) nearest = boundary;
    }
    setHover(nearest);
  };

  const isBreak = hover !== null && breaks.some((b) => b.start === hover.pid);

  return (
    <div
      className="section-strip"
      style={{ height }}
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
    >
      {sections.map((section) => {
        const box = bandBox(section, rowBoxes);
        if (box === null) return null;
        return (
          <div
            key={section.pids[0]}
            className="section-band"
            style={{
              top: box.top,
              height: Math.max(2, box.bottom - box.top),
              background: sectionColor(section.color).strip,
            }}
          />
        );
      })}
      {hover !== null && (
        <button
          type="button"
          className={isBreak ? 'section-control remove' : 'section-control add'}
          style={{ top: hover.y }}
          title={isBreak ? 'Join this block to the one above' : 'Begin a new block here'}
          aria-label={isBreak ? 'Join this block to the one above' : 'Begin a new block here'}
          onClick={() => (isBreak ? onRemove(hover.pid) : onAdd(hover.pid))}
        >
          {/* Drawn, not typed: a glyph sits where its font puts it, which is
              never quite the middle of a circle. These lines cross at it. */}
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
            <line x1="6" y1="10" x2="14" y2="10" />
            {!isBreak && <line x1="10" y1="6" x2="10" y2="14" />}
          </svg>
        </button>
      )}
    </div>
  );
}
