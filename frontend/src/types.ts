// Shared domain types for datool. The Document shape mirrors the server's
// schema (schemaVersion 1) and is the single source of truth for analyses.

export interface CorpusSource {
  kind: 'corpus';
  /** Inclusive start word index into the corpus. */
  start: number;
  /** Exclusive end word index into the corpus. */
  end: number;
}

export interface RawSource {
  kind: 'raw';
  text: string;
}

export type PropositionSource = CorpusSource | RawSource;

export interface Proposition {
  id: string;
  /** Verse label shown in the gutter, e.g. "1:6a". */
  label: string;
  source: PropositionSource;
  color?: string;
}

export interface PropRefNode {
  kind: 'prop';
  /** References a Proposition id. */
  ref: string;
}

export interface BracketNode {
  kind: 'bracket';
  /** Taxonomy relationship code. */
  rel: string;
  /**
   * Index of the prominent child. Valid child index iff the relationship is
   * subordinate; null iff the relationship is coordinate.
   */
  prominent: number | null;
  /** Swap which label sits at which end. */
  reversed?: boolean;
  /** 'review' renders the bracket in amber. */
  flag?: 'review';
  /** At least two children; in-order leaves match propositions list order. */
  children: TreeNode[];
}

export type TreeNode = PropRefNode | BracketNode;

export interface Document {
  schemaVersion: 1;
  propositions: Proposition[];
  tree: TreeNode;
}

export interface AnalysisSummary {
  id: string;
  title: string;
  passageRef: string;
  updatedAt: string;
}

export interface Analysis extends AnalysisSummary {
  document: Document;
}

export interface CorpusWord {
  index: number;
  /** Display form (with punctuation/casing) — join with spaces for display. */
  text: string;
  word: string;
  norm: string;
  lemma: string;
  pos: string;
  parsing: string;
  book: number;
  bookName: string;
  chapter: number;
  verse: number;
}

export interface TaxonomyEntry {
  code: string;
  name: string;
  family: string;
  symbol: string;
  labels: string[];
  starredLabel: number | null;
  coordinate: boolean;
}

export interface Alignment {
  ref: string;
  start: number;
  end: number;
  exact: boolean;
  matchedTokens: number;
  totalTokens: number;
  mismatchedPositions: number[];
}

export interface FirstPassResult {
  document: Document;
  alignment: Alignment | null;
}
