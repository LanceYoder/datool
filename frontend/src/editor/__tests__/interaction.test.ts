import { describe, expect, it } from 'vitest';
import type { BracketNode, TaxonomyEntry, TreeNode } from '../../types';
import { layoutDots } from '../layout';
import type { RowBox } from '../layout';
import {
  RELATIONSHIP_KEYS,
  canSplitAfter,
  clampPopover,
  groupByFamily,
  mainPointRefs,
  parseDotId,
  relationshipForKey,
  rowEnglish,
  shortcutFor,
} from '../interaction';
import { WORD_MAP } from './fixtures';
import { TAXONOMY } from './fixtures';

// The same forest layout.test.ts uses:
//   0: CndE[ FtIn[ p1, Adv[p2, p3] ], Ser[p4, p5] ]
//   1: p6                      (a disconnected proposition)
//   2: Grnd[ p7, p8 ]
const p = (ref: string): TreeNode => ({ kind: 'prop', ref });

function buildForest(): TreeNode[] {
  const adv: BracketNode = { kind: 'bracket', rel: 'Adv', prominent: null, children: [p('p2'), p('p3')] };
  const ser: BracketNode = { kind: 'bracket', rel: 'Ser', prominent: null, children: [p('p4'), p('p5')] };
  const ftIn: BracketNode = { kind: 'bracket', rel: 'FtIn', prominent: 0, children: [p('p1'), adv] };
  const cndE: BracketNode = { kind: 'bracket', rel: 'CndE', prominent: 1, children: [ftIn, ser] };
  const grnd: BracketNode = { kind: 'bracket', rel: 'Grnd', prominent: 0, children: [p('p7'), p('p8')] };
  return [cndE, p('p6'), grnd];
}

const rows = new Map<string, RowBox>(
  ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'].map((ref, i) => {
    const y = 20 + i * 40;
    return [ref, { y, top: y - 15, bottom: y + 15 }];
  }),
);

describe('groupByFamily', () => {
  it('groups the whole taxonomy by family, in first-appearance order', () => {
    const groups = groupByFamily(TAXONOMY);
    expect(groups.map((g) => g.family)).toEqual([
      'coordinate',
      'restatement',
      'distinct',
      'contrary',
    ]);
    expect(groups.map((g) => g.name)).toEqual([
      'Coordinate',
      'Restatement',
      'Distinct statement',
      'Contrary statement',
    ]);
    // Every relationship appears exactly once, in taxonomy order.
    expect(groups.flatMap((g) => g.entries.map((e) => e.code))).toEqual(
      TAXONOMY.map((e) => e.code),
    );
    expect(groups.flatMap((g) => g.entries)).toHaveLength(18);
  });

  it('falls back to the raw family key for an unknown family', () => {
    const odd: TaxonomyEntry = {
      code: 'X',
      name: 'Experimental',
      family: 'experimental',
      symbol: 'X',
      labels: ['X'],
      description: 'An experiment.',
      starredLabel: null,
      coordinate: true,
    };
    const groups = groupByFamily([odd]);
    expect(groups).toEqual([{ family: 'experimental', name: 'experimental', entries: [odd] }]);
  });

  it('returns nothing for an empty taxonomy', () => {
    expect(groupByFamily([])).toEqual([]);
  });
});

describe('parseDotId', () => {
  it('reads proposition and bracket dot ids', () => {
    expect(parseDotId('prop:p12')).toEqual({ kind: 'prop', pid: 'p12' });
    expect(parseDotId('bracket:0')).toEqual({ kind: 'bracket', index: 0 });
    expect(parseDotId('bracket:7')).toEqual({ kind: 'bracket', index: 7 });
  });

  it('rejects malformed ids', () => {
    expect(parseDotId('prop:')).toBeNull();
    expect(parseDotId('bracket:')).toBeNull();
    expect(parseDotId('bracket:-1')).toBeNull();
    expect(parseDotId('bracket:1.5')).toBeNull();
    expect(parseDotId('bracket:x')).toBeNull();
    expect(parseDotId('p1')).toBeNull();
    expect(parseDotId('')).toBeNull();
  });

  it('round-trips every id layoutDots emits', () => {
    for (const dot of layoutDots(buildForest(), rows, 200)) {
      expect(parseDotId(dot.id)).not.toBeNull();
    }
  });
});

describe('mainPointRefs', () => {
  it('star-walks a complete single tree: prominent children, whole coordinate packets', () => {
    // Root CndE stars child 1 (the coordinate Ser packet), so the walk fans
    // out over Ser's two propositions.
    const [tree] = buildForest();
    expect(mainPointRefs([tree!])).toEqual(['p4', 'p5']);
  });

  it('follows a chain of prominent children to a single proposition', () => {
    const inner: BracketNode = {
      kind: 'bracket', rel: 'Grnd', prominent: 0, children: [p('x'), p('y')],
    };
    const root: BracketNode = {
      kind: 'bracket', rel: 'CndE', prominent: 1, children: [p('w'), inner],
    };
    expect(mainPointRefs([root])).toEqual(['x']);
  });

  it('is empty while the analysis is incomplete (many roots, or a bare proposition)', () => {
    expect(mainPointRefs(buildForest())).toEqual([]); // three roots
    expect(mainPointRefs([p('p1')])).toEqual([]); // one root, but no tree
    expect(mainPointRefs([])).toEqual([]);
  });

  it('keeps walking through a coordinate fan, and climaxes a Progression at its last member', () => {
    // Ser fans into BOTH members and the walk continues inside each; Prog is
    // the one coordinate that does not fan — the diagrams underline only the
    // final step of a P. Mirrors the server's main_point.
    const grnd: BracketNode = {
      kind: 'bracket', rel: 'Grnd', prominent: 0, children: [p('a'), p('b')],
    };
    const prog: BracketNode = {
      kind: 'bracket', rel: 'Prog', prominent: null, children: [p('c'), p('d')],
    };
    const root: BracketNode = {
      kind: 'bracket', rel: 'Ser', prominent: null, children: [grnd, prog],
    };
    expect(mainPointRefs([root])).toEqual(['a', 'd']);
  });
});

describe('rowEnglish', () => {
  // Fixture words: 124771–124783 verse 6 (124776 has eng: null), then a gap,
  // then 124789–124791 verse 7; eng is 'e<index>' elsewhere.

  it("joins the row's own words' contextual English, marking the verse start", () => {
    expect(rowEnglish(124771, 124773, WORD_MAP)).toEqual([
      { marker: 6, text: 'e124771 e124772 e124773' },
    ]);
  });

  it('gives a mid-verse row bare text — no verse marker', () => {
    expect(rowEnglish(124777, 124779, WORD_MAP)).toEqual([
      { marker: null, text: 'e124777 e124778 e124779' },
    ]);
  });

  it('starts a marked segment where a new verse begins inside the row', () => {
    expect(rowEnglish(124782, 124791, WORD_MAP)).toEqual([
      { marker: null, text: 'e124782 e124783' },
      { marker: 7, text: 'e124789 e124790 e124791' },
    ]);
  });

  it('skips words with no aligned rendering and empty rows', () => {
    expect(rowEnglish(124775, 124777, WORD_MAP)).toEqual([
      { marker: null, text: 'e124775 e124777' }, // 124776 is null
    ]);
    expect(rowEnglish(124776, 124776, WORD_MAP)).toEqual([]);
    expect(rowEnglish(200000, 200002, WORD_MAP)).toEqual([]); // outside the map
  });
});

describe('clampPopover', () => {
  const size = { width: 100, height: 50 };
  const bounds = { width: 400, height: 300 };

  it('leaves a box that already fits where it is', () => {
    expect(clampPopover({ x: 40, y: 60 }, size, bounds)).toEqual({ x: 40, y: 60 });
  });

  it('pulls a box back inside the right and bottom edges', () => {
    expect(clampPopover({ x: 380, y: 290 }, size, bounds)).toEqual({ x: 296, y: 246 });
  });

  it('never places a box past the top-left margin', () => {
    expect(clampPopover({ x: -50, y: -10 }, size, bounds)).toEqual({ x: 4, y: 4 });
  });

  it('falls back to the margin when the box is bigger than the container', () => {
    expect(clampPopover({ x: 10, y: 10 }, { width: 500, height: 400 }, bounds)).toEqual({
      x: 4,
      y: 4,
    });
  });
});

describe('canSplitAfter', () => {
  it('offers a split after every word but the last', () => {
    expect(canSplitAfter(0, 3)).toBe(true);
    expect(canSplitAfter(1, 3)).toBe(true);
    expect(canSplitAfter(2, 3)).toBe(false);
  });

  it('rejects out-of-range and one-word rows', () => {
    expect(canSplitAfter(-1, 3)).toBe(false);
    expect(canSplitAfter(0, 1)).toBe(false);
    expect(canSplitAfter(0, 0)).toBe(false);
    expect(canSplitAfter(1.5, 5)).toBe(false);
  });
});

describe('relationship shortcuts', () => {
  it('gives every relationship in the taxonomy its own key', () => {
    const keys = TAXONOMY.map((entry) => shortcutFor(entry.code));
    expect(keys.every((key) => key !== null)).toBe(true);
    expect(new Set(keys).size).toBe(TAXONOMY.length);
  });

  it('has no shortcut for a code outside the taxonomy', () => {
    expect(shortcutFor('Nope')).toBeNull();
  });

  it('reads a typed key back to its relationship, either case', () => {
    expect(relationshipForKey('g', TAXONOMY)).toBe('Grnd');
    expect(relationshipForKey('G', TAXONOMY)).toBe('Grnd');
    expect(relationshipForKey('s', TAXONOMY)).toBe('Ser');
    // Punctuation keys carry the relationships whose SYMBOL is the handle.
    expect(relationshipForKey('/', TAXONOMY)).toBe('Cmp');
    expect(relationshipForKey('?', TAXONOMY)).toBe('CndE');
    expect(relationshipForKey('c', TAXONOMY)).toBe('CE');
    expect(relationshipForKey('&', TAXONOMY)).toBeNull();
  });

  it('ignores a key whose relationship the taxonomy does not carry', () => {
    const withoutGround = TAXONOMY.filter((entry) => entry.code !== 'Grnd');
    expect(RELATIONSHIP_KEYS.Grnd).toBe('g');
    expect(relationshipForKey('g', withoutGround)).toBeNull();
  });
});
