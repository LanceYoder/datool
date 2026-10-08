// The TEXT FLOW panel: the passage read as clause lines, edited the way a
// plain text editor is (ruled 2026-09-17) — and nothing more. It owns no
// document state: every edit runs one pure command from textflow.ts and hands
// the new flow up, exactly as the bracket editor hands its document up.
//
//   click anywhere on a line   the cursor lands there — between the words
//                              nearest the click, or past the line's end
//   ( ) [ ]                    typed at the cursor: the handout's marks
//   Backspace / Delete         take a typed mark back
//   ← → Home End               walk the cursor along the line; ↑ ↓ change line
//   Tab / Shift+Tab            move the line in / out one step
//   Enter                      divide the line at the cursor — which divides
//                              the PROPOSITION, since the lines are the
//                              propositions (one per line, both views)
//   Backspace at a line's start,
//   Delete at a line's end     join it to the line above / below (the same
//                              division, from the other side)
//
// The words themselves cannot be retyped: the flow preserves the word order
// by construction, which is the handout's one rule for embedding ("do not
// change the word order of the text"). There are no buttons, no menus and no
// right-click gesture: the mouse places the cursor, the keys do the rest.
//
// The panel never starts a flow: the page always has one for it (the flow the
// document carries, or the one the first pass derives for the passage, re-cut
// to the propositions), and while that is on its way the panel waits.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import type { CorpusWord, TextFlow, TextFlowLine } from '../types';
import { errorMessages, getCorpusWords } from '../api';
import { displayWordText } from '../editor/convert';
import {
  INDENT_STEP,
  type Caret,
  indentLine,
  insertMark,
  isMarkChar,
  markAt,
  removeMark,
  startsSentence,
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
   * Whether the flow may be SHAPED here — indented and marked. False for a
   * professor reading a student's work: the passage still reads as clause
   * lines, and the cursor and the keys are gone (§8). No class rule ever sets
   * it — the flow is always the student's to edit (§5).
   *
   * Dividing the lines is NOT this flag's: the lines are propositions, and
   * the page withholds the two callbacks above instead when it is read-only.
   */
  editable?: boolean;
}

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
  const [caret, setCaret] = useState<Caret | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  // Where the cursor goes once a division has come back as a new flow: the
  // division is made in the document, and the line to stand on does not exist
  // until the page hands the re-cut flow down.
  const pendingCaret = useRef<Caret | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);
  // Where the panel stood on screen when a division was asked for. The tree
  // above gains or loses a row with it, which would push the flow down or
  // pull it up under the reader's hands — so once the new flow is in, the
  // page is scrolled by exactly the difference and the flow stays put.
  const anchorTop = useRef<number | null>(null);

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

  // A division has landed: put the cursor where the gesture left it — the
  // start of the new line after Enter, the join after Backspace — and give
  // that line the keyboard, so Tab indents THE NEW LINE and Backspace at its
  // start undoes the Enter.
  useLayoutEffect(() => {
    const wanted = pendingCaret.current;
    if (wanted === null || flow === null) return;
    const idx = flow.lines.findIndex((l) => wanted.at >= l.start && wanted.at <= l.end);
    if (idx < 0) return;
    pendingCaret.current = null;
    setCaret(wanted);
    const el = bodyRef.current?.children[idx];
    // preventScroll: the pin below decides where the page stands.
    if (el instanceof HTMLElement) el.focus({ preventScroll: true });

    // Pin the panel where it was. The editor's own scroll-keeping puts the
    // page back where it WAS for a couple of frames after a division; the
    // pin runs after it each time, so the last word is the flow's.
    const anchor = anchorTop.current;
    anchorTop.current = null;
    if (anchor === null || typeof window === 'undefined') return;
    const pin = () => {
      const section = sectionRef.current;
      if (section === null) return;
      const delta = section.getBoundingClientRect().top - anchor;
      if (Math.abs(delta) > 0.5) window.scrollBy(0, delta);
    };
    pin();
    if (typeof window.requestAnimationFrame !== 'function') return;
    window.requestAnimationFrame(() => {
      pin();
      window.requestAnimationFrame(() => {
        pin();
        window.requestAnimationFrame(pin);
      });
    });
  }, [flow]);

  // Escape puts the cursor away.
  useEffect(() => {
    if (caret === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCaret(null);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [caret]);

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

  const commit = (next: TextFlow) => {
    if (next !== flow) onChange(next);
  };

  /** The line element at this index — the lines are the body's children. */
  const lineElement = (lineIdx: number): HTMLElement | null => {
    const el = bodyRef.current?.children[lineIdx];
    return el instanceof HTMLElement ? el : null;
  };

  /**
   * Where a click on a line puts the cursor: on the side of the word under
   * the pointer that was clicked, else in the gap nearest the pointer, else —
   * past the last word — at the line's end. Exactly where a text editor's
   * would land.
   */
  const caretFromClick = (line: TextFlowLine, lineEl: HTMLElement, event: ReactMouseEvent): Caret => {
    const target = event.target instanceof Element ? event.target.closest('.textflow-word') : null;
    const wordEls = [...lineEl.querySelectorAll<HTMLElement>('.textflow-word')];
    const x = event.clientX;
    const sideOf = (el: HTMLElement): Caret['side'] => {
      const r = el.getBoundingClientRect();
      return x < r.left + r.width / 2 ? 'before' : 'after';
    };
    if (target instanceof HTMLElement) {
      return { at: Number(target.dataset.index), side: sideOf(target) };
    }
    for (const el of wordEls) {
      const r = el.getBoundingClientRect();
      if (x < r.left) return { at: Number(el.dataset.index), side: 'before' };
      if (x <= r.right) return { at: Number(el.dataset.index), side: sideOf(el) };
    }
    return { at: line.end, side: 'after' };
  };

  const onLineMouseDown = (event: ReactMouseEvent<HTMLDivElement>, lineIdx: number) => {
    if (!editable || event.button !== 0) return;
    const line = flow.lines[lineIdx];
    if (line === undefined) return;
    event.preventDefault(); // no text selection: the cursor is ours
    setCaret(caretFromClick(line, event.currentTarget, event));
    event.currentTarget.focus();
  };

  /**
   * A click on the body itself — in the gap between two sentences, in the
   * padding, or below the last line: the cursor goes to the line NEAREST the
   * pointer, at the place on it the pointer's x names (past the end, when
   * the click was out to the right, as it usually is).
   */
  const onBodyMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!editable || event.target !== event.currentTarget) return;
    const y = event.clientY;
    let best: { idx: number; el: HTMLElement; distance: number } | null = null;
    flow.lines.forEach((_, idx) => {
      const el = lineElement(idx);
      if (el === null) return;
      const r = el.getBoundingClientRect();
      const distance = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      if (best === null || distance < best.distance) best = { idx, el, distance };
    });
    if (best === null) return;
    const { idx, el } = best as { idx: number; el: HTMLElement };
    const line = flow.lines[idx];
    if (line === undefined) return;
    event.preventDefault();
    setCaret(caretFromClick(line, el, event));
    el.focus();
  };

  /** Walk the cursor one step along its line; it stops at the line's ends. */
  const stepCaret = (line: TextFlowLine, from: Caret, dir: -1 | 1): Caret => {
    if (dir === 1) {
      if (from.side === 'before') return { at: from.at, side: 'after' };
      return from.at < line.end ? { at: from.at + 1, side: 'after' } : from;
    }
    if (from.side === 'after') return { at: from.at, side: 'before' };
    return from.at > line.start ? { at: from.at - 1, side: 'before' } : from;
  };

  /** The same place on another line, as far as that line reaches. */
  const moveToLine = (from: Caret, fromLine: TextFlowLine, lineIdx: number) => {
    const to = flow.lines[lineIdx];
    if (to === undefined) return;
    const offset = from.at - fromLine.start;
    const at = Math.min(to.start + offset, to.end);
    setCaret({ at, side: from.side });
    lineElement(lineIdx)?.focus();
  };

  const onLineKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>, lineIdx: number) => {
    if (event.target !== event.currentTarget || !editable) return;
    const line = flow.lines[lineIdx];
    if (line === undefined) return;
    if (event.key === 'Tab') {
      event.preventDefault();
      commit(indentLine(flow, lineIdx, event.shiftKey ? -INDENT_STEP : INDENT_STEP));
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    // Everything below is the cursor's, and the cursor must be on THIS line.
    const here = caret !== null && caret.at >= line.start && caret.at <= line.end ? caret : null;
    if (here === null) return;
    const atLineStart = here.side === 'before' && here.at === line.start;
    const atLineEnd = here.side === 'after' && here.at === line.end;

    if (isMarkChar(event.key)) {
      event.preventDefault();
      commit(insertMark(flow, here, event.key));
      return;
    }
    switch (event.key) {
      case 'Enter': {
        // Divide at the cursor: after the word to its left. At a line's very
        // start or end there is nothing to divide.
        event.preventDefault();
        const after = here.side === 'after' ? here.at : here.at - 1;
        if (after >= line.start && after < line.end) {
          pendingCaret.current = { at: after + 1, side: 'before' };
          anchorTop.current = sectionRef.current?.getBoundingClientRect().top ?? null;
          onSplitWord?.(after);
        }
        return;
      }
      case 'Backspace': {
        event.preventDefault();
        const next = removeMark(flow, here);
        if (next !== flow) {
          commit(next);
          return;
        }
        // Nothing typed to take back: at the line's start, Backspace joins
        // the line to the one above (the division from the other side).
        const above = flow.lines[lineIdx - 1];
        if (atLineStart && above !== undefined) {
          pendingCaret.current = { at: line.start, side: 'before' };
          anchorTop.current = sectionRef.current?.getBoundingClientRect().top ?? null;
          onMergeAfterLine?.(above.end);
        }
        return;
      }
      case 'Delete': {
        event.preventDefault();
        if (atLineEnd) {
          if (lineIdx + 1 < flow.lines.length) {
            pendingCaret.current = here;
            anchorTop.current = sectionRef.current?.getBoundingClientRect().top ?? null;
            onMergeAfterLine?.(line.end);
          }
          return;
        }
        // The character past the cursor: this word's marks when the cursor is
        // before it, else the next word's before-marks.
        const forward: Caret =
          here.side === 'before' ? here : { at: here.at + 1, side: 'before' };
        commit(removeMark(flow, forward, true));
        return;
      }
      case 'ArrowLeft':
      case 'ArrowRight':
        event.preventDefault();
        setCaret(stepCaret(line, here, event.key === 'ArrowLeft' ? -1 : 1));
        return;
      case 'Home':
        event.preventDefault();
        setCaret({ at: line.start, side: 'before' });
        return;
      case 'End':
        event.preventDefault();
        setCaret({ at: line.end, side: 'after' });
        return;
      case 'ArrowUp':
      case 'ArrowDown':
        event.preventDefault();
        moveToLine(here, line, lineIdx + (event.key === 'ArrowUp' ? -1 : 1));
        return;
      default:
        return;
    }
  };

  // ---- The lines ----------------------------------------------------------

  let lastVerse: number | null = null;
  const caretBar = <span className="textflow-caret" aria-hidden="true" />;

  /**
   * One line's words, with the typed marks and the cursor where they fall.
   * The cursor before a word stands between its before-marks and the word;
   * after a word, past its after-marks — so what is typed appears at the
   * cursor and Backspace takes what is just left of it.
   */
  const renderWords = (line: TextFlowLine): ReactNode[] => {
    const out: ReactNode[] = [];
    for (let i = line.start; i <= line.end; i += 1) {
      const word = byIndex.get(i);
      if (word === undefined) continue;
      const newVerse = lastVerse !== word.verse;
      lastVerse = word.verse;
      const mark = markAt(line, i);
      const before = caret !== null && caret.at === i && caret.side === 'before';
      const after = caret !== null && caret.at === i && caret.side === 'after';
      if (i > line.start) out.push(' ');
      out.push(
        <span key={i} className="textflow-token">
          {newVerse && <sup className="ev">{word.verse}</sup>}
          {mark?.before && <span className="textflow-mark">{mark.before}</span>}
          {before && caretBar}
          <span className="textflow-word" data-index={i}>
            {displayWordText(word.text)}
          </span>
          {mark?.after && <span className="textflow-mark">{mark.after}</span>}
          {after && caretBar}
        </span>,
      );
    }
    return out;
  };

  return (
    <section className="textflow-panel has-flow" ref={sectionRef}>
      {heading}
      <div className="textflow-body" ref={bodyRef} onMouseDown={onBodyMouseDown}>
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
            onMouseDown={(event) => onLineMouseDown(event, lineIdx)}
            onKeyDown={(event) => onLineKeyDown(event, lineIdx)}
            onBlur={(event) => {
              // Focus moving to another line will set its own cursor; leaving
              // the flow altogether takes the cursor with it.
              const to = event.relatedTarget;
              if (!(to instanceof HTMLElement && to.classList.contains('textflow-line'))) {
                setCaret(null);
              }
            }}
          >
            <span className="textflow-text greek">{renderWords(line)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
