// Shared domain types for datool. The Document shape mirrors the server's
// schema and is the single source of truth for analyses.
//
// Two schema versions exist:
//   v1 — a single connected `tree`; every proposition hangs off one root.
//   v2 — a `forest` of ordered roots; disconnected propositions are legal and
//        are simply roots of their own.
// v1 documents still LOAD (normalizeDocument turns them into a forest of one);
// the editor always SAVES v2.

export interface CorpusSource {
  kind: 'corpus';
  /** Inclusive start word index into the corpus. */
  start: number;
  /** Inclusive end word index into the corpus. */
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
  /**
   * DERIVED, never user-set: true when the starred end is the one that would
   * otherwise carry labels[1 - starredLabel]. Commands recompute it; the
   * geometry only reads it. Absent/false on coordinate and n-ary brackets.
   */
  reversed?: boolean;
  /** 'review' renders the bracket in amber. */
  flag?: 'review';
  /**
   * Newly created brackets are BINARY (exactly two children). Legacy n-ary
   * brackets still load and display. In-order leaves across the whole forest
   * match the propositions list order.
   */
  children: TreeNode[];
}

export type TreeNode = PropRefNode | BracketNode;

/** A stored color block: the pid that begins it, and the palette color it
 * keeps for as long as it exists. */
export interface SectionBreak {
  start: string;
  color: number;
}

/**
 * A stretch of one flow line set off from the clause around it: left where it
 * stands in the word order, but wrapped and italicized so the eye can step
 * over it. Ranges within a line are ordered and never overlap.
 */
export interface TextFlowEmbedded {
  /** Inclusive corpus word index, within the owning line. */
  start: number;
  /** Inclusive corpus word index, within the owning line. */
  end: number;
  style: 'paren' | 'bracket';
}

/** One clause line of the text flow. */
export interface TextFlowLine {
  /** Inclusive corpus word range. */
  start: number;
  end: number;
  /** Steps of indentation under what the clause modifies, 0..8. */
  indent: number;
  embedded?: TextFlowEmbedded[];
}

/**
 * The pedagogical step BEFORE the bracketing: the passage broken into clause
 * lines, dependent clauses indented under what they modify, word order kept.
 * Lines are contiguous — each line's start is the previous line's end + 1 —
 * so the flow covers one gapless corpus range.
 */
export interface TextFlow {
  lines: TextFlowLine[];
}

export interface Document {
  schemaVersion: 1 | 2;
  propositions: Proposition[];
  /** The text flow, when one has been started; absent until then. */
  textFlow?: TextFlow;
  /**
   * Color blocks: the breaks that BEGIN one, in proposition order. The
   * document always opens inside its first block (first palette color), so
   * the first proposition is never listed; absent or empty means the passage
   * is one undivided block. Documents written before colors were stored may
   * carry plain pid strings (see normalizeBreaks); the editor always writes
   * {start, color}.
   */
  sections?: (SectionBreak | string)[];
  /** v1 only: the single connected root. Absent in v2. */
  tree?: TreeNode;
  /** v2: ordered forest roots. Absent in v1. */
  forest?: TreeNode[];
}

/**
 * A v2 document with its forest materialized — what normalizeDocument returns
 * and what the editor writes back.
 */
export interface DocumentV2 extends Document {
  schemaVersion: 2;
  forest: TreeNode[];
}

export interface AnalysisSummary {
  id: string;
  title: string;
  passageRef: string;
  updatedAt: string;
}

export interface Analysis extends AnalysisSummary {
  document: Document;
  /** Exegetical comments on the analysis as a whole; '' when never written. */
  notes: string;
}

/** A row of Recently Deleted: what it was, and how long it has left. */
export interface DeletedAnalysisSummary extends AnalysisSummary {
  deletedAt: string;
  /** Whole days before it is purged for good. */
  daysLeft: number;
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
  /** TBESG transliteration (STEPBible.org, CC BY 4.0), null when unglossed. */
  translit: string | null;
  /** TBESG short English gloss, null when the lemma has no entry. */
  gloss: string | null;
  /** BSB contextual English of THIS word in THIS verse (null ≈0.4%). */
  eng: string | null;
  /** BSB English word-order key — relative order within one verse only. */
  engOrd: number | null;
}

/** One English (BSB) verse from GET /api/corpus/verses. */
export interface VerseText {
  book: number;
  chapter: number;
  verse: number;
  /** Corpus index of the verse's FIRST word (may precede the fetched range). */
  start: number;
  ref: string;
  text: string;
}

export interface TaxonomyEntry {
  code: string;
  name: string;
  /** What the relationship is, in the course's terms — behind the menu's "i". */
  description: string;
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
