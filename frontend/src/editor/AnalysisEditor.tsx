// The bracketing editor's UI: Tiptap state + React node views for the
// proposition rows + the SVG margin overlay (BracketLayer) drawn from
// layout.ts, wired to the editor CORE in commands.ts.
//
// Every gesture is exactly ONE core command — nothing here recomputes labels,
// re-indexes propositions or repairs structure:
//
//   click a word          word-info popover (lemma, morphology, gloss) with
//                         "Split after" -> splitProposition when splittable
//   click a dot           select that dot (EVERY dot is clickable, connected
//                         or not — reconnecting dissolves the old connection);
//                         clicking the selected dot again unselects it
//   click a second dot    connectUnits(first, second) -> the relationship menu
//                         opens on the new bracket; a rejected pair shakes and
//                         keeps the first selection
//   click a label         the relationship menu: all 18 relationships grouped
//                         by family, each with its key and its definition
//   click a star          flipStar (the labels follow the star)
//   right-click a dot     remove the connections there (Delete does the same
//                         to a selected dot)
//   click a word          the word's card: lemma, morphology, gloss
//   right-click a word    split after it — or, on the last word, merge with
//                         the proposition below
//   toolbar               Undo / Redo / Clear tree, the reader's display
//                         switches, and "?"
//
// Selection state: one popover at a time (Escape and an outside click close
// it); the selected dot survives re-renders but is dropped whenever the
// document changes, because every position in the overlay has moved.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  EditorContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
} from '@tiptap/react';
import type { ReactNodeViewProps } from '@tiptap/react';
import type {
  CorpusWord,
  Document as AnalysisDocument,
  TaxonomyEntry,
} from '../types';
import { errorMessages, getCorpusWords, getTaxonomy } from '../api';
import { buildTextById, displayWordText, documentToNode, nodeToDocument } from './convert';
import { editorExtensions } from './editor';
import { EditorProposition } from './schema';
import {
  addSectionBreak,
  clearConnections,
  connectUnits,
  disconnectRoot,
  findBrackets,
  findPropositionPos,
  flipStar,
  mergeBelow,
  removeSectionBreak,
  sectionBreaks,
  setRelationship,
  splitProposition,
  unzipToRoot,
} from './commands';
import {
  COL_W,
  LABEL_GUTTER,
  STUB_W,
  computeColumns,
  fitsWidth,
  layoutBrackets,
  layoutDots,
  leafRefs,
} from './layout';
import type { DotGeom, RowBox } from './layout';
import {
  canSplitAfter,
  clampPopover,
  mainPointRefs,
  parseDotId,
  rowEnglish,
} from './interaction';
import type { Point } from './interaction';
import { describeParsing } from './morph';
import BracketLayer from './BracketLayer';
import type { PositionedBracket, ShakeState } from './BracketLayer';
import RelationshipMenu from './RelationshipMenu';
import ColorSettings from './ColorSettings';
import SectionStrip from './SectionStrip';
import { sectionColor, sectionColorByPid, sectionsOf } from './sections';
import HelpPanel from './HelpPanel';
import { loadViewSettings, saveViewSettings } from './viewSettings';
import type { ViewSettings } from './viewSettings';

/** Width of the .verse-label column (--verse-label-w in styles.css) — the
 * layout's anchor. Keep the two in sync. */
const VERSE_LABEL_W = 72;

/** Nominal popover boxes, used to keep them inside the shell. */
const WORD_SIZE = { width: 280, height: 170 };
const MENU_SIZE = { width: 272, height: 400 };

/** Width the color-block strip stands in: the band plus air before the text. */
const STRIP_LANE = 26;

/** Clear space kept between the relationship menu and the text column. */
const TEXT_GAP = 12;

/** What the reader is told when a too-wide tree is cleared, and for how long. */
const TOO_WIDE_MESSAGE = 'That tree was wider than this window — connections cleared.';
const TOO_WIDE_MS = 8000;

/** How long a rejected connection shakes / the message stays up. */
const FLASH_MS = 1600;

// ---------------------------------------------------------------------------
// Row rendering (React node view)

interface RowContextValue {
  words: ReadonlyMap<number, CorpusWord>;
  /** The last proposition in the document — the one with nothing to merge. */
  lastPid: string | null;
  /**
   * The MAIN POINT's pids — where the star walk from the top lands — set only
   * when the analysis is complete (one tree holding every proposition).
   * These rows render red.
   */
  mainPids: ReadonlySet<string>;
  /** Reader's English-line toggle (viewSettings). */
  showEnglish: boolean;
  /** Reader's verb-bolding toggle (viewSettings). */
  showVerbs: boolean;
  /** Each pid's block COLOR (stored per block), or null while blocks are off. */
  sectionOf: ReadonlyMap<string, number> | null;
  /**
   * A single click on ANY word: the word-info popover (lemma, morphology,
   * gloss). `index` is the corpus word index, null for raw text.
   */
  onWordClick: (
    pid: string,
    ordinal: number,
    word: string,
    index: number | null,
    splittable: boolean,
    target: HTMLElement,
  ) => void;
  /** A right-click on a splittable word: split the proposition after it. */
  onWordSplit: (pid: string, ordinal: number) => void;
  onMergeBelow: (pid: string) => void;
}

const RowContext = createContext<RowContextValue | null>(null);

/** Word tokens of one proposition row, from its source attrs. */
function rowTokens(
  node: ReactNodeViewProps['node'],
  words: ReadonlyMap<number, CorpusWord>,
): { key: string | number; display: string; index?: number; verb?: boolean }[] {
  const { srcStart, srcEnd } = node.attrs as { srcStart: unknown; srcEnd: unknown };
  if (typeof srcStart === 'number' && typeof srcEnd === 'number') {
    const out = [];
    for (let i = srcStart; i <= srcEnd; i += 1) {
      const w = words.get(i);
      if (w !== undefined) {
        out.push({
          key: i,
          display: displayWordText(w.text),
          index: i,
          // MorphGNT marks every verb form — finite, participle, infinitive —
          // with the 'V-' part of speech.
          verb: w.pos === 'V-',
        });
      }
    }
    if (out.length > 0) return out;
  }
  return String(node.attrs.text ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((t, i) => ({ key: i, display: t }));
}

/** One word's class list: what it can do, and what it is. */
function wordClass(splittable: boolean, verb: boolean): string {
  return ['word', splittable ? 'splittable' : '', verb ? 'verb' : ''].filter(Boolean).join(' ');
}

/** The main point's red — wins over any stored per-proposition color. */
const MAIN_POINT_COLOR = '#b91c1c';

function PropositionRow({ node }: ReactNodeViewProps) {
  const ctx = useContext(RowContext);
  const pid = String(node.attrs.pid);
  const stored = typeof node.attrs.color === 'string' ? node.attrs.color : undefined;
  const isMain = ctx !== null && ctx.mainPids.has(pid);
  const color = isMain ? MAIN_POINT_COLOR : stored;
  const tokens = ctx !== null ? rowTokens(node, ctx.words) : [];

  // The English line is built from THIS row's own words, so it always
  // matches the proposition exactly, however the verses were divided.
  const { srcStart, srcEnd } = node.attrs as { srcStart: unknown; srcEnd: unknown };
  const english =
    ctx !== null && typeof srcStart === 'number' && typeof srcEnd === 'number'
      ? rowEnglish(srcStart, srcEnd, ctx.words)
      : [];

  // The block's color sits behind the whole row — English line included, so a
  // block reads as one band of the passage.
  const section = ctx?.sectionOf?.get(pid);
  const background = section === undefined ? undefined : sectionColor(section).background;

  return (
    <NodeViewWrapper
      as="div"
      className={isMain ? 'prop-row main-point' : 'prop-row'}
      data-pid={pid}
      style={background === undefined ? undefined : { background }}
    >
      {/* The English line spans the row above the label so the label's baseline
          is the GREEK's, not the reference text's. */}
      {ctx?.showEnglish === true && english.length > 0 && (
        <div className="english-line" contentEditable={false}>
          {english.map((seg, i) => (
            <span key={i}>
              {seg.marker !== null && <span className="ev">{seg.marker}</span>} {seg.text}{' '}
            </span>
          ))}
        </div>
      )}
      <div className="prop-line">
        <span className="verse-label">{String(node.attrs.label)}</span>
        <div className="prop-body">
          <span className="prop-text greek" style={color !== undefined ? { color } : undefined}>
            {ctx !== null
              ? tokens.map((t, ordinal) => {
                  const splittable = canSplitAfter(ordinal, tokens.length);
                  // No hover tooltip: a click opens the word's card, which
                  // says everything the tooltip did and more.
                  return (
                    <span
                      key={t.key}
                      className={wordClass(splittable, t.verb === true && ctx.showVerbs)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        ctx.onWordClick(
                          pid,
                          ordinal,
                          t.display,
                          t.index ?? null,
                          splittable,
                          event.currentTarget,
                        );
                      }}
                      onContextMenu={(event) => {
                        // Right-click divides: after this word, or — on the
                        // last word, where there is nothing left to divide —
                        // into the proposition below.
                        event.preventDefault();
                        event.stopPropagation();
                        if (splittable) ctx.onWordSplit(pid, ordinal);
                        else if (ctx.lastPid !== pid) ctx.onMergeBelow(pid);
                      }}
                    >
                      {t.display}{' '}
                    </span>
                  );
                })
              : String(node.attrs.text)}
          </span>
        </div>
      </div>
    </NodeViewWrapper>
  );
}

const PropositionWithView = EditorProposition.extend({
  addNodeView() {
    return ReactNodeViewRenderer(PropositionRow);
  },
});

// ---------------------------------------------------------------------------

export interface AnalysisEditorProps {
  /** The loaded document (v1 or v2); the editor always emits v2. */
  document: AnalysisDocument;
  /** Fired after every edit with the document rebuilt from the editor. */
  onChange: (doc: AnalysisDocument) => void;
}

export default function AnalysisEditor({ document: baseDoc, onChange }: AnalysisEditorProps) {
  const [words, setWords] = useState<Map<number, CorpusWord> | null>(null);
  const [taxonomy, setTaxonomy] = useState<TaxonomyEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // One batched corpus fetch covering every corpus-sourced proposition; the
  // words carry their contextual English, so nothing else is needed for the
  // reference line.
  useEffect(() => {
    let cancelled = false;
    let min = Infinity;
    let max = -Infinity;
    for (const p of baseDoc.propositions) {
      if (p.source.kind === 'corpus') {
        min = Math.min(min, p.source.start);
        max = Math.max(max, p.source.end);
      }
    }
    if (min > max) {
      setWords(new Map());
    } else {
      getCorpusWords(min, max)
        .then((ws) => {
          if (!cancelled) setWords(new Map(ws.map((w) => [w.index, w])));
        })
        .catch((err: unknown) => {
          if (!cancelled) setLoadError(errorMessages(err).join('; '));
        });
    }
    getTaxonomy()
      .then((t) => {
        if (!cancelled) setTaxonomy(t);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(errorMessages(err).join('; '));
      });
    return () => {
      cancelled = true;
    };
  }, [baseDoc]);

  if (loadError !== null) {
    return <div className="error-box">{loadError}</div>;
  }
  if (words === null || taxonomy === null) {
    return <p className="muted">Loading…</p>;
  }
  return (
    <EditorInner baseDoc={baseDoc} words={words} taxonomy={taxonomy} onChange={onChange} />
  );
}

interface InnerProps {
  baseDoc: AnalysisDocument;
  words: Map<number, CorpusWord>;
  taxonomy: TaxonomyEntry[];
  onChange: (doc: AnalysisDocument) => void;
}

/** The one floating thing on screen, if any. */
type PopoverState =
  | {
      kind: 'word';
      pid: string;
      ordinal: number;
      word: string;
      /** Corpus index (null for raw text — no info to show). */
      index: number | null;
      splittable: boolean;
      at: Point;
    }
  | { kind: 'menu'; pos: number; at: Point | null };

interface Overlay {
  brackets: PositionedBracket[];
  dots: DotGeom[];
  margin: number;
  height: number;
  /** Every measured WHOLE row (English line included), by pid — what places
   * the color-block bands so they cover what the block background paints. */
  rowBoxes: ReadonlyMap<string, RowBox>;
  /** False when the tree needs more width than the shell can give it. */
  fits: boolean;
}

function EditorInner({ baseDoc, words, taxonomy, onChange }: InnerProps) {
  const [selectedDotId, setSelectedDotId] = useState<string | null>(null);
  // Where the pointer is while a dot is selected: the loose end of the
  // connection being made, drawn from the dot so the reader can see where the
  // next click would put it.
  const [pointer, setPointer] = useState<Point | null>(null);
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [shake, setShake] = useState<ShakeState | null>(null);
  // docTick advances on every document change, layoutTick on every measurement
  // (they are separate so re-observing rows can never feed itself).
  // Reader's display options (English line, bracket colors) — persisted per
  // browser, never part of the analysis.
  const [view, setView] = useState<ViewSettings>(loadViewSettings);
  const [colorPanel, setColorPanel] = useState(false);
  const [helpPanel, setHelpPanel] = useState(false);
  const [docTick, setDocTick] = useState(0);
  const [layoutTick, setLayoutTick] = useState(0);
  const shellRef = useRef<HTMLDivElement | null>(null);
  // The last overlay laid out from a complete set of row measurements, and
  // the rows the last measurement pass saw (see the re-measure effect).
  const lastOverlay = useRef<Overlay | null>(null);
  const measuredRows = useRef('');
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const flashTimer = useRef<number | null>(null);
  // onSplit is defined further down (it needs the editor); the row context is
  // built before it, so it reaches the command through this ref.
  const onSplitRef = useRef<(pid: string, ordinal: number) => void>(() => {});
  // The width check runs once per loaded document (see the effect below).
  const widthChecked = useRef(false);
  // onDotDelete is defined further down (it needs the editor); the key handler
  // above reaches it through this ref.
  const deleteDotRef = useRef<(dotId: string) => void>(() => {});
  const shakeSeq = useRef(0);

  const updateView = useCallback((next: ViewSettings) => {
    setView(next);
    saveViewSettings(next);
  }, []);

  const taxonomyByCode = useMemo(
    () => new Map(taxonomy.map((t) => [t.code, t])),
    [taxonomy],
  );

  const content = useMemo(() => {
    const wordList = [...words.values()];
    return documentToNode(baseDoc, buildTextById(baseDoc, wordList));
  }, [baseDoc, words]);

  const editor = useEditor(
    {
      extensions: [...editorExtensions(PropositionWithView)],
      content,
      editable: false,
      injectCSS: false,
      onUpdate: ({ editor: ed }) => {
        // Positions have moved: drop every position-keyed piece of UI state.
        // Commands that want to keep (or move) the selection set it again
        // right after they run — those setState calls land in the same batch
        // and win.
        setSelectedDotId(null);
        setPopover(null);
        onChange(nodeToDocument(ed.state.doc, baseDoc));
        setDocTick((t) => t + 1);
        setLayoutTick((t) => t + 1);
      },
    },
    [content],
  );

  // Re-measure when the shell or any row changes size. Observing fires the
  // callback once per target immediately, which is what first paints the
  // overlay; the effect itself must NOT depend on layoutTick or that initial
  // callback would re-arm itself forever. It watches the ROWS, never the
  // overlay: the overlay is redrawn from every tick, so watching it would
  // feed itself.
  useEffect(() => {
    const shell = shellRef.current;
    if (shell === null) return;
    const sizes = new ResizeObserver(() => {
      setLayoutTick((t) => t + 1);
    });
    sizes.observe(shell);
    for (const row of shell.querySelectorAll<HTMLElement>('[data-pid]')) {
      sizes.observe(row);
    }
    return () => {
      sizes.disconnect();
    };
  }, [editor, docTick]);

  // A document change reaches the DOM in two steps: ProseMirror swaps the rows
  // (a split's new row, a connect's re-created ones), then the React node
  // views fill them in a commit later. So after EVERY render, compare the rows
  // the DOM now holds with the ones the last layout pass measured, and
  // re-measure when they differ. This is what lands a split's or a connect's
  // geometry — and it cannot loop, because the comparison is against what was
  // measured, not against what was drawn: an unchanged DOM asks for nothing.
  useEffect(() => {
    const shell = shellRef.current;
    if (shell === null) return;
    const present: string[] = [];
    for (const el of shell.querySelectorAll<HTMLElement>('[data-pid]')) {
      const pid = el.dataset.pid;
      if (pid !== undefined && el.querySelector('.prop-text') !== null) present.push(pid);
    }
    if (present.join(',') !== measuredRows.current) {
      setLayoutTick((t) => t + 1);
    }
  });

  // Follow the pointer only while a connection is in progress — no selection,
  // no listener, so a resting analysis costs nothing.
  useEffect(() => {
    if (selectedDotId === null) {
      setPointer(null);
      return;
    }
    const shell = shellRef.current;
    if (shell === null) return;
    const onMove = (event: MouseEvent) => {
      const rect = shell.getBoundingClientRect();
      setPointer({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    };
    window.addEventListener('mousemove', onMove);
    return () => {
      window.removeEventListener('mousemove', onMove);
    };
  }, [selectedDotId]);

  // Escape closes the popover and clears every selection; Mod-z / Mod-Shift-z
  // undo/redo (the editor is not contenteditable, so the shortcuts are ours),
  // with native undo left alone inside text fields.
  useEffect(() => {
    if (editor === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPopover(null);
        setSelectedDotId(null);
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        const target = event.target;
        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          (target instanceof HTMLElement && target.isContentEditable)
        ) {
          return; // typing in a field, not acting on the analysis
        }
        if (selectedDotId === null) return;
        event.preventDefault();
        deleteDotRef.current(selectedDotId);
        return;
      }
      if (!(event.ctrlKey || event.metaKey)) return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        editor.commands.undo();
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        editor.commands.redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
    // selectedDotId is read by the Delete branch, so the handler is re-bound
    // whenever the selection changes.
  }, [editor, selectedDotId]);

  // Outside click closes the popover. The listener is added after the click
  // that opened it (popovers open on click, this listens for mousedown), so it
  // can never close its own opening gesture.
  useEffect(() => {
    if (popover === null) return;
    const onDown = (event: MouseEvent) => {
      const el = popoverRef.current;
      if (el !== null && event.target instanceof Node && el.contains(event.target)) return;
      setPopover(null);
    };
    window.document.addEventListener('mousedown', onDown, true);
    return () => {
      window.document.removeEventListener('mousedown', onDown, true);
    };
  }, [popover]);

  useEffect(
    () => () => {
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    },
    [],
  );

  /** Proposition ids in document order (the last one has no "Merge below"). */
  const pids = useMemo(() => {
    const out: string[] = [];
    if (editor !== null) {
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'proposition') {
          out.push(String(node.attrs.pid));
          return false;
        }
        return true;
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, docTick]);

  /** Color-block breaks — read off the propositions that begin the blocks. */
  const breaks = useMemo(
    () => (editor === null ? [] : sectionBreaks(editor.state.doc)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, docTick],
  );

  /** The completed analysis's main point (empty while the forest is loose). */
  const mainPids = useMemo<ReadonlySet<string>>(() => {
    if (editor === null) return new Set<string>();
    return new Set(mainPointRefs(nodeToDocument(editor.state.doc, baseDoc).forest));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, docTick, baseDoc]);


  // ---- Geometry -----------------------------------------------------------
  // Measure every row, then lay the whole FOREST out; layout brackets
  // (pre-order) zip index-for-index with the PM bracket positions.
  const overlay: Overlay | null = useMemo(() => {
    if (editor === null) return null;
    const shell = shellRef.current;
    if (shell === null) return null;
    const shellRect = shell.getBoundingClientRect();
    const rows = new Map<string, RowBox>();
    // Whole-row extents (English line included) for the color-block bands —
    // the bands must cover exactly what the block background paints.
    const blockBoxes = new Map<string, RowBox>();
    for (const el of shell.querySelectorAll<HTMLElement>('[data-pid]')) {
      const pid = el.dataset.pid;
      if (pid === undefined) continue;
      // Anchor ticks and dots to the GREEK line, not the whole row — the
      // English reference line above it must not pull the geometry off.
      // A row whose node view has not rendered yet has no .prop-text: leave
      // it UNMEASURED rather than measuring the empty wrapper.
      const target = el.querySelector<HTMLElement>('.prop-text');
      if (target === null) continue;
      const full = el.getBoundingClientRect();
      const fullTop = full.top - shellRect.top;
      blockBoxes.set(pid, {
        y: fullTop + full.height / 2,
        top: fullTop,
        bottom: fullTop + full.height,
      });
      const rect = target.getBoundingClientRect();
      const top = rect.top - shellRect.top;
      // A proposition that wraps is still ONE unit, and its handle belongs
      // where the reader's eye starts: the FIRST line. The first word is what
      // names that line (the text block itself measures all of them), while
      // top/bottom stay the whole proposition's extent.
      const firstWord = target.querySelector<HTMLElement>('.word');
      const line = firstWord === null ? rect : firstWord.getBoundingClientRect();
      rows.set(pid, {
        y: line.top - shellRect.top + line.height / 2,
        top,
        bottom: top + rect.height,
      });
    }
    measuredRows.current = [...rows.keys()].join(',');
    if (rows.size === 0) return null;

    const current = nodeToDocument(editor.state.doc, baseDoc);
    // A split or a merge changes the document a frame before its rows reach
    // the DOM. Laying out then would place the new proposition's dot at y=0 —
    // a phantom above the column — so keep the last good overlay until every
    // proposition is measured; the re-measure below follows immediately.
    for (const root of current.forest) {
      for (const ref of leafRefs(root)) {
        if (!rows.has(ref)) return lastOverlay.current;
      }
    }
    const { maxColumn } = computeColumns(current.forest);
    // The verse-label column (13a, 13b, …) is the workflow's anchor: pin its
    // center to the middle of the shell, so the tree has the whole left half
    // to grow into without ever shifting the words. Only a tree too deep for
    // that half pushes the text right (the Math.max arm).
    const need = Math.max(maxColumn * COL_W, STUB_W) + LABEL_GUTTER;
    const centered = Math.round(shellRect.width / 2 - VERSE_LABEL_W / 2);
    const margin = Math.max(need, centered);
    const fits = fitsWidth(current.forest, shellRect.width);
    const layout = layoutBrackets(
      current.forest,
      rows,
      margin,
      (rel) => taxonomyByCode.get(rel)?.labels,
    );
    const pmBrackets = findBrackets(editor.state.doc);
    const brackets = layout.brackets.map((geom) => ({
      ...geom,
      pos: pmBrackets[geom.preorderIndex]?.pos ?? -1,
    }));
    lastOverlay.current = {
      brackets,
      dots: layoutDots(current.forest, rows, margin),
      margin,
      height: shellRect.height,
      rowBoxes: blockBoxes,
      fits,
    };
    return lastOverlay.current;
    // docTick + layoutTick drive re-measurement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, docTick, layoutTick, baseDoc, taxonomyByCode]);

  // A tree deeper than the screen is wide draws itself off both edges: the
  // analysis reads as empty. Rather than show that, drop the connections the
  // document ARRIVED with and say so. The propositions are untouched; the
  // clearing itself stays OUT of the history, so a tree this window cannot
  // draw is not one keystroke from coming back. Only ever the loaded
  // document: a tree built by hand is the analyst's, however wide it grows.
  useEffect(() => {
    if (editor === null || overlay === null || widthChecked.current) return;
    widthChecked.current = true;
    if (overlay.fits || findBrackets(editor.state.doc).length === 0) return;
    clearConnections(editor, false);
    setFlash(TOO_WIDE_MESSAGE);
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => {
      flashTimer.current = null;
      setFlash(null);
    }, TOO_WIDE_MS);
  }, [editor, overlay]);

  const rowCtx = useMemo<RowContextValue>(
    () => ({
      words,
      showEnglish: view.english,
      showVerbs: view.verbs,
      sectionOf: view.blocks ? sectionColorByPid(pids, breaks) : null,
      lastPid: pids.length > 0 ? (pids[pids.length - 1] ?? null) : null,
      mainPids,
      onWordClick: (pid, ordinal, word, index, splittable, target) => {
        const shell = shellRef.current;
        if (shell === null) return;
        const shellRect = shell.getBoundingClientRect();
        const rect = target.getBoundingClientRect();
        const at = { x: rect.left - shellRect.left, y: rect.bottom - shellRect.top + 4 };
        setSelectedDotId(null);
        setPopover((prev) =>
          prev !== null && prev.kind === 'word' && prev.pid === pid && prev.ordinal === ordinal
            ? null // clicking the same word again dismisses the popover
            : { kind: 'word', pid, ordinal, word, index, splittable, at },
        );
      },
      onWordSplit: (pid, ordinal) => {
        onSplitRef.current(pid, ordinal);
      },
      onMergeBelow: (pid) => {
        if (editor === null) return;
        setPopover(null);
        mergeBelow(editor, pid, words);
      },
    }),
    [words, pids, mainPids, editor, view.english, view.verbs, view.blocks, breaks],
  );

  if (editor === null) return null;

  // ---- Gestures -----------------------------------------------------------
  // Each one runs a single core command; the state set afterwards is what
  // survives the reset onUpdate did while the command was dispatching.

  const bracketPosAt = (index: number): number | null =>
    findBrackets(editor.state.doc)[index]?.pos ?? null;

  const dotPos = (id: string): number | null => {
    const ref = parseDotId(id);
    if (ref === null) return null;
    return ref.kind === 'prop'
      ? findPropositionPos(editor.state.doc, ref.pid)
      : bracketPosAt(ref.index);
  };

  const rejectConnection = (dotId: string, message: string) => {
    shakeSeq.current += 1;
    setShake({ dotId, seq: shakeSeq.current });
    setFlash(message);
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => {
      flashTimer.current = null;
      setShake(null);
      setFlash(null);
    }, FLASH_MS);
  };

  /**
   * Right-click a dot — or select it and press Delete — to remove the
   * connections it names: a bracket's own connection, or every bracket above
   * a proposition.
   */
  const onDotDelete = (dotId: string) => {
    setPopover(null);
    setSelectedDotId(null);
    const ref = parseDotId(dotId);
    if (ref === null) return;
    if (ref.kind === 'bracket') {
      const pos = bracketPosAt(ref.index);
      if (pos !== null) disconnectRoot(editor, pos);
      return;
    }
    unzipToRoot(editor, ref.pid);
  };
  deleteDotRef.current = onDotDelete;

  const onDotClick = (dot: DotGeom) => {
    // Every dot is a live handle, connected or not: a click selects it, a
    // click on the SAME dot unselects it, and a click on a second dot
    // connects the two (dissolving any old connections above either unit —
    // connectUnits' job). No modifier keys.
    setPopover(null);
    if (selectedDotId === null) {
      setSelectedDotId(dot.id);
      return;
    }
    if (selectedDotId === dot.id) {
      setSelectedDotId(null);
      return;
    }
    const posA = dotPos(selectedDotId);
    const posB = dotPos(dot.id);
    if (posA === null || posB === null) {
      rejectConnection(dot.id, 'That unit is no longer there.');
      return;
    }
    // connectUnits itself is the judge of what may connect (units that are —
    // or come out as — adjacent roots).
    const newPos = connectUnits(editor, posA, posB, taxonomy);
    if (newPos === null) {
      rejectConnection(dot.id, 'Only two adjacent units can be connected.');
      return; // nothing dispatched: the first selection stands
    }
    setSelectedDotId(null);
    // Label the fresh connection straight away (it defaults to Series).
    setPopover({ kind: 'menu', pos: newPos, at: null });
  };

  const onLabelClick = (pos: number, at: Point) => {
    setSelectedDotId(null);
    setPopover((prev) =>
      prev !== null && prev.kind === 'menu' && prev.pos === pos ? null : { kind: 'menu', pos, at },
    );
  };

  const onStarClick = (pos: number) => {
    setPopover(null);
    flipStar(editor, pos, taxonomy);
    setSelectedDotId(null);
  };

  const onSplit = (pid: string, ordinal: number) => {
    const pos = findPropositionPos(editor.state.doc, pid);
    setPopover(null);
    if (pos === null) return;
    splitProposition(editor, pos, ordinal + 1, words);
  };
  onSplitRef.current = onSplit;

  /** The strip's + : begin a new color block at this proposition. */
  const onAddBreak = (pid: string) => {
    addSectionBreak(editor, pid);
  };

  /** The strip's − : join this block to the one above it. */
  const onRemoveBreak = (pid: string) => {
    removeSectionBreak(editor, pid);
  };

  /** Toolbar: remove every connection at once (the propositions stay put). */
  const onClearTree = () => {
    setPopover(null);
    setSelectedDotId(null);
    // No confirmation: it is one undo away, like every other command here.
    clearConnections(editor);
  };

  const onPickRelationship = (pos: number, rel: string) => {
    // Close on every pick, including one that changes nothing (the menu opens
    // on a fresh connection already set to Series, so choosing Series is a
    // legitimate no-op that must still feel like a choice).
    setPopover(null);
    setSelectedDotId(null);
    setRelationship(editor, pos, rel, taxonomy);
  };

  // ---- Popovers -----------------------------------------------------------

  let popoverNode: ReactNode = null;
  if (popover !== null && overlay !== null) {
    const bounds = {
      width: shellRef.current?.clientWidth ?? overlay.margin,
      height: overlay.height,
    };
    if (popover.kind === 'word') {
      const at = clampPopover(popover.at, WORD_SIZE, bounds);
      const info = popover.index !== null ? words.get(popover.index) : undefined;
      popoverNode = (
        <div
          ref={popoverRef}
          className="popover word-popover"
          style={{ left: at.x, top: at.y }}
          role="menu"
        >
          <div className="word-head greek">{popover.word}</div>
          {info !== undefined && (
            <div className="word-info">
              <div className="word-lemma">
                <span className="greek">{info.lemma}</span>
                {info.translit !== null && <span className="muted"> ({info.translit})</span>}
              </div>
              {info.gloss !== null && <div className="word-gloss">{info.gloss}</div>}
              <div className="word-parse muted">{describeParsing(info.pos, info.parsing)}</div>
              {info.eng !== null && (
                <div className="word-context muted">here: “{info.eng}”</div>
              )}
            </div>
          )}
        </div>
      );
    } else {
      const geom = overlay.brackets.find((b) => b.pos === popover.pos);
      const node = editor.state.doc.nodeAt(popover.pos);
      if (geom !== undefined && node !== null && node.type.name === 'bracket') {
        // Never over the words: the menu lives in the bracket half, its right
        // edge held clear of the text column (which starts at overlay.margin).
        const desired = popover.at ?? { x: geom.x + 8, y: geom.connectY + 8 };
        const at = clampPopover(
          { x: Math.min(desired.x, overlay.margin - MENU_SIZE.width - TEXT_GAP), y: desired.y },
          MENU_SIZE,
          bounds,
        );
        popoverNode = (
          <div
            ref={popoverRef}
            className="popover menu-popover"
            style={{ left: at.x, top: at.y }}
          >
            <RelationshipMenu
              taxonomy={taxonomy}
              current={String(node.attrs.rel)}
              onPick={(rel) => onPickRelationship(popover.pos, rel)}
            />
          </div>
        );
      }
    }
  }

  return (
    <RowContext.Provider value={rowCtx}>
      <div className="editor-toolbar">
        {/* Left: what the reader sees. Right: what the editor does. */}
        <label className="switch">
          <input
            type="checkbox"
            checked={view.english}
            onChange={(event) => updateView({ ...view, english: event.target.checked })}
          />
          <span className="switch-track" aria-hidden="true" />
          <span className="switch-label">English</span>
        </label>
        <label className="switch">
          <input
            type="checkbox"
            checked={view.verbs}
            onChange={(event) => updateView({ ...view, verbs: event.target.checked })}
          />
          <span className="switch-track" aria-hidden="true" />
          <span className="switch-label">Verbs</span>
        </label>
        <label className="switch">
          <input
            type="checkbox"
            checked={view.blocks}
            onChange={(event) => updateView({ ...view, blocks: event.target.checked })}
          />
          <span className="switch-track" aria-hidden="true" />
          <span className="switch-label">Blocks</span>
        </label>
        <label className="switch">
          <input
            type="checkbox"
            checked={view.colorCoding}
            onChange={(event) => updateView({ ...view, colorCoding: event.target.checked })}
          />
          <span className="switch-track" aria-hidden="true" />
          <span className="switch-label">Color coding</span>
        </label>
        {view.colorCoding && (
          <button type="button" onClick={() => setColorPanel((open) => !open)}>
            Colors…
          </button>
        )}
        <span className="toolbar-spacer" />
        {flash !== null && (
          <span className="toolbar-flash" role="status">
            {flash}
          </span>
        )}
        <button type="button" disabled={!editor.can().undo()} onClick={() => editor.commands.undo()}>
          Undo
        </button>
        <button type="button" disabled={!editor.can().redo()} onClick={() => editor.commands.redo()}>
          Redo
        </button>
        <button
          type="button"
          onClick={onClearTree}
          title="Remove every connection, leaving the propositions as they are"
        >
          Clear tree
        </button>
        <button
          type="button"
          className={helpPanel ? 'help-button on' : 'help-button'}
          aria-label="How this editor works"
          aria-expanded={helpPanel}
          title="How this editor works"
          onClick={() => setHelpPanel((open) => !open)}
        >
          ?
        </button>
      </div>
      {helpPanel && <HelpPanel />}
      {colorPanel && view.colorCoding && (
        <ColorSettings
          taxonomy={taxonomy}
          view={view}
          onChange={(colors) => updateView({ ...view, colors })}
          onClose={() => setColorPanel(false)}
        />
      )}
      <div
        ref={shellRef}
        className="editor-shell"
        style={
          {
            paddingLeft: overlay?.margin ?? `calc(50% - ${VERSE_LABEL_W / 2}px)`,
            // The strip stands in the shell's right padding, so no line of Greek
            // ever runs under it.
            paddingRight: view.blocks ? STRIP_LANE : undefined,
            // Where the tree's margin ends and the text column begins. The
            // skins that make this a two-page spread — the book's gutter, the
            // notebook's binding — need it in CSS, and only the layout knows
            // it.
            '--tree-margin':
              overlay === null ? `calc(50% - ${VERSE_LABEL_W / 2}px)` : `${overlay.margin}px`,
          } as CSSProperties
        }
      >
        {overlay !== null && (
          <BracketLayer
            brackets={overlay.brackets}
            dots={overlay.dots}
            width={overlay.margin}
            height={overlay.height}
            selectedDotId={selectedDotId}
            shake={shake}
            onDotClick={onDotClick}
            onLabelClick={onLabelClick}
            onStarClick={onStarClick}
            onDotDelete={(dot) => onDotDelete(dot.id)}
            pointer={pointer}
            view={view}
          />
        )}
        <EditorContent editor={editor} />
        {view.blocks && overlay !== null && (
          <SectionStrip
            sections={sectionsOf(pids, breaks)}
            pids={pids}
            rowBoxes={overlay.rowBoxes}
            breaks={breaks}
            height={overlay.height}
            onAdd={onAddBreak}
            onRemove={onRemoveBreak}
          />
        )}
        {popoverNode}
      </div>
    </RowContext.Provider>
  );
}
