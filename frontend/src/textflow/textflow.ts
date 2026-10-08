// The TEXT FLOW's core: the passage laid out as clause lines, and the edits
// an analyst makes to it. Every function here is pure — a flow goes in, a NEW
// flow comes out — so the panel above it only has to render and to hand the
// result back to the document.
//
// The one invariant every function keeps: the lines are CONTIGUOUS and in
// order. Each line's start is the previous line's end + 1, so the flow covers
// one gapless corpus range and no word of the passage can be lost or doubled
// by an edit. An edit that cannot keep that changes nothing and returns the
// flow it was given, unchanged.
//
// Where the lines are DIVIDED is not the flow's own: one line per corpus
// proposition, always, whichever view the analyst divided in. reconcileFlow
// re-cuts a flow to the propositions after such an edit, keeping the indents
// and the typed marks; isAligned says whether it need run at all.
//
// The MARKS are the handout's parentheses and brackets around an embedded
// clause (Text Flow Instructions §10), typed by the analyst between the words
// exactly as in a text editor (ruled 2026-09-17): they belong to the word they
// stand beside, so a division or a join never has to cut one.

import type { CorpusWord, TextFlow, TextFlowLine, TextFlowMark } from '../types';

/** Deepest indentation a clause may take. */
export const MAX_INDENT = 8;

/** How far one press of Tab (or Shift+Tab) moves a line. */
export const INDENT_STEP = 1;

/** The only characters a mark may hold. */
export const MARK_CHARS = '()[]';

export function isMarkChar(ch: string): boolean {
  return ch.length === 1 && MARK_CHARS.includes(ch);
}

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

/** The marks on this word, if any. */
export function markAt(line: TextFlowLine, wordIndex: number): TextFlowMark | null {
  return (line.marks ?? []).find((m) => m.at === wordIndex) ?? null;
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

/** A line carrying exactly these marks — empty ones dropped, in word order. */
function withMarks(line: TextFlowLine, marks: readonly TextFlowMark[]): TextFlowLine {
  const out: TextFlowLine = { start: line.start, end: line.end, indent: line.indent };
  const kept = marks
    .filter((m) => (m.before ?? '') !== '' || (m.after ?? '') !== '')
    .map((m) => {
      const mark: TextFlowMark = { at: m.at };
      if (m.before) mark.before = m.before;
      if (m.after) mark.after = m.after;
      return mark;
    })
    .sort((a, b) => a.at - b.at);
  if (kept.length > 0) out.marks = kept;
  return out;
}

/**
 * A flow as this module understands it, whatever it was stored as: an older
 * document's `embedded` ranges (start, end, style) become the marks they
 * were drawn as — "(" before the first word, ")" after the last — and a line
 * that carries neither comes back as it is.
 */
export function normalizeFlow(flow: TextFlow | null): TextFlow | null {
  if (flow === null) return null;
  let changed = false;
  const lines = flow.lines.map((line) => {
    const legacy = (line as TextFlowLine & { embedded?: unknown }).embedded;
    if (!Array.isArray(legacy)) return line;
    changed = true;
    const marks: TextFlowMark[] = [...(line.marks ?? [])];
    for (const raw of legacy) {
      const span = raw as { start?: unknown; end?: unknown; style?: unknown };
      if (typeof span.start !== 'number' || typeof span.end !== 'number') continue;
      const [open, shut] = span.style === 'bracket' ? ['[', ']'] : ['(', ')'];
      addChar(marks, span.start, 'before', open, true);
      addChar(marks, span.end, 'after', shut, false);
    }
    return withMarks(line, marks);
  });
  return changed ? { lines } : flow;
}

/** Add one character to a word's before/after string, in place. */
function addChar(
  marks: TextFlowMark[],
  at: number,
  side: 'before' | 'after',
  ch: string,
  front: boolean,
): void {
  let mark = marks.find((m) => m.at === at);
  if (mark === undefined) {
    mark = { at };
    marks.push(mark);
  }
  const have = mark[side] ?? '';
  mark[side] = front ? ch + have : have + ch;
}

/**
 * Divide a line after `wordIndex`: the words up to it stay, the rest become
 * the next line at the same indent. A no-op on the last word of a line
 * (nothing left to divide). Each mark goes with its word.
 */
export function splitLineAfter(flow: TextFlow, wordIndex: number): TextFlow {
  const idx = lineIndexOf(flow, wordIndex);
  const line = flow.lines[idx];
  if (line === undefined || wordIndex === line.end) return flow;
  const marks = line.marks ?? [];
  const head = withMarks(
    { start: line.start, end: wordIndex, indent: line.indent },
    marks.filter((m) => m.at <= wordIndex),
  );
  const tail = withMarks(
    { start: wordIndex + 1, end: line.end, indent: line.indent },
    marks.filter((m) => m.at > wordIndex),
  );
  const lines = [...flow.lines];
  lines.splice(idx, 1, head, tail);
  return { lines };
}

/**
 * Join a line to the one below it. The merged line keeps THIS line's indent
 * (the one above is the one the reader has already placed) and both lines'
 * marks. A no-op on the last line.
 */
export function mergeWithNext(flow: TextFlow, lineIdx: number): TextFlow {
  const line = flow.lines[lineIdx];
  const next = flow.lines[lineIdx + 1];
  if (line === undefined || next === undefined) return flow;
  const merged = withMarks(
    { start: line.start, end: next.end, indent: line.indent },
    [...(line.marks ?? []), ...(next.marks ?? [])],
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
 * order. The flow keeps what is its OWN — the indents and the marks:
 *
 *   * a line's indent is the indent of the old line its first word sat on
 *     (0 where there was none), so a divided line leaves both halves where
 *     the reader had put it and a joined one keeps the upper line's place;
 *   * a mark stays on its word, whichever new line that word falls in.
 *
 * With no flow at all, every line comes back flush left.
 */
export function reconcileFlow(
  flow: TextFlow | null,
  props: readonly { start: number; end: number }[],
): TextFlow {
  const marks = flow === null ? [] : flow.lines.flatMap((l) => l.marks ?? []);
  const lines = props.map((p) => {
    const old = flow === null ? undefined : flow.lines[lineIndexOf(flow, p.start)];
    return withMarks(
      { start: p.start, end: p.end, indent: old?.indent ?? 0 },
      marks.filter((m) => m.at >= p.start && m.at <= p.end),
    );
  });
  return { lines };
}

/** Where the analyst's caret stands: just before or just after one word. */
export interface Caret {
  at: number;
  side: 'before' | 'after';
}

/**
 * Type one mark character at the caret — before its word, or after it. Any
 * other character, or a word outside the flow, changes nothing.
 */
export function insertMark(flow: TextFlow, caret: Caret, ch: string): TextFlow {
  if (!isMarkChar(ch)) return flow;
  const idx = lineIndexOf(flow, caret.at);
  const line = flow.lines[idx];
  if (line === undefined) return flow;
  const marks = (line.marks ?? []).map((m) => ({ ...m }));
  addChar(marks, caret.at, caret.side, ch, false);
  const lines = [...flow.lines];
  lines[idx] = withMarks(line, marks);
  return { lines };
}

/**
 * Backspace at the caret: the last character typed on that side of the word
 * goes — or, with `fromFront`, the first (Delete, reaching forward into the
 * next word's marks). Nothing there, nothing changes.
 */
export function removeMark(flow: TextFlow, caret: Caret, fromFront = false): TextFlow {
  const idx = lineIndexOf(flow, caret.at);
  const line = flow.lines[idx];
  if (line === undefined) return flow;
  const mark = markAt(line, caret.at);
  const have = mark?.[caret.side] ?? '';
  if (have === '') return flow;
  const left = fromFront ? have.slice(1) : have.slice(0, -1);
  const marks = (line.marks ?? []).map((m) =>
    m.at === caret.at ? { ...m, [caret.side]: left } : { ...m },
  );
  const lines = [...flow.lines];
  lines[idx] = withMarks(line, marks);
  return { lines };
}
