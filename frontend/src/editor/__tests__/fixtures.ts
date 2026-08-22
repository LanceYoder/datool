// Test fixtures: a copy of the 18-entry relationship taxonomy in the exact
// API shape (GET /api/taxonomy), corpus words for 1 John 1:6, and Document
// builders used across the editor-core tests.

import type { CorpusWord, Document as AnalysisDocument, TaxonomyEntry } from '../../types';

const entry = (
  code: string,
  name: string,
  family: string,
  symbol: string,
  labels: string[],
  starredLabel: number | null,
  coordinate: boolean,
): TaxonomyEntry => ({ code, name, family, symbol, labels, starredLabel, coordinate });

/** The 18 relationships, matching the API shape. */
export const TAXONOMY: TaxonomyEntry[] = [
  // Coordinate: single label, no star.
  entry('Ser', 'Series', 'coordinate', '+', ['Ser'], null, true),
  entry('Prog', 'Progression', 'coordinate', '→', ['Prog'], null, true),
  entry('Alt', 'Alternative', 'coordinate', '/', ['Alt'], null, true),
  entry('Adv', 'Adversative', 'coordinate', '><', ['Adv'], null, true),
  // Subordinate, support by restatement.
  entry('IdEx', 'Idea–Explanation', 'restatement', '=', ['Id', 'Exp'], 0, false),
  entry('AcMn', 'Action–Manner', 'restatement', '~', ['Ac', 'Mn'], 0, false),
  entry('Cmp', 'Comparison', 'restatement', '≈', ['', 'Cmp'], 0, false),
  entry('NegPos', 'Negative–Positive', 'restatement', '±', ['Neg', 'Pos'], 1, false),
  entry('QA', 'Question–Answer', 'restatement', '?', ['Q', 'A'], 1, false),
  entry('FtIn', 'Fact–Interpretation', 'restatement', '≡', ['Ft', 'In'], 0, false),
  // Subordinate, support by distinct statement.
  entry('Gr', 'Ground', 'distinct', '∵', ['', 'G'], 0, false),
  entry('Inf', 'Inference', 'distinct', '∴', ['', '∴'], 1, false),
  entry('AcRes', 'Action–Result', 'distinct', '⇒', ['Ac', 'Res'], 1, false),
  entry('AcPur', 'Action–Purpose', 'distinct', '⮕', ['Ac', 'Pur'], 1, false),
  entry('CndE', 'Condition–Expectation', 'distinct', 'if', ['If', 'Th'], 1, false),
  entry('Tmp', 'Temporal', 'distinct', 'T', ['T', ''], 1, false),
  entry('Loc', 'Locative', 'distinct', 'L', ['L', ''], 1, false),
  entry('Csv', 'Concessive', 'distinct', 'yet', ['Csv', ''], 1, false),
];

// 1 John 1:6, first 13 words (SBLGNT-style tokens), arbitrary-but-consistent
// corpus indices. The final clause is a raw-source proposition on purpose,
// to exercise the raw fallback path.
const VERSE_TOKENS = [
  'Ἐὰν', // Ἐὰν        137779
  'εἴπωμεν', // εἴπωμεν    137780
  'ὅτι', // ὅτι         137781
  'κοινωνίαν', // κοινωνίαν  137782
  'ἔχομεν', // ἔχομεν      137783
  'μετʼ', // μετʼ        137784
  'αὐτοῦ', // αὐτοῦ       137785
  'καὶ', // καὶ         137786
  'ἐν', // ἐν           137787
  'τῷ', // τῷ           137788
  'σκότει', // σκότει      137789
  'περιπατῶμεν,', // περιπατῶμεν, 137790
  'ψευδόμεθα', // ψευδόμεθα   137791
];

export const CORPUS_WORDS: CorpusWord[] = VERSE_TOKENS.map((text, i) => ({
  index: 137779 + i,
  text,
  word: text.replace(/[,·.;]/g, ''),
  norm: text.toLowerCase(),
  lemma: text,
  pos: 'V-',
  parsing: '----',
  book: 23,
  bookName: '1 John',
  chapter: 1,
  verse: 6,
}));

export const RAW_1JOHN_1_6E =
  'καὶ οὐ ποιοῦμεν τὴν ἀλήθειαν·'; // καὶ οὐ ποιοῦμεν τὴν ἀλήθειαν·

/**
 * The worked 1 John 1:6 document:
 *   CndE* [ Ser( IdEx[a, b] (reversed), c ),  Ser(d, e) flagged review ]
 * with the apodosis prominent, a color on 1:6c, and a raw-source final
 * proposition.
 */
export function firstJohn16(): AnalysisDocument {
  return {
    schemaVersion: 1,
    propositions: [
      { id: 'p1', label: '1:6a', source: { kind: 'corpus', start: 137779, end: 137781 } },
      { id: 'p2', label: '1:6b', source: { kind: 'corpus', start: 137781, end: 137786 } },
      { id: 'p3', label: '1:6c', source: { kind: 'corpus', start: 137786, end: 137791 }, color: '#1d4ed8' },
      { id: 'p4', label: '1:6d', source: { kind: 'corpus', start: 137791, end: 137792 } },
      { id: 'p5', label: '1:6e', source: { kind: 'raw', text: RAW_1JOHN_1_6E } },
    ],
    tree: {
      kind: 'bracket',
      rel: 'CndE',
      prominent: 1,
      children: [
        {
          kind: 'bracket',
          rel: 'Ser',
          prominent: null,
          children: [
            {
              kind: 'bracket',
              rel: 'IdEx',
              prominent: 0,
              reversed: true,
              children: [
                { kind: 'prop', ref: 'p1' },
                { kind: 'prop', ref: 'p2' },
              ],
            },
            { kind: 'prop', ref: 'p3' },
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
  };
}

/** Flat bracket over three raw props a/b/c. */
export function flatDoc(rel = 'Ser', prominent: number | null = null): AnalysisDocument {
  return {
    schemaVersion: 1,
    propositions: [
      { id: 'a', label: '1:1a', source: { kind: 'raw', text: 'alpha' } },
      { id: 'b', label: '1:1b', source: { kind: 'raw', text: 'beta' } },
      { id: 'c', label: '1:1c', source: { kind: 'raw', text: 'gamma' } },
    ],
    tree: {
      kind: 'bracket',
      rel,
      prominent,
      children: [
        { kind: 'prop', ref: 'a' },
        { kind: 'prop', ref: 'b' },
        { kind: 'prop', ref: 'c' },
      ],
    },
  };
}

/** CndE[ inner(a, b), c ] with configurable prominences. */
export function nestedDoc(
  innerRel = 'Ser',
  innerProminent: number | null = null,
  outerProminent = 1,
): AnalysisDocument {
  return {
    schemaVersion: 1,
    propositions: [
      { id: 'a', label: '1:1a', source: { kind: 'raw', text: 'alpha' } },
      { id: 'b', label: '1:1b', source: { kind: 'raw', text: 'beta' } },
      { id: 'c', label: '1:1c', source: { kind: 'raw', text: 'gamma' } },
    ],
    tree: {
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
  };
}
