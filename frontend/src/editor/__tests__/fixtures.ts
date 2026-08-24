// Test fixtures: a copy of the 18-entry relationship taxonomy in the exact
// API shape (GET /api/taxonomy — MUST mirror da/taxonomy.py as_json), corpus
// words for 1 John 1:6 with their real word indexes, and Document builders
// used across the editor-core tests.
//
// All builders return schemaVersion 2 documents (a `forest` of ordered roots).
// A v1 builder is kept alongside firstJohn16 so the legacy-load path stays
// covered.

import type {
  CorpusWord,
  Document as AnalysisDocument,
  DocumentV2,
  TaxonomyEntry,
} from '../../types';

const entry = (
  code: string,
  name: string,
  family: string,
  symbol: string,
  labels: string[],
  starredLabel: number | null,
  coordinate: boolean,
): TaxonomyEntry => ({ code, name, family, symbol, labels, starredLabel, coordinate });

/** The 18 relationships, mirroring da/taxonomy.py exactly. */
export const TAXONOMY: TaxonomyEntry[] = [
  // Coordinate (no star; connect from center).
  entry('Ser', 'Series', 'coordinate', 'S', ['S'], null, true),
  entry('Prog', 'Progression', 'coordinate', 'P', ['P'], null, true),
  entry('Alt', 'Alternative', 'coordinate', 'Alt', ['Alt'], null, true),
  // Subordinate — support by restatement.
  entry('WEd', 'Way–End', 'restatement', 'W/Ed', ['W', 'Ed'], 1, false),
  entry('Cmp', 'Comparison', 'restatement', '//', ['//', ''], 1, false),
  entry('NegPos', 'Negative–Positive', 'restatement', '-/+', ['-', '+'], 1, false),
  entry('GnSp', 'General–Specific', 'restatement', 'Gn/Sp', ['Gn', 'Sp'], 1, false),
  entry('FtIn', 'Fact–Interpretation', 'restatement', 'Ft/In', ['Ft', 'In'], 1, false),
  // Subordinate — support by distinct statement.
  entry('Grnd', 'Ground', 'distinct', 'G', ['', 'G'], 0, false),
  entry('Inf', 'Inference', 'distinct', '∴', ['', '∴'], 1, false),
  entry('CE', 'Cause–Effect', 'distinct', 'C/E', ['C', 'E'], 1, false),
  entry('CndE', 'Conditional', 'distinct', 'C?/E', ['C?', 'E'], 1, false),
  entry('MEd', 'Means–End', 'distinct', 'M/Ed', ['M', 'Ed'], 1, false),
  entry('Tmp', 'Temporal', 'distinct', 'T', ['T', ''], 1, false),
  entry('Loc', 'Locative', 'distinct', 'L', ['L', ''], 1, false),
  // Subordinate — support by contrary statement.
  entry('Adv', 'Adversative', 'contrary', 'Adv', ['Adv', ''], 1, false),
  entry('QA', 'Question–Answer', 'contrary', 'Q/A', ['Q', 'A'], 1, false),
  entry('SR', 'Situation–Response', 'contrary', 'S/R', ['S', 'R'], 1, false),
];

// 1 John 1:6 in SBLGNT, words 124771–124783 of the corpus (real indexes),
// plus the opening of 1:7 (124789–124791) so verse-span labeling has a
// second verse to cross into.
const VERSE_6: Array<[number, string]> = [
  [124771, 'ἐὰν'],
  [124772, 'εἴπωμεν'],
  [124773, 'ὅτι'],
  [124774, 'κοινωνίαν'],
  [124775, 'ἔχομεν'],
  [124776, 'μετ’'],
  [124777, 'αὐτοῦ'],
  [124778, 'καὶ'],
  [124779, 'ἐν'],
  [124780, 'τῷ'],
  [124781, 'σκότει'],
  [124782, 'περιπατῶμεν,'],
  [124783, 'ψευδόμεθα'],
];

const VERSE_7: Array<[number, string]> = [
  [124789, 'ἐὰν'],
  [124790, 'δὲ'],
  [124791, 'ἐν'],
];

const corpusWord = (index: number, text: string, verse: number): CorpusWord => ({
  index,
  text,
  word: text.replace(/[,·.;·’]/g, ''),
  norm: text.toLowerCase(),
  lemma: text,
  pos: 'V-',
  parsing: '--------',
  book: 23,
  bookName: '1 John',
  chapter: 1,
  verse,
  translit: 'translit',
  gloss: 'gloss',
  // Contextual English, deterministic per index; 124776 (μετ’) simulates the
  // ≈2% of words with no aligned rendering.
  eng: index === 124776 ? null : `e${index}`,
});

export const CORPUS_WORDS: CorpusWord[] = [
  ...VERSE_6.map(([index, text]) => corpusWord(index, text, 6)),
  ...VERSE_7.map(([index, text]) => corpusWord(index, text, 7)),
];

export const WORD_MAP: ReadonlyMap<number, CorpusWord> = new Map(
  CORPUS_WORDS.map((w) => [w.index, w]),
);

export const RAW_1JOHN_1_6E = 'καὶ οὐ ποιοῦμεν τὴν ἀλήθειαν·';

const JOHN_PROPS = (): AnalysisDocument['propositions'] => [
  { id: 'p1', label: '6a', source: { kind: 'corpus', start: 124771, end: 124772 } },
  { id: 'p2', label: '6b', source: { kind: 'corpus', start: 124773, end: 124777 } },
  { id: 'p3', label: '6c', source: { kind: 'corpus', start: 124778, end: 124782 }, color: '#1d4ed8' },
  { id: 'p4', label: '6d', source: { kind: 'corpus', start: 124783, end: 124783 } },
  { id: 'p5', label: '6e', source: { kind: 'raw', text: RAW_1JOHN_1_6E } },
];

/**
 * The worked 1 John 1:6 document (docs/DESIGN.md §3, from the course's
 * example analysis), with two fixture-only twists to exercise edge paths:
 * a color on 1:6c and a raw-source final proposition. A v2 forest of one
 * root — the whole passage is connected.
 *
 *   CndE (E* = apodosis) [
 *     FtIn (In*) [ p1 "ἐὰν εἴπωμεν",
 *                  Adv reversed (p2* stands despite p3) [ p2, p3 ] ],
 *     Ser flag=review [ p4, p5(raw) ] ]
 *
 * Adv is `reversed` because its labels are ('Adv','') with starredLabel 1 and
 * the star sits on the FIRST child (prominent 0) — exactly the derivation the
 * commands maintain.
 */
export function firstJohn16(): DocumentV2 {
  return {
    schemaVersion: 2,
    propositions: JOHN_PROPS(),
    forest: [
      {
        kind: 'bracket',
        rel: 'CndE',
        prominent: 1,
        children: [
          {
            kind: 'bracket',
            rel: 'FtIn',
            prominent: 1,
            children: [
              { kind: 'prop', ref: 'p1' },
              {
                kind: 'bracket',
                rel: 'Adv',
                prominent: 0,
                reversed: true,
                children: [
                  { kind: 'prop', ref: 'p2' },
                  { kind: 'prop', ref: 'p3' },
                ],
              },
            ],
          },
          {
            kind: 'bracket',
            rel: 'Ser',
            prominent: null,
            flag: 'review',
            children: [
              { kind: 'prop', ref: 'p4' },
              { kind: 'prop', ref: 'p5' },
            ],
          },
        ],
      },
    ],
  };
}

/** The same analysis in the legacy v1 shape (single `tree`, no forest). */
export function firstJohn16V1(): AnalysisDocument {
  const v2 = firstJohn16();
  return {
    schemaVersion: 1,
    propositions: v2.propositions,
    tree: v2.forest[0]!,
  };
}

/**
 * A partly-analysed passage: four disconnected root propositions with one
 * connected pair among them.
 *
 *   forest = [ a, Ser[b, c], d, e ]
 *
 * a/b/c/d carry contiguous corpus ranges (so merges can re-join them); e is
 * raw. This is the shape connectUnits/disconnectRoot work on.
 */
export function disconnectedDoc(): DocumentV2 {
  return {
    schemaVersion: 2,
    propositions: [
      { id: 'a', label: '6a', source: { kind: 'corpus', start: 124771, end: 124772 } },
      { id: 'b', label: '6b', source: { kind: 'corpus', start: 124773, end: 124777 } },
      { id: 'c', label: '6c', source: { kind: 'corpus', start: 124778, end: 124779 } },
      { id: 'd', label: '6d', source: { kind: 'corpus', start: 124780, end: 124783 } },
      { id: 'e', label: '6e', source: { kind: 'raw', text: RAW_1JOHN_1_6E } },
    ],
    forest: [
      { kind: 'prop', ref: 'a' },
      {
        kind: 'bracket',
        rel: 'Ser',
        prominent: null,
        children: [
          { kind: 'prop', ref: 'b' },
          { kind: 'prop', ref: 'c' },
        ],
      },
      { kind: 'prop', ref: 'd' },
      { kind: 'prop', ref: 'e' },
    ],
  };
}

/** A forest of nothing but roots: three unconnected raw propositions. */
export function looseDoc(): DocumentV2 {
  return {
    schemaVersion: 2,
    propositions: [
      { id: 'a', label: '1:1a', source: { kind: 'raw', text: 'alpha one' } },
      { id: 'b', label: '1:1b', source: { kind: 'raw', text: 'beta two' } },
      { id: 'c', label: '1:1c', source: { kind: 'raw', text: 'gamma three' } },
    ],
    forest: [
      { kind: 'prop', ref: 'a' },
      { kind: 'prop', ref: 'b' },
      { kind: 'prop', ref: 'c' },
    ],
  };
}

/** One binary bracket over two raw props a/b. */
export function pairDoc(rel = 'Ser', prominent: number | null = null): DocumentV2 {
  return {
    schemaVersion: 2,
    propositions: [
      { id: 'a', label: '1:1a', source: { kind: 'raw', text: 'alpha' } },
      { id: 'b', label: '1:1b', source: { kind: 'raw', text: 'beta' } },
    ],
    forest: [
      {
        kind: 'bracket',
        rel,
        prominent,
        children: [
          { kind: 'prop', ref: 'a' },
          { kind: 'prop', ref: 'b' },
        ],
      },
    ],
  };
}

/**
 * A LEGACY n-ary bracket over three raw props — new brackets are binary, but
 * documents written before that rule must still load and display.
 */
export function flatDoc(rel = 'Ser', prominent: number | null = null): DocumentV2 {
  return {
    schemaVersion: 2,
    propositions: [
      { id: 'a', label: '1:1a', source: { kind: 'raw', text: 'alpha' } },
      { id: 'b', label: '1:1b', source: { kind: 'raw', text: 'beta' } },
      { id: 'c', label: '1:1c', source: { kind: 'raw', text: 'gamma' } },
    ],
    forest: [
      {
        kind: 'bracket',
        rel,
        prominent,
        children: [
          { kind: 'prop', ref: 'a' },
          { kind: 'prop', ref: 'b' },
          { kind: 'prop', ref: 'c' },
        ],
      },
    ],
  };
}

/** CndE[ inner(a, b), c ] with configurable prominences — one root. */
export function nestedDoc(
  innerRel = 'Ser',
  innerProminent: number | null = null,
  outerProminent = 1,
): DocumentV2 {
  return {
    schemaVersion: 2,
    propositions: [
      { id: 'a', label: '1:1a', source: { kind: 'raw', text: 'alpha' } },
      { id: 'b', label: '1:1b', source: { kind: 'raw', text: 'beta' } },
      { id: 'c', label: '1:1c', source: { kind: 'raw', text: 'gamma' } },
    ],
    forest: [
      {
        kind: 'bracket',
        rel: 'CndE',
        prominent: outerProminent,
        children: [
          {
            kind: 'bracket',
            rel: innerRel,
            prominent: innerProminent,
            children: [
              { kind: 'prop', ref: 'a' },
              { kind: 'prop', ref: 'b' },
            ],
          },
          { kind: 'prop', ref: 'c' },
        ],
      },
    ],
  };
}
