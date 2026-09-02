// The TEXT FLOW's core: the passage laid out as clause lines, and the four
// edits an analyst makes to it. Every function here is pure — a flow goes in,
// a NEW flow comes out — so the panel above it only has to render and to hand
// the result back to the document.
//
// The one invariant every function keeps: the lines are CONTIGUOUS and in
// order. Each line's start is the previous line's end + 1, so the flow covers
// one gapless corpus range and no word of the passage can be lost or doubled
// by an edit. An edit that cannot keep that (or the embedding rules below)
// changes nothing and returns the flow it was given, unchanged.
//
// Where the lines are DIVIDED is not the flow's own: one line per corpus
// proposition, always, whichever view the analyst divided in. reconcileFlow
// re-cuts a flow to the propositions after such an edit, keeping the indents
// and embeddings that still fit; isAligned says whether it need run at all.

import type { CorpusWord, TextFlow, TextFlowEmbedded, TextFlowLine } from '../types';

/** Deepest indentation a clause may take. */
export const MAX_INDENT = 8;

/** How far one press of ◀ / ▶ (or Tab) moves a line. */
export const INDENT_STEP = 1;

/**
 * Sentence-final punctuation in the SBLGNT: the full stop, the Greek question
 * mark (which is a semicolon), and the raised dot.
 */
const SENTENCE_ENDERS = new Set(['.', ';', '·']);

/** Closing marks that may FOLLOW the stop — quotes and brackets close after it. */
const TRAILING_CLOSERS = /[)\]}»›"'’”›»]+$/u;

/** Does this word end a sentence? Trailing quotes/brackets do not hide the stop. */
export function isSentenceEnd(word: Pick<CorpusWord, 'text'> | string): boolean {
  const text = (typeof word === 'string' ? word : word.text).trim().replace(
    TRAILING_CLOSERS,
    '',
  );
  const last = text.slice(-1);
  return last !== '' && SENTENCE_ENDERS.has(last);
}

/**
 * The starting flow: one line per SENTENCE, every line flush left. The
 * analyst divides those sentences into clauses from there.
 *
 * `words` is the passage in corpus order; a trailing sentence that never
 * closes still becomes its own line.
 */
export function initTextFlow(words: readonly CorpusWord[]): TextFlow {
  const lines: TextFlowLine[] = [];
  let start: number | null = null;
  for (const word of words) {
    if (start === null) start = word.index;
    if (isSentenceEnd(word)) {
      lines.push({ start, end: word.index, indent: 0 });
      start = null;
    }
  }
  const last = words[words.length - 1];
  if (start !== null && last !== undefined) {
    lines.push({ start, end: last.index, indent: 0 });
  }
  return { lines };
}

/** Index of the line holding this corpus word, or -1. */
export function lineIndexOf(flow: TextFlow, wordIndex: number): number {
  return flow.lines.findIndex((l) => wordIndex >= l.start && wordIndex <= l.end);
}

/** The embedded range covering this word on its line, if any. */
export function embeddedAt(flow: TextFlow, wordIndex: number): TextFlowEmbedded | null {
  const line = flow.lines[lineIndexOf(flow, wordIndex)];
  if (line === undefined) return null;
  return (line.embedded ?? []).find((e) => wordIndex >= e.start && wordIndex <= e.end) ?? null;
}

/** Does this line open a new sentence — i.e. did the line above close one? */
export function startsSentence(
  flow: TextFlow,
  lineIdx: number,
  words: ReadonlyMap<number, CorpusWord>,
): boolean {
  if (lineIdx <= 0) return true;
  const prev = flow.lines[lineIdx - 1];
  if (prev === undefined) return true;
  const last = words.get(prev.end);
  return last !== undefined && isSentenceEnd(last);
}

function withEmbedded(line: TextFlowLine, embedded: TextFlowEmbedded[]): TextFlowLine {
  const out: TextFlowLine = { start: line.start, end: line.end, indent: line.indent };
  if (embedded.length > 0) out.embedded = embedded;
  return out;
}

/**
 * Divide a line after `wordIndex`: the words up to it stay, the rest become
 * the next line at the same indent. A no-op on the last word of a line
 * (nothing left to divide) or when an embedded range would be cut in two —
 * remove the embedding first, then split.
 */
export function splitLineAfter(flow: TextFlow, wordIndex: number): TextFlow {
  const idx = lineIndexOf(flow, wordIndex);
  const line = flow.lines[idx];
  if (line === undefined || wordIndex === line.end) return flow;
  const embedded = line.embedded ?? [];
  if (embedded.some((e) => e.start <= wordIndex && e.end > wordIndex)) return flow;
  const head = withEmbedded(
    { start: line.start, end: wordIndex, indent: line.indent },
    embedded.filter((e) => e.end <= wordIndex),
  );
  const tail = withEmbedded(
    { start: wordIndex + 1, end: line.end, indent: line.indent },
    embedded.filter((e) => e.start > wordIndex),
  );
  const lines = [...flow.lines];
  lines.splice(idx, 1, head, tail);
  return { lines };
}

/**
 * Join a line to the one below it. The merged line keeps THIS line's indent
 * (the one above is the one the reader has already placed) and both lines'
 * embeddings. A no-op on the last line.
 */
export function mergeWithNext(flow: TextFlow, lineIdx: number): TextFlow {
  const line = flow.lines[lineIdx];
  const next = flow.lines[lineIdx + 1];
  if (line === undefined || next === undefined) return flow;
  const merged = withEmbedded(
    { start: line.start, end: next.end, indent: line.indent },
    [...(line.embedded ?? []), ...(next.embedded ?? [])],
  );
  const lines = [...flow.lines];
  lines.splice(lineIdx, 2, merged);
  return { lines };
}

/** Move one line in or out by `delta` steps, clamped to 0..MAX_INDENT. */
export function indentLine(flow: TextFlow, lineIdx: number, delta: number): TextFlow {
  const line = flow.lines[lineIdx];
  if (line === undefined) return flow;
  const indent = Math.max(0, Math.min(MAX_INDENT, line.indent + delta));
  if (indent === line.indent) return flow;
  const lines = [...flow.lines];
  lines[lineIdx] = { ...line, indent };
  return { lines };
}

/**
 * The flow's line DIVISIONS are the document's: one line per corpus
 * proposition, in the same order. Is this flow already that?
 */
export function isAligned(
  flow: TextFlow | null,
  props: readonly { start: number; end: number }[],
): boolean {
  if (flow === null || flow.lines.length !== props.length) return false;
  return props.every((p, i) => flow.lines[i]!.start === p.start && flow.lines[i]!.end === p.end);
}

/**
 * Re-cut a flow to the propositions: exactly one line per proposition, in
 * order. The flow keeps what is its OWN — the indents and the embedded
 * stretches — as far as they still make sense:
 *
 *   * a line's indent is the indent of the old line its first word sat on
 *     (0 where there was none), so a divided line leaves both halves where
 *     the reader had put it and a joined one keeps the upper line's place;
 *   * an embedded stretch survives if it still falls entirely inside ONE new
 *     line; one that a new division would cut in two is dropped.
 *
 * With no flow at all, every line comes back flush left.
 */
export function reconcileFlow(
  flow: TextFlow | null,
  props: readonly { start: number; end: number }[],
): TextFlow {
  const marks = flow === null ? [] : flow.lines.flatMap((l) => l.embedded ?? []);
  const lines = props.map((p) => {
    const old = flow === null ? undefined : flow.lines[lineIndexOf(flow, p.start)];
    return withEmbedded(
      { start: p.start, end: p.end, indent: old?.indent ?? 0 },
      marks.filter((e) => e.start >= p.start && e.end <= p.end),
    );
  });
  return { lines };
}

/**
 * Set off — or release — the words from `from` to `to` (either order).
 *
 *   * an existing range with exactly these bounds is REMOVED;
 *   * otherwise the range is added, kept in start order;
 *   * a range that would overlap an existing one, or that crosses a line
 *     boundary, is refused: the flow comes back untouched.
 */
export function toggleEmbedded(
  flow: TextFlow,
  from: number,
  to: number,
  style: TextFlowEmbedded['style'],
): TextFlow {
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  const idx = lineIndexOf(flow, start);
  const line = flow.lines[idx];
  // Both ends must sit on the SAME line: an embedding belongs to a clause.
  if (line === undefined || end > line.end) return flow;
  const embedded = line.embedded ?? [];
  const existing = embedded.findIndex((e) => e.start === start && e.end === end);
  let next: TextFlowEmbedded[];
  if (existing >= 0) {
    next = embedded.filter((_, i) => i !== existing);
  } else {
    if (embedded.some((e) => start <= e.end && end >= e.start)) return flow;
    next = [...embedded, { start, end, style }].sort((a, b) => a.start - b.start);
  }
  const lines = [...flow.lines];
  lines[idx] = withEmbedded(line, next);
  return { lines };
}
