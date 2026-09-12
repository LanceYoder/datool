// The TEXT FLOW panel: the passage read as clause lines, and the gestures
// that shape it. It owns no document state — every edit runs one pure command
// from textflow.ts and hands the new flow up, exactly as the bracket editor
// hands its document up.
//
//   right-click a word    divide the line after it — or, on the line's LAST
//                         word, join it to the line below. Exactly the tree's
//                         gesture, because it is the same division: one line
//                         per proposition, so either view divides both
//   click a word          a small popover: begin an embedding — or, inside
//                         one, release it
//   click a second word   completes the embedding, then ( ) or [ ] chooses
//                         how it is set off (same line only)
//   ◀ ▶ at a line's left  move the clause out / in one step; Tab and
//                         Shift+Tab do the same while the line has focus
//
// The panel never starts a flow: the page always has one for it (the flow the
// document carries, or the one the first pass derives for the passage, re-cut
// to the propositions), and while that is on its way the panel waits.
//
// Escape and a click outside close whatever is open.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import type { CorpusWord, TextFlow, TextFlowEmbedded, TextFlowLine } from '../types';
import { errorMessages, getCorpusWords } from '../api';
import { displayWordText } from '../editor/convert';
import {
  embeddedAt,
  indentLine,
  lineIndexOf,
  startsSentence,
  toggleEmbedded,
} from './textflow';

export interface TextFlowPanelProps {
  /** The document's flow, or null while the page is still deriving one. */
  flow: TextFlow | null;
  /** The passage's inclusive corpus range, or null when it has no corpus words. */
  range: { start: number; end: number } | null;
  onChange: (flow: TextFlow) => void;
  /**
   * Divide the PROPOSITION after this corpus word — the flow's lines are its
   * propositions, so the division is made where they live, in the document,
   * and comes back to the panel as a new flow.
   */
  onSplitWord?: (corpusIndex: number) => void;
  /** Join the line ending at this corpus word to the one below it. */
  onMergeAfterLine?: (corpusIndex: number) => void;
  /**
   * Whether the flow may be SHAPED here — indented and embedded. False for a
   * professor reading a student's work: the passage still reads as clause
   * lines, and the ◀ ▶ and the embedding popover are gone (§8). No class rule
   * ever sets it — the flow is always the student's to edit (§5).
   *
   * Dividing the lines is NOT this flag's: the lines are propositions, and
   * the page withholds the two callbacks above instead when it is read-only.
   */
  editable?: boolean;
}

/** What is open over the lines, if anything. */
type Popover =
  | { kind: 'word'; wordIndex: number; at: { x: number; y: number } }
  | { kind: 'style'; from: number; to: number; at: { x: number; y: number } };

export default function TextFlowPanel({
  flow,
  range,
  onChange,
  onSplitWord,
  onMergeAfterLine,
  editable = true,
}: TextFlowPanelProps) {
  const [words, setWords] = useState<CorpusWord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [popover, setPopover] = useState<Popover | null>(null);
  // The first word of an embedding being drawn; the next click completes it.
  const [anchor, setAnchor] = useState<number | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (range === null) {
      setWords([]);
      return;
    }
    let cancelled = false;
    setWords(null);
    setLoadError(null);
    getCorpusWords(range.start, range.end)
      .then((ws) => {
        if (!cancelled) setWords(ws);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(errorMessages(err).join('; '));
      });
    return () => {
      cancelled = true;
    };
  }, [range?.start, range?.end]);

  const byIndex = useMemo(
    () => new Map((words ?? []).map((w) => [w.index, w])),
    [words],
  );

  const close = useCallback(() => {
    setPopover(null);
    setAnchor(null);
  }, []);

  // Escape closes; so does a click anywhere outside the open popover.
  useEffect(() => {
    if (popover === null && anchor === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    const onDown = (event: MouseEvent) => {
      const el = popoverRef.current;
      if (el !== null && event.target instanceof Node && el.contains(event.target)) return;
      setPopover(null);
    };
    window.addEventListener('keydown', onKey);
    window.document.addEventListener('mousedown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.document.removeEventListener('mousedown', onDown, true);
    };
  }, [popover, anchor, close]);

  const heading = <h2>Text flow</h2>;

  if (range === null) {
    return (
      <section className="textflow-panel">
        {heading}
        <p className="muted">Text flow needs a corpus passage.</p>
      </section>
    );
  }
  if (loadError !== null) {
    return (
      <section className="textflow-panel">
        {heading}
        <p className="muted">Text flow unavailable: {loadError}</p>
      </section>
    );
  }
  // The words, or the flow the page is deriving for them, may still be out.
  if (words === null || flow === null || flow.lines.length === 0) {
    return (
      <section className="textflow-panel">
        {heading}
        <p className="muted">Loading…</p>
      </section>
    );
  }

  /** Where a popover opens: just under the word that was clicked. */
  const anchorPoint = (target: HTMLElement) => {
    const body = bodyRef.current;
    const rect = target.getBoundingClientRect();
    if (body === null) return { x: rect.left, y: rect.bottom };
    const box = body.getBoundingClientRect();
    return { x: rect.left - box.left, y: rect.bottom - box.top + 4 };
  };

  const onWordClick = (wordIndex: number, target: HTMLElement) => {
    // Embedding is the click's only business here, so a locked flow has no
    // popover to open.
    if (!editable) return;
    const at = anchorPoint(target);
    if (anchor !== null) {
      // Completing an embedding: the second word must be on the same line.
      if (lineIndexOf(flow, anchor) === lineIndexOf(flow, wordIndex)) {
        setPopover({ kind: 'style', from: anchor, to: wordIndex, at });
      } else {
        setPopover(null);
      }
      setAnchor(null);
      return;
    }
    setPopover((prev) =>
      prev !== null && prev.kind === 'word' && prev.wordIndex === wordIndex
        ? null
        : { kind: 'word', wordIndex, at },
    );
  };

  const commit = (next: TextFlow) => {
    close();
    if (next !== flow) onChange(next);
  };

  /**
   * Right-click divides, exactly as it does in the tree: after this word, or —
   * on the line's last word, where there is nothing left to divide — into the
   * line below. The division itself belongs to the PROPOSITIONS, so it is made
   * there (the editor's own commands, through AnalysisPage) and returns here
   * as a new flow.
   *
   * Which of the two gestures a word offers is this panel's business — it is
   * the shape of the line under the pointer, and nothing else knows it. WHETHER
   * the gesture can be made is not: that is §5.4 and §5.5, and the engine is
   * the judge (§7.9). So the passage's final word attempts its merge like any
   * other word and the command declines it — `mergeBelow` finds no proposition
   * below and dispatches nothing, exactly as the core refuses "nothing follows
   * this to merge it with". This used to be pre-filtered here with a second
   * copy of that rule; two judges of one question is how the two views drift.
   */
  const onWordContextMenu = (wordIndex: number) => {
    close();
    const line = flow.lines[lineIndexOf(flow, wordIndex)];
    if (line === undefined) return; // the word is on no line: no gesture at all
    if (wordIndex !== line.end) onSplitWord?.(wordIndex);
    else onMergeAfterLine?.(wordIndex);
  };

  // ---- The lines ----------------------------------------------------------

  let lastVerse: number | null = null;

  /** One line's words, with its embedded stretches wrapped where they fall. */
  const renderWords = (line: TextFlowLine): ReactNode[] => {
    const embedded = [...(line.embedded ?? [])].sort((a, b) => a.start - b.start);
    const out: ReactNode[] = [];
    let buffer: ReactNode[] = [];
    let open: TextFlowEmbedded | null = null;

    // Words separate here rather than by trailing spaces inside themselves,
    // so the wrapping marks hug their first and last words: "(A B C) D".
    const spaced = (nodes: ReactNode[]): ReactNode[] =>
      nodes.flatMap((n, j) => (j === 0 ? [n] : [' ', n]));

    const flush = () => {
      if (buffer.length === 0) return;
      if (out.length > 0) out.push(' ');
      if (open === null) {
        out.push(...spaced(buffer));
      } else {
        const marks = open.style === 'paren' ? ['(', ')'] : ['[', ']'];
        out.push(
          <span className="textflow-embedded" key={`emb-${open.start}`}>
            {marks[0]}
            {spaced(buffer)}
            {marks[1]}
          </span>,
        );
      }
      buffer = [];
    };

    for (let i = line.start; i <= line.end; i += 1) {
      const word = byIndex.get(i);
      if (word === undefined) continue;
      const covering = embedded.find((e) => i >= e.start && i <= e.end) ?? null;
      if (covering !== open) {
        flush();
        open = covering;
      }
      const newVerse = lastVerse !== word.verse;
      lastVerse = word.verse;
      buffer.push(
        <span key={i}>
          {newVerse && <sup className="ev">{word.verse}</sup>}
          <span
            className={
              anchor === i ? 'textflow-word textflow-anchor' : 'textflow-word'
            }
            onClick={(event) => {
              event.stopPropagation();
              onWordClick(i, event.currentTarget);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onWordContextMenu(i);
            }}
          >
            {displayWordText(word.text)}
          </span>
        </span>,
      );
    }
    flush();
    return out;
  };

  const onLineKeyDown = (event: ReactKeyboardEvent, lineIdx: number) => {
    // Only the LINE indents on Tab: a Tab from one of its buttons is still a
    // Tab out of the panel.
    if (event.key !== 'Tab' || event.target !== event.currentTarget) return;
    // Tab is the ◀ ▶ buttons' keyboard side-channel: it is gated with them.
    if (!editable) return;
    event.preventDefault();
    commit(indentLine(flow, lineIdx, event.shiftKey ? -1 : 1));
  };

  // ---- The popovers -------------------------------------------------------

  let popoverNode: ReactNode = null;
  if (popover !== null && popover.kind === 'word') {
    // Only the embedding lives here: dividing is the right-click's, on both
    // sides of the analysis.
    const line = flow.lines[lineIndexOf(flow, popover.wordIndex)];
    const inside = embeddedAt(flow, popover.wordIndex);
    if (line !== undefined) {
      popoverNode = (
        <div
          ref={popoverRef}
          className="popover textflow-popover"
          style={{ left: popover.at.x, top: popover.at.y }}
          role="menu"
        >
          {inside === null ? (
            <button
              type="button"
              className="popover-item"
              onClick={() => {
                setAnchor(popover.wordIndex);
                setPopover(null);
              }}
            >
              Embed from here…
            </button>
          ) : (
            <button
              type="button"
              className="popover-item"
              onClick={() => commit(toggleEmbedded(flow, inside.start, inside.end, inside.style))}
            >
              Remove embedding
            </button>
          )}
        </div>
      );
    }
  } else if (popover !== null) {
    popoverNode = (
      <div
        ref={popoverRef}
        className="popover textflow-popover"
        style={{ left: popover.at.x, top: popover.at.y }}
        role="menu"
      >
        <span className="textflow-popover-label muted">Set off with</span>
        <div className="textflow-style-row">
          <button
            type="button"
            onClick={() => commit(toggleEmbedded(flow, popover.from, popover.to, 'paren'))}
          >
            ( )
          </button>
          <button
            type="button"
            onClick={() => commit(toggleEmbedded(flow, popover.from, popover.to, 'bracket'))}
          >
            [ ]
          </button>
        </div>
      </div>
    );
  }

  return (
    <section className="textflow-panel has-flow">
      {heading}
      {anchor !== null && (
        <p className="muted textflow-hint" role="status">
          Click the word this embedding ends on — Escape to stop.
        </p>
      )}
      <div className="textflow-body" ref={bodyRef}>
        {flow.lines.map((line, lineIdx) => (
          <div
            key={line.start}
            className={
              startsSentence(flow, lineIdx, byIndex)
                ? 'textflow-line sentence-start'
                : 'textflow-line'
            }
            style={{ '--tf-indent': line.indent } as CSSProperties}
            tabIndex={editable ? 0 : undefined}
            onKeyDown={(event) => onLineKeyDown(event, lineIdx)}
          >
            <span className="textflow-indent">
              {editable && (
                <>
                  <button
                    type="button"
                    aria-label="Move line out"
                    title="Move this clause out"
                    onClick={() => commit(indentLine(flow, lineIdx, -1))}
                  >
                    ◀
                  </button>
                  <button
                    type="button"
                    aria-label="Move line in"
                    title="Move this clause in"
                    onClick={() => commit(indentLine(flow, lineIdx, 1))}
                  >
                    ▶
                  </button>
                </>
              )}
            </span>
            <span className="textflow-text greek">{renderWords(line)}</span>
          </div>
        ))}
        {popoverNode}
      </div>
    </section>
  );
}
