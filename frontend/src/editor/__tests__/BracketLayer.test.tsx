// @vitest-environment jsdom
//
// The AIMING SIGNALS of spec §5.2, on the overlay that draws them.
//
// The claim worth pinning is not that a class appears — it is that the class
// appears on the RIGHT brackets, and that the set is the core's own. So every
// endangered assertion below feeds `previewConnect`'s `broken` list straight
// into the layer, exactly as AnalysisEditor does: if the two ever drift, the
// aim starts lying about what a click will cost, which is the one thing §4's
// bounded breakage exists to make impossible.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { Bracket, Forest, Leaf, Star, Unit } from '../../tree/core';
import { leaf, loadForest, previewConnect } from '../../tree/core';
import { layoutBrackets, layoutDots } from '../layout';
import type { RowBox } from '../layout';
import BracketLayer from '../BracketLayer';
import { loadViewSettings } from '../viewSettings';

const p = (pid: string): Leaf => leaf(pid);

function br(
  id: number,
  rel: string | null,
  star: Star | null,
  left: Unit | Unit[],
  right: Unit | Unit[],
): Bracket {
  return {
    kind: 'bracket',
    id,
    rel,
    star,
    leftHanging: Array.isArray(left),
    rightHanging: Array.isArray(right),
    left: Array.isArray(left) ? left : [left],
    right: Array.isArray(right) ? right : [right],
  };
}

/**
 * Acceptance row 7's shape (fixtures.ts's packetDoc), as the core model:
 *
 *   [ 1 Ser[ p1, 2 FtIn[ p2, 3 CndE[ p3, p4 ] ] ], p5 ]
 *
 * p4 is committed in the C?/E, and p5 stands free after the packet — so
 * aiming p4 at p5 breaks exactly one bracket, and it is not the outermost.
 */
const packet = (): Forest =>
  loadForest([
    br(1, 'Ser', null, p('p1'), br(2, 'FtIn', 'right', p('p2'), br(3, 'CndE', 'right', p('p3'), p('p4')))),
    p('p5'),
  ]);

const ROWS = new Map<string, RowBox>(
  ['p1', 'p2', 'p3', 'p4', 'p5'].map((pid, i) => {
    const y = 20 + i * 40;
    return [pid, { y, top: y - 15, bottom: y + 15 }];
  }),
);

const X0 = 300;

/** The layer as AnalysisEditor draws it, with whatever signals a test sets. */
function draw(
  forest: Forest,
  props: Partial<React.ComponentProps<typeof BracketLayer>> = {},
) {
  const { container } = render(
    <BracketLayer
      brackets={layoutBrackets(forest, ROWS, X0).brackets}
      dots={layoutDots(forest, ROWS, X0)}
      width={X0}
      height={240}
      selectedDotId={null}
      shake={null}
      onDotClick={() => {}}
      onLabelClick={() => {}}
      onStarClick={() => {}}
      onDotDelete={() => {}}
      pointer={null}
      view={loadViewSettings()}
      {...props}
    />,
  );
  return container;
}

/** The core ids of the bracket groups carrying a class. */
const marked = (container: Element, cls: string): string[] =>
  [...container.querySelectorAll(`.bracket.${cls}`)].map(
    (g) => g.getAttribute('data-bracket') ?? '?',
  );

afterEach(cleanup);

describe('§10 A6 — the quiet overlay', () => {
  it('draws NO span wash at all: hovering a dot marks nothing on the page', () => {
    // The hover wash is deleted, not merely defaulted off — there is no prop
    // left to turn it on with, and nothing in the layer that could draw one.
    const container = draw(packet());
    expect(container.querySelector('.span-wash')).toBeNull();
    const hovered = container.querySelector('[data-dot="prop:p4"]');
    fireEvent.mouseEnter(hovered!);
    expect(container.querySelector('.span-wash')).toBeNull();
    expect(container.querySelector('rect.span-wash')).toBeNull();
  });

  it('draws no PROVISIONAL bracket either: every join has a name (§10 A5)', () => {
    const container = draw(packet());
    expect(container.querySelector('.bracket.provisional')).toBeNull();
  });

  it('reports the dot entered and the dot left', () => {
    const onDotHover = vi.fn();
    const container = draw(packet(), { onDotHover });
    const dot = container.querySelector('[data-dot="prop:p4"]');
    expect(dot).not.toBeNull();
    fireEvent.mouseEnter(dot!);
    expect(onDotHover).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'prop:p4' }));
    fireEvent.mouseLeave(dot!);
    expect(onDotHover).toHaveBeenLastCalledWith(null);
  });
});

describe('§5.2 — aiming: the preview and the endangered brackets', () => {
  it('marks EXACTLY the brackets previewConnect says the join would break', () => {
    const forest = packet();
    const out = previewConnect(forest, { kind: 'leaf', pid: 'p4' }, { kind: 'leaf', pid: 'p5' });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    // Ruling Q1: p4's dot names p4, so its claimer — the C?/E — gives way, and
    // it alone. The Ft/In and the Ser above adjust by the ordinary spill rules
    // and stand. THIS is the list the aim is required to show.
    expect(out.broken).toEqual([3]);

    const container = draw(forest, {
      selectedDotId: 'prop:p4',
      aimTargetId: 'prop:p5',
      endangered: out.broken,
    });
    expect(marked(container, 'endangered')).toEqual(['3']);
    // The letters of that bracket step back with its spine, so the whole
    // bracket speaks with one voice.
    expect(
      [...container.querySelectorAll('.bracket-glyphs.endangered')].length,
    ).toBeGreaterThan(0);
  });

  it('snaps the aim line to the target dot and draws it as the offered bracket', () => {
    const forest = packet();
    const container = draw(forest, {
      selectedDotId: 'prop:p4',
      aimTargetId: 'prop:p5',
      aimRefused: false,
      // Aiming replaces the pointer: the line ends on the dot, not near it.
      pointer: { x: 5, y: 5 },
    });
    const band = container.querySelector('.rubber-band');
    expect(band).not.toBeNull();
    expect(band!.getAttribute('class')).toBe('rubber-band provisional');
    const p5Dot = layoutDots(forest, ROWS, X0).find((d) => d.id === 'prop:p5')!;
    expect(band!.getAttribute('d')).toContain(`M${p5Dot.x.toFixed(1)},${p5Dot.y.toFixed(1)}`);
  });

  it('says NO in its own voice for a target the core refuses, and endangers nothing', () => {
    const forest = packet();
    // p1 and p4 are not adjacent: the only refusals are geometric (§5.1).
    const out = previewConnect(forest, { kind: 'leaf', pid: 'p4' }, { kind: 'leaf', pid: 'p1' });
    expect(out.ok).toBe(false);

    const container = draw(forest, {
      selectedDotId: 'prop:p4',
      aimTargetId: 'prop:p1',
      aimRefused: true,
    });
    expect(container.querySelector('.rubber-band')!.getAttribute('class')).toBe(
      'rubber-band refused',
    );
    expect(marked(container, 'endangered')).toEqual([]);
  });

  it('trails the pointer, unstyled, while the aim is over nothing', () => {
    const container = draw(packet(), {
      selectedDotId: 'prop:p4',
      pointer: { x: 40, y: 90 },
    });
    expect(container.querySelector('.rubber-band')!.getAttribute('class')).toBe('rubber-band');
    expect(container.querySelector('.rubber-band')!.getAttribute('d')).toContain('M40.0,90.0');
  });
});

describe('§5.2 — a side anchoring as a byproduct', () => {
  it('emphasizes the bracket a gesture made whole, and only that one', () => {
    const container = draw(packet(), { anchored: { ids: [2], seq: 1 } });
    expect(marked(container, 'anchored')).toEqual(['2']);
  });

  it('says nothing when nothing anchored', () => {
    expect(marked(draw(packet()), 'anchored')).toEqual([]);
    expect(marked(draw(packet(), { anchored: { ids: [], seq: 3 } }), 'anchored')).toEqual([]);
  });
});
