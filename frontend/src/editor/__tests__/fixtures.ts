// Test fixtures: a copy of the 18-entry relationship taxonomy in the exact
// API shape (GET /api/taxonomy — MUST mirror da/taxonomy.py as_json), corpus
// words for 1 John 1:6 with their real word indexes, and Document builders
// used across the editor tests.
//
// All builders return schemaVersion 2 documents (a `forest` of ordered roots)
// and every bracket in them is BINARY, because that is the only shape the
// model can hold: ruling Q2 abolished n-ary support outright, and a fixture
// with a three-child bracket would not be an edge case to cover but a document
// the loader is required to refuse. The one legacy shape still exercised is
// the v1 `tree` (firstJohn16V1), which normalizeDocument lifts to a forest of
// one — a wrapper change, not a structural one.

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
): TaxonomyEntry => ({
  code,
  name,
  family,
  symbol,
  labels,
  starredLabel,
  coordinate,
  // The real descriptions live in da/taxonomy.py; the fixtures only need one.
  description: `${name}: what the course says it is.`,
});

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
  // small tail of words with no aligned rendering. The order key follows the
  // index, so fixture lines read in Greek order.
  eng: index === 124776 ? null : `e${index}`,
  engOrd: index === 124776 ? null : index,
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
 * Adv is `reversed` on the wire because its labels are ('Adv','') with
 * starredLabel 1 and the star sits on the FIRST child (prominent 0). The key
 * is carried here because the wire format still has it (§1's follow-on
 * ruling); nothing stores it any more — the core DERIVES it from rel + star at
 * render and serialize time, so this fixture also pins that the loader ignores
 * what it is told and the writer puts back the same value.
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
 * raw. The shape most of the command tests work on: a floor with a bracket
 * standing in it, so a join can land beside one, break one (ruling Q1 —
 * connecting b or c somewhere new breaks the Ser that claims it), or delete
 * one, without any of those cases needing a fixture of its own.
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

/**
 * The shape the connection engine is judged on: a connected PACKET whose last
 * leaf is also the last leaf of every bracket above it, and one free
 * proposition standing after it.
 *
 *   forest = [ Ser[ p1, FtIn[ p2, CndE[ p3, p4 ] ] ], p5 ]
 *
 * Under v3 this is acceptance row 7, and the ruling is blunt (Q1, Q5): p4's
 * dot names p4 and nothing else, so connecting it to p5 breaks the C?/E that
 * claims p4 — one break, the immediate claimer only, with the Ft/In and the
 * Ser above it standing and adjusting by the ordinary spill rules. To bracket
 * the PACKET with p5 instead, the analyst clicks the packet's own dot. The
 * §5.2 preview shows which of the two they are about to do before the click.
 */
export function packetDoc(): DocumentV2 {
  return {
    schemaVersion: 2,
    propositions: [
      { id: 'p1', label: '1a', source: { kind: 'raw', text: 'alpha' } },
      { id: 'p2', label: '1b', source: { kind: 'raw', text: 'beta' } },
      { id: 'p3', label: '1c', source: { kind: 'raw', text: 'gamma' } },
      { id: 'p4', label: '1d', source: { kind: 'raw', text: 'delta' } },
      { id: 'p5', label: '1e', source: { kind: 'raw', text: 'epsilon' } },
    ],
    forest: [
      {
        kind: 'bracket',
        rel: 'Ser',
        prominent: null,
        children: [
          { kind: 'prop', ref: 'p1' },
          {
            kind: 'bracket',
            rel: 'FtIn',
            prominent: 1,
            children: [
              { kind: 'prop', ref: 'p2' },
              {
                kind: 'bracket',
                rel: 'CndE',
                prominent: 1,
                children: [
                  { kind: 'prop', ref: 'p3' },
                  { kind: 'prop', ref: 'p4' },
                ],
              },
            ],
          },
        ],
      },
      { kind: 'prop', ref: 'p5' },
    ],
  };
}

/**
 * The reported analysis, in the shape the screenshots show around 41d–42e: a
 * Fact–Interpretation whose second end is HANGING — a waiting room holding
 * four units, left by a deleteRelationship — with an Inference closing over it
 * at 42e, and earlier material standing beside it.
 *
 *   forest = [ Ser[ 41a, 41b ],
 *              Inf[ FtIn[ 41d, ⟨42a 42b 42c 42d⟩ ], 42e ] ]
 *
 * Two gestures are judged on it (acceptance rows 1–6, §6's E4 and E5).
 * Rebuilding the waiting room FROM THE INSIDE (42c+42d, then 42b, then 42a)
 * joins within the room every time and costs nothing — bottom-up work inside a
 * room never does — and the last join anchors the Ft's second side. Connecting
 * the room's last lodger 42d to 42e instead reaches OUT of the Ft, and the
 * ruling is the same one everywhere: 42d releases and the Ft survives
 * contracted, while 42e is committed in the Inf, so the Inf breaks. Pairing a
 * unit with a piece of the very group it was related to still breaks its old
 * relationship; the analyst rebuilds upward, which is the ruled workflow.
 */
export function hangingFtDoc(): DocumentV2 {
  const raw = (id: string) => ({ id, label: id, source: { kind: 'raw' as const, text: id } });
  return {
    schemaVersion: 2,
    propositions: ['41a', '41b', '41d', '42a', '42b', '42c', '42d', '42e'].map(raw),
    forest: [
      {
        kind: 'bracket',
        rel: 'Ser',
        prominent: null,
        children: [{ kind: 'prop', ref: '41a' }, { kind: 'prop', ref: '41b' }],
      },
      {
        kind: 'bracket',
        rel: 'Inf',
        prominent: 1,
        children: [
          {
            kind: 'bracket',
            rel: 'FtIn',
            prominent: 1,
            children: [
              { kind: 'prop', ref: '41d' },
              {
                kind: 'hole',
                children: [
                  { kind: 'prop', ref: '42a' },
                  { kind: 'prop', ref: '42b' },
                  { kind: 'prop', ref: '42c' },
                  { kind: 'prop', ref: '42d' },
                ],
              },
            ],
          },
          { kind: 'prop', ref: '42e' },
        ],
      },
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

// pairDoc / flatDoc / nestedDoc used to stand here. flatDoc was an N-ARY
// bracket kept "because documents written before that rule must still load and
// display" — a promise ruling Q2 withdrew: the loader now REQUIRES binary and
// falls back to propositions-only, so the fixture described a behavior it
// would be wrong to have. pairDoc and nestedDoc simply had no callers left
// once the tree moved into the core, where the same shapes are built directly
// out of `leaf`/`Bracket` (src/tree/__tests__) with no wire round trip in the
// way.
