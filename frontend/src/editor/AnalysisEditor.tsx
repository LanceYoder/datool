// The bracketing editor's UI: Tiptap state + React node views for the
// proposition rows + the SVG margin overlay (BracketLayer) drawn from
// layout.ts, wired to the editor CORE in commands.ts.
//
// Every gesture is exactly ONE core command — nothing here recomputes labels,
// re-indexes propositions or repairs structure:
//
//   click a word          word-info popover (lemma, morphology, gloss) with
//                         "Split after" -> splitProposition when splittable
//   hover a dot           nothing is marked (§10 A6: the span wash is gone);
//                         with another dot already armed, the aim previews the
//                         join through core previewConnect and marks every
//                         bracket it would break
//   click a dot           select that dot (EVERY dot is clickable, connected
//                         or not — reconnecting dissolves the old connection);
//                         clicking the selected dot again unselects it
//   click a second dot    connectUnits(first, second) -> a Ser, and the
//                         relationship menu opens PRELOADED on it (§10 A5); a
//                         rejected pair shakes, says nothing, and keeps the
//                         first selection
//   a pickup dot + its    settleHang -> the room is finished and the bracket
//   room's sole lodger    is whole (§10 A2): one undo step, no menu
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
import type { CSSProperties, MutableRefObject, ReactNode } from 'react';
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
  VerseText,
} from '../types';
import type { Forest, Side } from '../tree/core';
import { bracketById, leafOrder, previewConnect, settleTargetFor } from '../tree/core';
import { errorMessages, getCorpusVerses, getCorpusWords, getTaxonomy } from '../api';
import { buildTextById, displayWordText, documentToNode, trySnapshot } from './convert';
import { editorExtensions } from './editor';
import { EditorProposition, readTree } from './schema';
import {
  addSectionBreak,
  clearConnections,
  connectUnits,
  deleteAt,
  flipStar,
  keepPageScroll,
  mergeBelow,
  removeSectionBreak,
  sectionBreaks,
  setRelationship,
  settleHang,
  settleLodger,
  splitProposition,
} from './commands';
import {
  COL_W,
  bracketWidth,
  layoutBrackets,
  layoutDots,
  treeViewportWidth,
} from './layout';
import type { BracketGeom, Carry, DotGeom, RowBox } from './layout';
import {
  canSplitAfter,
  clampPopover,
  dotAddr,
  mainPointRefs,
  newlyAnchored,
  parseDotId,
  pickupGesture,
  rowEnglish,
} from './interaction';
import type { DotRef, Point } from './interaction';
import { describeParsing } from './morph';
import BracketLayer from './BracketLayer';
import type { AnchorState, ShakeState } from './BracketLayer';
import RelationshipMenu from './RelationshipMenu';
import ColorSettings from './ColorSettings';
import SectionStrip from './SectionStrip';
import { sectionColor, sectionColorByPid, sectionsOf } from './sections';
import HelpPanel from './HelpPanel';
import { loadViewSettings, saveViewSettings } from './viewSettings';
import type { ViewSettings } from './viewSettings';
import { applyPolicyToView, lockedRules, usePolicy, useReadOnly } from '../policy';

/** Width of the .verse-label column (--verse-label-w in styles.css) — the
 * layout's anchor. Keep the two in sync. */
const VERSE_LABEL_W = 72;

/** Nominal popover boxes, used to keep them inside the shell. */
const WORD_SIZE = { width: 280, height: 170 };
const MENU_SIZE = { width: 116, height: 400 };


/** Width the color-block strip stands in: the band plus air before the text. */
const STRIP_LANE = 26;

/**
 * Where the relationship menu goes: in its BERTH, to the left of the tree.
 *
 * The shell keeps a margin of MENU_GUTTER on its left for exactly this, so the
 * menu always has room — beside a tree that fits, and beside the viewport of
 * a tree that scrolls, since the berth is outside the scroll (ruled
 * 2026-09-17). It covers no text and no visible spine; its x is negative,
 * which is the whole point.
 *
 * The menu is a child of the SHELL, so it is placed in shell coordinates,
 * while the tree's geometry is in the overlay's own (scrollable) coordinates.
 * `scrollLeft` is what separates the two: an overlay x is on screen at
 * `x - scrollLeft`.
 */
function menuPlacement(overlay: Overlay, scrollLeft: number): number {
  // Where the tree begins ON SCREEN: its outermost spine, or the viewport's
  // own left edge when the outermost spines are scrolled out of sight. The
  // menu stands clear of that, in the berth the shell keeps for it
  // (MENU_GUTTER — a margin outside the shell, so the x is negative).
  // As far LEFT as the berth goes (ruled 2026-09-17: "even closer to the
  // left edge"), and never nearer the tree than TEXT_GAP.
  const treeLeft = Math.max(
    0,
    overlay.brackets.reduce((left, b) => Math.min(left, b.x - scrollLeft), overlay.viewport),
  );
  const x = Math.min(BERTH_PAD - BERTH_REACH - MENU_GUTTER, treeLeft - MENU_SIZE.width - TEXT_GAP);
  return x;
}

/** Clear space kept between the relationship menu and the text column. */
const TEXT_GAP = 12;
/**
 * The berth the relationship menu ALWAYS has to the left of the tree (ruled
 * 2026-09-17: "even at max tree height, the label box will always have
 * room"). It is a margin OUTSIDE the editor shell — outside the tree's scroll
 * viewport — so a tree wider than its window, which scrolls, cannot scroll
 * the berth away with it; the menu stands there at a negative x. The menu is
 * kept narrow for the same reason (styles.css).
 */
/** Air between the menu and whatever is left of its berth. */
const BERTH_PAD = 4;
/** Air the menu keeps above the window's bottom edge while it hovers there. */
const MENU_BOTTOM_AIR = 16;
/**
 * How far the menu reaches out of the shell's berth into the page's own
 * padding (ruled 2026-09-17: "twice as close to the left"): the berth the
 * shell keeps is that much narrower, and the menu stands that much nearer the
 * page's edge, its right edge still TEXT_GAP clear of the tree.
 */
const BERTH_REACH = 36;
const MENU_GUTTER = MENU_SIZE.width + BERTH_PAD + TEXT_GAP - BERTH_REACH;

/**
 * How long the shake class stays on a refused gesture's dot — a shade longer
 * than the 360ms CSS animation, so the class outlives the run rather than
 * cutting it short. There is no message beside it: §10 A6 — "a refused gesture
 * SHAKES and that is all".
 */
const SHAKE_MS = 500;

/**
 * How long a bracket that a gesture just made whole keeps its emphasis (§5.2:
 * "completion is an event, not an absence"). A shade longer than the CSS
 * animation, so the class outlives the run rather than cutting it short.
 */
const ANCHOR_MS = 900;

/** No brackets endangered — a shared value, so an idle aim re-arms no memo. */
const NO_IDS: readonly number[] = [];

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
  /** Class rules: whether a word may be split after, and a row merged below. */
  canSplit: boolean;
  canMerge: boolean;
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
  /** A click on an ENGLISH word: the card of the Greek word it renders. */
  onEnglishClick: (pid: string, index: number, target: HTMLElement) => void;
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


function PropositionRow({ node }: ReactNodeViewProps) {
  const ctx = useContext(RowContext);
  const pid = String(node.attrs.pid);
  const stored = typeof node.attrs.color === 'string' ? node.attrs.color : undefined;
  const isMain = ctx !== null && ctx.mainPids.has(pid);
  // How the main point is MARKED is the stylesheet's business — it is the same
  // for every analysis, and a skin may say it another way (the notebook runs a
  // highlighter over the row rather than reddening the words). Only a stored
  // per-proposition color is data, and it travels as one; .main-point in
  // styles.css outranks it, exactly as this used to.
  const color = isMain ? undefined : stored;
  const tokens = ctx !== null ? rowTokens(node, ctx.words) : [];

  // The English line is built from THIS row's own words, so it always
  // matches the proposition exactly, however the verses were divided.
  const { srcStart, srcEnd } = node.attrs as { srcStart: unknown; srcEnd: unknown };
  const english =
    ctx !== null && typeof srcStart === 'number' && typeof srcEnd === 'number'
      ? rowEnglish(srcStart, srcEnd, ctx.words)
      : [];

  // The block's color sits behind the whole row — English line included, so a
  // block reads as one band of the passage. The row PUBLISHES the color rather
  // than painting with it: both strengths, the pale wash and the saturated
  // ink, so each skin can lay the block on at the weight its page wants (a
  // pastel sized for white paper disappears on vellum). styles.css paints the
  // original with --block-bg; the other skins reach for --block-ink.
  const section = ctx?.sectionOf?.get(pid);
  const block = section === undefined ? undefined : sectionColor(section);

  return (
    <NodeViewWrapper
      as="div"
      className={isMain ? 'prop-row main-point' : 'prop-row'}
      data-pid={pid}
      style={
        block === undefined
          ? undefined
          : ({ '--block-bg': block.background, '--block-ink': block.strip } as CSSProperties)
      }
    >
      {/* The English line spans the row above the label so the label's baseline
          is the GREEK's, not the reference text's. */}
      {ctx?.showEnglish === true && english.length > 0 && (
        <div className="english-line" contentEditable={false}>
          {english.map((seg, i) => (
            <span key={i}>
              {seg.marker !== null && <span className="ev">{seg.marker}</span>}{' '}
              {seg.tokens.map((token, j) => (
                <span
                  key={`${token.index}-${j}`}
                  className="eng-word"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={(event) => {
                    // The card of the GREEK word this renders: same card,
                    // reached from the English side.
                    event.preventDefault();
                    event.stopPropagation();
                    ctx.onEnglishClick(pid, token.index, event.currentTarget);
                  }}
                >
                  {token.text}{' '}
                </span>
              ))}
            </span>
          ))}
        </div>
      )}
      <div className="prop-line">
        <span className="verse-label">{String(node.attrs.label)}</span>
        <div className="prop-body">
          <span
            className="prop-text greek"
            // Published, not painted, like the block colours: the main point
            // is RED here, but a skin may say it another way — the notebook
            // runs a highlighter over the row instead of recolouring it.
            style={color === undefined ? undefined : ({ '--prop-ink': color } as CSSProperties)}
          >
            {ctx !== null
              ? tokens.map((t, ordinal) => {
                  // WHERE this word stands in its row is the document's fact;
                  // whether dividing there is offered at all is the page's
                  // (read-only withholds it).
                  // The two are kept apart on purpose: a withheld split must
                  // not turn every right-click into the MERGE that only the
                  // row's last word offers.
                  const dividesHere = canSplitAfter(ordinal, tokens.length);
                  const splittable = ctx.canSplit && dividesHere;
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
                        else if (!dividesHere && ctx.canMerge && ctx.lastPid !== pid) {
                          ctx.onMergeBelow(pid);
                        }
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

/**
 * The two divisions another view may ask for, each naming a word by its
 * CORPUS INDEX: split the proposition after that word, or merge the one
 * holding it with the next. They run the editor's own commands, so a division
 * made in the text flow is one step of the same undo history.
 */
export interface EditorActions {
  splitAfter(index: number): void;
  mergeAt(index: number): void;
}

export interface AnalysisEditorProps {
  /** The loaded document (v1 or v2); the editor always emits v2. */
  document: AnalysisDocument;
  /** Fired after every edit with the document rebuilt from the editor. */
  onChange: (doc: AnalysisDocument) => void;
  /**
   * The x where the tree's margin ends and the text column begins, in px,
   * whenever it changes. Only the layout knows it, and a skin that draws the
   * page AROUND the editor — the book's fold runs the height of the whole
   * leaf, not just this shell — needs it further up the tree than a CSS
   * variable set here can reach.
   */
  onTreeMargin?: (margin: number) => void;
  /** Filled in with the divisions above, for a view that has no editor. */
  actionsRef?: MutableRefObject<EditorActions | null>;
}

export default function AnalysisEditor({
  document: baseDoc,
  onChange,
  onTreeMargin,
  actionsRef,
}: AnalysisEditorProps) {
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
    <EditorInner
      baseDoc={baseDoc}
      words={words}
      taxonomy={taxonomy}
      onChange={onChange}
      onTreeMargin={onTreeMargin}
      actionsRef={actionsRef}
    />
  );
}

interface InnerProps {
  baseDoc: AnalysisDocument;
  words: Map<number, CorpusWord>;
  taxonomy: TaxonomyEntry[];
  onChange: (doc: AnalysisDocument) => void;
  onTreeMargin?: (margin: number) => void;
  actionsRef?: MutableRefObject<EditorActions | null>;
}

/** The one floating thing on screen, if any. */
type PopoverState =
  | {
      kind: 'word';
      pid: string;
      /** Word position in the row for Greek; the corpus index for English. */
      ordinal: number;
      /** Which line the click came from — the two number their words apart. */
      side: 'greek' | 'english';
      word: string;
      /** Corpus index (null for raw text — no info to show). */
      index: number | null;
      splittable: boolean;
      at: Point;
    }
  | {
      kind: 'menu';
      /** The bracket being labeled, by core id (§7.3) — never a position. */
      bracketId: number;
      at: Point | null;
    };

interface Overlay {
  brackets: BracketGeom[];
  dots: DotGeom[];
  /**
   * The tree's NATURAL width and the x0 every bracket is laid out against:
   * the width of the scroll container's CONTENT, which may be wider than the
   * window can show.
   */
  margin: number;
  /**
   * The tree's width ON SCREEN — the shell's left padding, where the text
   * column begins, and the fold every skin draws. Equal to `margin` whenever
   * the tree fits; smaller when the tree scrolls sideways inside it.
   */
  viewport: number;
  height: number;
  /** Every measured WHOLE row (English line included), by pid — what places
   * the color-block bands so they cover what the block background paints. */
  rowBoxes: ReadonlyMap<string, RowBox>;
  /** Rows as the TREE measures them (anchored to the Greek's first line):
   * what a carried end is laid out against. */
  layoutRows: ReadonlyMap<string, RowBox>;
  /** The core state this layout drew, for re-laying it out while carrying. */
  forest: Forest;
}

/** ESV API license: this notice must accompany displayed ESV text. */
const ESV_NOTICE =
  'Scripture quotations are from the ESV® Bible (The Holy Bible, English ' +
  'Standard Version®), © 2001 by Crossway. Used by permission. All rights reserved.';

/**
 * The verse-text panel above the tree: the passage read as running verses in
 * the chosen translation. BSB comes from local data; ESV is fetched through
 * the server from Crossway's live API (and needs ESV_API_KEY there).
 */
function VersePanel({
  source,
  start,
  end,
}: {
  source: 'bsb' | 'esv';
  start: number;
  end: number;
}) {
  const [verses, setVerses] = useState<VerseText[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setVerses(null);
    setError(null);
    getCorpusVerses(start, end, source)
      .then((vs) => {
        if (!cancelled) setVerses(vs);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessages(err).join('; '));
      });
    return () => {
      cancelled = true;
    };
  }, [source, start, end]);

  return (
    <section className="verse-panel">
      {error !== null && <p className="muted">Verse text unavailable: {error}</p>}
      {error === null && verses === null && <p className="muted">Loading verse text…</p>}
      {verses !== null && (
        <p>
          {verses.map((v) => (
            <span key={`${v.book}:${v.chapter}:${v.verse}`}>
              <sup>{v.verse}</sup> {v.text}{' '}
            </span>
          ))}
          <span className="verse-panel-source">({source.toUpperCase()})</span>
        </p>
      )}
      {source === 'esv' && <p className="verse-panel-notice">{ESV_NOTICE}</p>}
    </section>
  );
}

function EditorInner({
  baseDoc,
  words,
  taxonomy,
  onChange,
  onTreeMargin,
  actionsRef,
}: InnerProps) {
  const [selectedDotId, setSelectedDotId] = useState<string | null>(null);
  // The dot UNDER THE POINTER, if any — §5.2's two hover signals. On its own
  // it highlights the span that dot names; with another dot armed it is the
  // target the join is previewed against. It is kept beside the selection
  // rather than inside it because hovering answers a question ("what is
  // this?") that arming has not been asked yet.
  const [hoverDotId, setHoverDotId] = useState<string | null>(null);
  // Where the pointer is while a dot is selected: the loose end of the
  // connection being made, drawn from the dot so the reader can see where the
  // next click would put it.
  const [pointer, setPointer] = useState<Point | null>(null);
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [shake, setShake] = useState<ShakeState | null>(null);
  // §5.2's third signal: the brackets the last gesture made whole, held just
  // long enough to be seen.
  const [anchored, setAnchored] = useState<AnchorState | null>(null);
  // docTick advances on every document change, layoutTick on every measurement
  // (they are separate so re-observing rows can never feed itself).
  // Reader's display options (English line, bracket colors) — persisted per
  // browser, never part of the analysis.
  //
  // The POLICY sits between what the browser remembered and what the editor
  // uses: a reading aid the class withholds is forced off here, so no stored
  // preference can bring it back and no gated switch has to remember to.
  const policy = usePolicy();
  /** A professor reading a student's work: every gesture below does nothing,
   *  and no control for one is drawn. Not a policy — the work is simply
   *  somebody else's, which the page says for itself (§8). */
  const readOnly = useReadOnly();
  const [storedView, setStoredView] = useState<ViewSettings>(loadViewSettings);
  const view = useMemo(() => applyPolicyToView(storedView, policy), [storedView, policy]);
  /** What the class takes away, in the student's words — the toolbar's line.
   *  Empty on a read-only page: naming "class rules" there would give the
   *  wrong reason for the missing controls. */
  const locked = useMemo(() => (readOnly ? [] : lockedRules(policy)), [policy, readOnly]);
  // The whole passage's corpus range — what the verse-text panel shows.
  const corpusRange = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const i of words.keys()) {
      if (i < min) min = i;
      if (i > max) max = i;
    }
    return min > max ? null : ([min, max] as const);
  }, [words]);
  const [colorPanel, setColorPanel] = useState(false);
  const [helpPanel, setHelpPanel] = useState(false);
  const [docTick, setDocTick] = useState(0);
  const [layoutTick, setLayoutTick] = useState(0);
  const shellRef = useRef<HTMLDivElement | null>(null);
  // The tree's scrollable viewport, and how far it could scroll when its
  // position was last anchored (see the anchoring effect).
  const treeRef = useRef<HTMLDivElement | null>(null);
  const anchoredW = useRef<number | null>(null);
  // The last overlay laid out from a complete set of row measurements, and
  // the rows the last measurement pass saw (see the re-measure effect).
  const lastOverlay = useRef<Overlay | null>(null);
  const measuredRows = useRef('');
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const shakeTimer = useRef<number | null>(null);
  // onSplit is defined further down (it needs the editor); the row context is
  // built before it, so it reaches the command through this ref.
  const onSplitRef = useRef<(pid: string, ordinal: number) => void>(() => {});
  // onDotDelete is defined further down (it needs the editor); the key handler
  // above reaches it through this ref.
  const deleteDotRef = useRef<(dotId: string) => void>(() => {});
  const shakeSeq = useRef(0);
  // The anchoring signal's bookkeeping: the state the LAST gesture started
  // from (what the diff is taken against), a counter that re-runs the
  // animation when the same bracket anchors twice, and the timer that takes
  // the emphasis back off again.
  const priorForest = useRef<Forest | null>(null);
  const anchorSeq = useRef(0);
  const anchorTimer = useRef<number | null>(null);

  /**
   * Change one display setting.
   *
   * It takes a PATCH and applies it to what the browser remembered — never to
   * `view`, which is the policy-FILTERED copy. Spreading the filtered settings
   * back into storage would write the class's withheld aids over the reader's
   * own preferences: touching the Blocks switch under a policy that withholds
   * English would store "English off" as though the student had chosen it, and
   * re-allowing English later would leave them looking at a page that had
   * forgotten they ever wanted it. The filter above keeps doing its work on
   * the way OUT; nothing a policy withholds reaches storage.
   */
  const updateView = useCallback((patch: Partial<ViewSettings>) => {
    setStoredView((prev) => {
      const next = { ...prev, ...patch };
      saveViewSettings(next);
      return next;
    });
  }, []);

  const taxonomyByCode = useMemo(
    () => new Map(taxonomy.map((t) => [t.code, t])),
    [taxonomy],
  );

  /** What the layout asks the taxonomy: the labels, and the two facts the
   *  DERIVED `reversed` comes from (§1's follow-on ruling). */
  const relLookup = useCallback(
    (rel: string) => taxonomyByCode.get(rel),
    [taxonomyByCode],
  );

  const content = useMemo(() => {
    const wordList = [...words.values()];
    return documentToNode(baseDoc, buildTextById(baseDoc, wordList), taxonomy);
  }, [baseDoc, words, taxonomy]);

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
        // The dot the pointer was over may not exist any more, and the span it
        // named certainly does not: §5.2's signals are position-keyed like
        // everything else here.
        setHoverDotId(null);
        setPopover(null);
        // ONE wire snapshot per docTick (§7.4 item 4), and it goes STRAIGHT to
        // the draft. §10 A5 retired the state that used to make this
        // conditional: every connect mints a Ser, so there is no unlabeled
        // bracket the wire cannot spell, no held-back snapshot, and no notice
        // to render about it. The one remaining way to fail is a rel this
        // taxonomy does not carry — a data mismatch, not a gesture — which is
        // reported to the console and changes nothing on the page (A6).
        const snapshot = trySnapshot(ed.state.doc, baseDoc, taxonomy);
        if (snapshot.ok) onChange(snapshot.document);
        else console.warn(`datool: this edit did not reach the draft — ${snapshot.reason.message}`);
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
    // ...except while a dot is armed. Then the renders are the POINTER's, one
    // per mousemove, and the document cannot have changed under them: a
    // connect clears the selection in the same batch that changes the
    // document, so no gesture that adds or removes a row leaves a dot armed.
    // Scanning every row sixty times a second to learn that nothing moved is
    // the one cost this effect can drop without weakening what it checks.
    if (selectedDotId !== null) return;
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
      // The pointer is read in the OVERLAY's coordinates — it is what a
      // carried end is laid out at and where the rubber band is drawn — so a
      // scrolled tree's offset goes back in here.
      setPointer({
        x: event.clientX - rect.left + (treeRef.current?.scrollLeft ?? 0),
        y: event.clientY - rect.top,
      });
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
        // Just closes what is open (§10 A5: there is no fresh-join undo any
        // more — the Ser stands, and Ctrl-Z is how a join is taken back).
        setPopover(null);
        setSelectedDotId(null);
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        // The keyboard side-channel of the right-click below: read-only closes
        // it too, or the lock would be one keystroke deep.
        if (readOnly) return;
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
      const undoing = key === 'z' && !event.shiftKey;
      const redoing = (key === 'z' && event.shiftKey) || key === 'y';
      if (!undoing && !redoing) return;
      event.preventDefault();
      // §7.12: keepPageScroll wraps every dispatch. Undo and redo rebuild the
      // same node views every other command does, and Ctrl-Z is the path a
      // reader halfway down a long analysis actually uses.
      keepPageScroll(() => (undoing ? editor.commands.undo() : editor.commands.redo()));
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
    // selectedDotId is read by the Delete branch, so the handler is re-bound
    // whenever the selection changes; so is the read-only flag it obeys.
  }, [editor, selectedDotId, readOnly]);

  // A unit being carried is DROPPED by clicking anywhere that is not another
  // handle: having picked something up and thought better of it, the way out
  // is to click away, not to find the dot again. Landing on a dot is left to
  // the dot's own handler, which is what connects the two.
  useEffect(() => {
    if (selectedDotId === null) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('.dot-group') !== null) return;
      setSelectedDotId(null);
    };
    window.document.addEventListener('mousedown', onDown, true);
    return () => {
      window.document.removeEventListener('mousedown', onDown, true);
    };
  }, [selectedDotId]);

  // Outside click closes the popover. The listener is added after the click
  // that opened it (popovers open on click, this listens for mousedown), so it
  // can never close its own opening gesture.
  useEffect(() => {
    if (popover === null) return;
    const onDown = (event: MouseEvent) => {
      const el = popoverRef.current;
      if (el !== null && event.target instanceof Node && el.contains(event.target)) return;
      // §10 A5: clicking away just CLOSES the menu. The Ser the connect minted
      // stays, because a join always has a name now — there is nothing
      // half-made to abandon and nothing to undo on the way out.
      setPopover(null);
    };
    window.document.addEventListener('mousedown', onDown, true);
    return () => {
      window.document.removeEventListener('mousedown', onDown, true);
    };
  }, [popover]);

  useEffect(
    () => () => {
      if (shakeTimer.current !== null) window.clearTimeout(shakeTimer.current);
      if (anchorTimer.current !== null) window.clearTimeout(anchorTimer.current);
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

  /**
   * The core state, once per docTick — the lens over `doc.attrs.tree` that
   * §7.2 puts in place of a plugin-owned copy of the structure. Everything
   * that draws or reads the tree goes through this one memo, so no two
   * consumers can be looking at different states.
   */
  const forest = useMemo<Forest | null>(
    () => (editor === null ? null : readTree(editor.state.doc)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, docTick],
  );

  /** The completed analysis's main point (empty while any side hangs). */
  const mainPids = useMemo<ReadonlySet<string>>(
    () => new Set(forest === null ? [] : mainPointRefs(forest)),
    [forest],
  );

  /**
   * §5.2's third signal, taken in the COMMAND RESULT PATH: every op arrives
   * here as exactly one docTick carrying one new Forest (§7.2), so diffing the
   * rooms before and after that tick is diffing them across the gesture — and
   * it costs nothing when nothing anchored.
   *
   * No op of §5 sets out to anchor a side; it happens as a byproduct of where
   * a join lands, of a spill, of a merge's release. That is precisely why this
   * is a diff and not a flag the core could hand over: only the two states
   * know. Every gesture is covered by the one comparison — connect, delete,
   * split, merge, and the undo that puts a room back.
   */
  useEffect(() => {
    const before = priorForest.current;
    priorForest.current = forest;
    // A refusal dispatches nothing, so the forest comes back by identity and
    // there is nothing to compare (core.ts reuses untouched units by
    // reference, which is what makes `===` meaningful here).
    if (before === null || forest === null || before === forest) return;
    const ids = newlyAnchored(before, forest);
    if (ids.length === 0) return;
    anchorSeq.current += 1;
    setAnchored({ ids, seq: anchorSeq.current });
    if (anchorTimer.current !== null) window.clearTimeout(anchorTimer.current);
    anchorTimer.current = window.setTimeout(() => {
      anchorTimer.current = null;
      setAnchored(null);
    }, ANCHOR_MS);
  }, [forest]);


  // ---- Geometry -----------------------------------------------------------
  // Measure every row, then lay the whole FOREST out; layout brackets
  // (pre-order) zip index-for-index with the PM bracket positions.
  const overlay: Overlay | null = useMemo(() => {
    if (editor === null || forest === null) return null;
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

    // A split or a merge changes the document a frame before its rows reach
    // the DOM. Laying out then would place the new proposition's dot at y=0 —
    // a phantom above the column — so keep the last good overlay until every
    // proposition is measured; the re-measure below follows immediately.
    //
    // The overlay reads the CORE state straight off the doc attribute (§7.11):
    // it needs no wire form at all, which is what lets it draw the unlabeled
    // bracket a fresh connect just made.
    for (const pid of leafOrder(forest)) {
      if (!rows.has(pid)) return lastOverlay.current;
    }
    // The tree's NATURAL width, from the layout's own formula — the one
    // layout.test.ts guards. Re-deriving it inline here is how the shipped
    // width and the tested width become two expressions that only happen to
    // agree; a change to LABEL_GUTTER or the STUB_W floor would then pass the
    // suite while the page drifted.
    //
    // The verse-label column (13a, 13b, …) is the workflow's anchor: pin its
    // center to the middle of the shell, so the tree has the whole left half
    // to grow into without ever shifting the words. Only a tree too deep for
    // that half pushes the text right (the Math.max arm).
    const need = bracketWidth(forest);
    const centered = Math.round(shellRect.width / 2 - VERSE_LABEL_W / 2);
    // The tree is ALWAYS laid out at its natural width — nothing is refused
    // and nothing is cleared for being wide. What the window cannot show it
    // scrolls: the margin stops growing at `viewport`, and the tree runs on
    // leftwards inside it.
    const margin = Math.max(need, centered);
    const viewport = treeViewportWidth(need, shellRect.width, VERSE_LABEL_W);
    const layout = layoutBrackets(forest, rows, margin, relLookup);
    lastOverlay.current = {
      brackets: layout.brackets,
      dots: layoutDots(forest, rows, margin),
      margin,
      viewport,
      height: shellRect.height,
      rowBoxes: blockBoxes,
      layoutRows: rows,
      forest,
    };
    return lastOverlay.current;
    // docTick + layoutTick drive re-measurement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, forest, docTick, layoutTick, relLookup]);

  // Hand the fold's position up whenever it moves. In an effect, not in the
  // layout itself: the overlay is computed during render, and telling anyone
  // about it there would be a side effect in the middle of one.
  // What the skins want is the fold — where the tree ENDS on screen and the
  // words begin — so it is the viewport, not the tree's full width.
  // The page measures from ITS left edge, and the shell stands MENU_GUTTER in
  // from it (the menu's berth), so the fold the page is told is that much
  // further along than the viewport the shell lays out.
  const foldAt = overlay === null ? null : overlay.viewport + MENU_GUTTER;
  useEffect(() => {
    if (foldAt !== null) onTreeMargin?.(foldAt);
  }, [foldAt, onTreeMargin]);

  // Where a scrolled tree starts: at its RIGHT edge. The columns grow
  // LEFTWARDS from the text (layout: x = x0 - column * colW), so the innermost
  // relationships — the ones nearest the words they join — are on the right,
  // and the outermost spine is what the reader scrolls out to. Re-anchored
  // whenever how far the tree can scroll changes — a deeper tree, a resized
  // window, a skin with a narrower margin — and never otherwise: scrolling is
  // the reader's, and an edit that moves neither edge must not throw their
  // place away.
  const scrollable = overlay === null ? null : overlay.margin - overlay.viewport;
  useEffect(() => {
    const tree = treeRef.current;
    if (tree === null || scrollable === null) return;
    if (anchoredW.current === scrollable) return;
    anchoredW.current = scrollable;
    tree.scrollLeft = tree.scrollWidth - tree.clientWidth;
  }, [scrollable]);


  /**
   * The tree while a loose end is being CARRIED: laid out with that end at the
   * pointer. The bracket it belongs to stretches to reach it, its own
   * connection point moves with it, and everything above flexes in turn — so
   * the shape the tree would take is the shape on screen.
   *
   * Only the geometry moves: the document is untouched, and the columns stay
   * where they are, so the text never shifts under the reader's hand.
   */
  const flexed = useMemo<Overlay | null>(() => {
    if (overlay === null || pointer === null || selectedDotId === null) return null;
    const ref = parseDotId(selectedDotId);
    if (ref === null || ref.kind !== 'hang') return null;
    const carry: Carry = { bracketId: ref.id, side: ref.side, x: pointer.x, y: pointer.y };
    const rows = overlay.layoutRows;
    const layout = layoutBrackets(overlay.forest, rows, overlay.margin, relLookup, COL_W, carry);
    return {
      ...overlay,
      brackets: layout.brackets,
      dots: layoutDots(overlay.forest, rows, overlay.margin, COL_W, carry),
    };
  }, [overlay, pointer, selectedDotId, relLookup]);

  // §10 A6: the hover SPAN-WASH IS GONE. Hovering a dot no longer paints a
  // band across the passage — the state, the memo that derived it, the rect
  // that drew it and its CSS are all deleted. The endangered wash while AIMING
  // stays, and it is the `aim` memo below that feeds it.

  /**
   * §5.2, second signal: with a dot ARMED and the pointer over another, what
   * the click would do — run through the core's own `previewConnect`, which is
   * `connect` itself (core.ts), so the highlight can never drift from the
   * outcome. One call per hovered target: the memo's keys are the forest and
   * the two dot ids, and none of them changes while the pointer sits still.
   *
   * `broken` is the EXACT set the join would take down — both endpoints'
   * claimers, a crossed bracket, cascade deaths — because §4's bounded
   * breakage is what makes the preview honest. A target the core refuses (not
   * adjacent, containment, or a room's pickup dot, which is no unit at all)
   * comes back as a refusal, and the aim line says so instead.
   */
  const aim = useMemo<{ broken: readonly number[]; refused: boolean } | null>(() => {
    if (forest === null || selectedDotId === null || hoverDotId === null) return null;
    if (hoverDotId === selectedDotId) return null;
    const armed = parseDotId(selectedDotId);
    const target = parseDotId(hoverDotId);
    if (armed === null || target === null) return { broken: NO_IDS, refused: true };
    // §10 A2: a pickup dot aims at its room's SOLE lodger and at nothing else.
    // Settling breaks nothing, so the aim offers — or refuses — with an empty
    // endangered set either way.
    if (armed.kind === 'hang' || target.kind === 'hang') {
      const hang = armed.kind === 'hang' ? armed : (target as { id: number; side: Side });
      // The same decision the click will make (`trySettle`), not a second copy
      // of it: §5.2's "the preview IS the gesture", applied to A2's settle.
      const plan = pickupGesture(armed, target, settleTargetFor(forest, hang.id, hang.side));
      return { broken: NO_IDS, refused: plan.kind !== 'settle' };
    }
    const a = dotAddr(armed);
    const b = dotAddr(target);
    if (a === null || b === null) return { broken: NO_IDS, refused: true };
    const out = previewConnect(forest, a, b);
    return out.ok ? { broken: out.broken, refused: false } : { broken: NO_IDS, refused: true };
  }, [forest, selectedDotId, hoverDotId]);

  const rowCtx = useMemo<RowContextValue>(
    () => ({
      words,
      showEnglish: view.english,
      showVerbs: view.verbs,
      canSplit: !readOnly,
      canMerge: !readOnly,
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
          prev !== null &&
          prev.kind === 'word' &&
          prev.side === 'greek' &&
          prev.pid === pid &&
          prev.ordinal === ordinal
            ? null // clicking the same word again dismisses the popover
            : { kind: 'word', side: 'greek', pid, ordinal, word, index, splittable, at },
        );
      },
      onEnglishClick: (pid, index, target) => {
        const shell = shellRef.current;
        if (shell === null) return;
        const shellRect = shell.getBoundingClientRect();
        const rect = target.getBoundingClientRect();
        const at = { x: rect.left - shellRect.left, y: rect.bottom - shellRect.top + 4 };
        const greek = words.get(index);
        setSelectedDotId(null);
        setPopover((prev) =>
          prev !== null &&
          prev.kind === 'word' &&
          prev.side === 'english' &&
          prev.ordinal === index
            ? null
            : {
                kind: 'word',
                side: 'english',
                pid,
                ordinal: index,
                // The headword is the GREEK the reading renders — an English
                // word on its own says nothing the line has not already said.
                word: greek === undefined ? '' : displayWordText(greek.text),
                index,
                splittable: false,
                at,
              },
        );
      },
      onWordSplit: (pid, ordinal) => {
        if (readOnly) return;
        onSplitRef.current(pid, ordinal);
      },
      onMergeBelow: (pid) => {
        if (editor === null || readOnly) return;
        setPopover(null);
        mergeBelow(editor, pid, words);
      },
    }),
    [
      words,
      pids,
      mainPids,
      editor,
      view.english,
      view.verbs,
      view.blocks,
      breaks,
      readOnly,
    ],
  );

  if (editor === null) return null;

  // ---- Gestures -----------------------------------------------------------
  // Each one runs a single core command; the state set afterwards is what
  // survives the reset onUpdate did while the command was dispatching.

  /**
   * A REFUSED GESTURE SHAKES ITS DOT, AND THAT IS ALL (§10 A6). No flash, no
   * toast, no sentence anywhere on the page: the analyst's screenshot showed
   * message text rendering above the passage and pushing the whole page down,
   * and the ruling is that nothing may ever shift the tree or the text. The
   * refusal's own `message` still exists in the core, for the console and for
   * the tests; it is simply not something the page says.
   */
  const rejectConnection = (dotId: string) => {
    shakeSeq.current += 1;
    setShake({ dotId, seq: shakeSeq.current });
    if (shakeTimer.current !== null) window.clearTimeout(shakeTimer.current);
    shakeTimer.current = window.setTimeout(() => {
      shakeTimer.current = null;
      setShake(null);
    }, SHAKE_MS);
  };

  /**
   * Right-click a dot — or select it and press Delete — to remove the
   * relationship it names (§5.3's dot targeting, which the CORE decides): a
   * bracket dot names its bracket, a room's pickup dot the bracket it hangs
   * from, a proposition's dot the bracket owning the side that holds it, and a
   * root proposition's dot-delete is a refusal with a message.
   */
  const onDotDelete = (dotId: string) => {
    // Read-only: the right-click does nothing at all — not even a shake, which
    // would say "wrong gesture" about a gesture the reader does not have.
    if (readOnly) return;
    setPopover(null);
    setSelectedDotId(null);
    const ref = parseDotId(dotId);
    if (ref === null) return;
    // A hanging side is not a unit, but the bracket it hangs FROM is: deleting
    // there frees the waiting group into whatever holds them both.
    const addr =
      ref.kind === 'hang' ? ({ kind: 'bracket', id: ref.id } as const) : dotAddr(ref);
    if (addr === null) return;
    if (deleteAt(editor, addr) !== null) rejectConnection(dotId);
  };
  deleteDotRef.current = onDotDelete;

  /**
   * §10 A2 — THE PICKUP DOT FINISHES THE BRACKET. Pairing a room's pickup dot
   * with that room's SOLE lodger settles the side: the relationship becomes
   * whole, in one undo step, with no new bracket and NO MENU (nothing is being
   * named — the analyst is saying "that group is done"). Any other pairing
   * involving a pickup dot — a room still holding a group, some other unit,
   * two pickup dots — shakes and does nothing else.
   *
   * A REFUSED pairing shakes and does NOTHING ELSE (§10 A6) — the armed dot is
   * still carried, exactly as it is after a refused connect below. Dropping it
   * would be a second effect, and would make aiming at the wrong lodger cost
   * the pickup as well.
   *
   * Returns true when the pair was a pickup-dot gesture at all, settled or
   * refused, so the caller knows not to try connecting them.
   */
  const trySettle = (armed: DotRef, target: DotRef, shakeAt: string): boolean => {
    const hang = armed.kind === 'hang' ? armed : target.kind === 'hang' ? target : null;
    if (hang === null) return false;
    const plan = pickupGesture(armed, target, settleLodger(editor, hang.id, hang.side));
    if (plan.kind === 'none') return false;
    if (plan.kind === 'refuse') {
      rejectConnection(shakeAt);
      return true; // nothing dispatched: the first selection stands (§10 A6)
    }
    setSelectedDotId(null);
    if (settleHang(editor, plan.id, plan.side) !== null) rejectConnection(shakeAt);
    return true;
  };

  const onDotClick = (dot: DotGeom) => {
    // Every dot is a live handle, connected or not: a click selects it, a
    // click on the SAME dot unselects it, and a click on a second dot connects
    // the two. The CORE is the judge (§5.1): the join succeeds whenever the
    // two spans meet, breaking exactly the brackets that stand in its way
    // (ruling Q1), and the only refusals are geometric. No modifier keys.
    setPopover(null);
    // Read-only has no use for a selected dot at all, so the dots stop arming:
    // nothing on the overlay pretends to be a handle.
    if (readOnly) return;
    if (selectedDotId === null) {
      // A room's pickup dot arms like any other handle — the tree flexes
      // around it while it is carried — and it is a real endpoint now (A2).
      // Nothing is said about it: the tick and the dot are the whole signal.
      setSelectedDotId(dot.id);
      return;
    }
    if (selectedDotId === dot.id) {
      setSelectedDotId(null);
      return;
    }
    // Everything past here MAKES a relationship — the connect, and A2's
    // settle, which finishes one.
    const armed = parseDotId(selectedDotId);
    const target = parseDotId(dot.id);
    if (armed === null || target === null) {
      rejectConnection(dot.id);
      return;
    }
    if (trySettle(armed, target, dot.id)) return;
    const a = dotAddr(armed);
    const b = dotAddr(target);
    if (a === null || b === null) {
      rejectConnection(dot.id);
      return; // nothing dispatched: the first selection stands
    }
    const out = connectUnits(editor, a, b);
    if (!out.ok) {
      rejectConnection(dot.id);
      return; // nothing dispatched: the first selection stands
    }
    setSelectedDotId(null);
    // The join is made and it is a SER (§10 A5): the menu opens PRELOADED on
    // it, and clicking away simply closes the menu — the Ser stays. A
    // re-connection of an existing pair opens preloaded on its own rel.
    setPopover({ kind: 'menu', bracketId: out.bracketId, at: null });
  };

  const onLabelClick = (bracketId: number, at: Point) => {
    if (readOnly) return;
    setSelectedDotId(null);
    setPopover((prev) =>
      prev !== null && prev.kind === 'menu' && prev.bracketId === bracketId
        ? null
        : { kind: 'menu', bracketId, at },
    );
  };

  const onStarClick = (bracketId: number) => {
    if (readOnly) return;
    setPopover(null);
    flipStar(editor, bracketId, taxonomy);
    setSelectedDotId(null);
  };

  const onSplit = (pid: string, ordinal: number) => {
    if (readOnly) return;
    setPopover(null);
    splitProposition(editor, pid, ordinal + 1, words);
  };
  onSplitRef.current = onSplit;

  /** The proposition whose corpus range holds this word, if any. */
  const propositionAt = (index: number): { pid: string; srcStart: number } | null => {
    let hit: { pid: string; srcStart: number } | null = null;
    editor.state.doc.descendants((node) => {
      if (hit !== null) return false;
      if (node.type.name !== 'proposition') return true;
      const { pid, srcStart, srcEnd } = node.attrs;
      if (typeof srcStart === 'number' && typeof srcEnd === 'number') {
        if (index >= srcStart && index <= srcEnd) hit = { pid: String(pid), srcStart };
      }
      return false;
    });
    return hit;
  };

  // The text flow divides the same propositions from the other side; it names
  // words by corpus index, and its two gestures are these two commands.
  if (actionsRef !== undefined) {
    actionsRef.current = {
      splitAfter: (index) => {
        const at = propositionAt(index);
        if (at !== null) onSplit(at.pid, index - at.srcStart);
      },
      mergeAt: (index) => {
        if (readOnly) return;
        const at = propositionAt(index);
        if (at === null) return;
        setPopover(null);
        mergeBelow(editor, at.pid, words);
      },
    };
  }

  /** The strip's + : begin a new color block at this proposition. */
  const onAddBreak = (pid: string) => {
    if (readOnly) return;
    addSectionBreak(editor, pid);
  };

  /** The strip's − : join this block to the one above it. */
  const onRemoveBreak = (pid: string) => {
    if (readOnly) return;
    removeSectionBreak(editor, pid);
  };

  // The history controls do exactly what they say now: §10 A5 retired the
  // fresh-join dismissal that used to spend a step ahead of them.
  const onUndo = () => keepPageScroll(() => editor.commands.undo());
  const onRedo = () => keepPageScroll(() => editor.commands.redo());

  /** Toolbar: remove every connection at once (the propositions stay put). */
  const onClearTree = () => {
    if (readOnly) return;
    setPopover(null);
    setSelectedDotId(null);
    // No confirmation: it is one undo away, like every other command here.
    clearConnections(editor);
  };

  const onPickRelationship = (bracketId: number, rel: string) => {
    if (readOnly) return;
    // Close on every pick, including one that changes nothing: re-choosing the
    // relationship a bracket already has is a legitimate no-op that must still
    // feel like a choice.
    setPopover(null);
    setSelectedDotId(null);
    setRelationship(editor, bracketId, rel, taxonomy);
  };

  // What the reader sees: the tree flexed around what they are carrying, or
  // the tree as it stands.
  const shown = flexed ?? overlay;

  // ---- Popovers -----------------------------------------------------------

  /**
   * Where the relationship menu's top is, in window coordinates: as low as
   * MENU_BOTTOM_AIR above the window's bottom edge allows, clamped so the menu
   * never leaves the shell — it stops at the shell's top on the way up and at
   * the shell's bottom on the way down, and follows the section from there
   * (ruled 2026-09-17). Recomputed on every scroll and resize while the menu
   * is open, and only then.
   */
  const [menuTop, setMenuTop] = useState<number | null>(null);
  const menuOpen = popover !== null && popover.kind === 'menu';
  useEffect(() => {
    if (!menuOpen) {
      setMenuTop(null);
      return;
    }
    const place = () => {
      const shell = shellRef.current;
      if (shell === null) return;
      const r = shell.getBoundingClientRect();
      const h = popoverRef.current?.offsetHeight ?? MENU_SIZE.height;
      const wanted = window.innerHeight - MENU_BOTTOM_AIR - h;
      setMenuTop(Math.max(r.top, Math.min(wanted, r.bottom - h)));
    };
    place();
    window.addEventListener('scroll', place, { passive: true });
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place);
      window.removeEventListener('resize', place);
    };
  }, [menuOpen]);

  let popoverNode: ReactNode = null;
  if (popover !== null && overlay !== null) {
    const bounds = {
      width: shellRef.current?.clientWidth ?? overlay.viewport,
      height: overlay.height,
    };
    // Popovers are the SHELL's children; the tree's geometry is the overlay's.
    const treeScroll = treeRef.current?.scrollLeft ?? 0;
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
              {info.eng !== null && info.eng.trim() !== '' && (
                <div className="word-context muted">here: “{info.eng}”</div>
              )}
            </div>
          )}
        </div>
      );
    } else {
      // Both the geometry and the relationship are read by ID off the CORE
      // state (§7.3) — never off a ProseMirror position, and never off a
      // `nodeAt` that the flat document could not answer anyway.
      const geom = overlay.brackets.find((b) => b.bracketId === popover.bracketId);
      const bracket = forest === null ? null : bracketById(forest, popover.bracketId);
      if (geom !== undefined && bracket !== null) {
        // The menu is FIXED to the window (ruled 2026-09-17): it hovers above
        // the bottom edge of the screen and tracks the scroll, but stays
        // BOUNDED by the shell — never above the top of the tree and text,
        // never below their bottom; at either end it follows the section
        // instead (menuTop, kept by the scroll listener below). Only its x is
        // the shell's — the berth — so it is turned into a window coordinate.
        const shellLeft = shellRef.current?.getBoundingClientRect().left ?? 0;
        const left = shellLeft + menuPlacement(overlay, treeScroll);
        popoverNode = (
          <div
            ref={popoverRef}
            className="popover menu-popover"
            style={{ left, top: menuTop ?? window.innerHeight - MENU_BOTTOM_AIR - MENU_SIZE.height }}
          >
            <RelationshipMenu
              taxonomy={taxonomy}
              // The letter keys are the menu's own side-channel: closed with
              // everything else on a read-only page.
              keyboard={!readOnly}
              // §10 A5 (which REVERSES Q6): the menu opens PRELOADED on the
              // bracket's own rel — Ser for a fresh join, since that is what
              // `connect` mints. Clicking away keeps it; there is no unlabeled
              // state to mark. The `?? ''` is the impossible case only: a
              // bracket loaded from a document with no rel at all.
              current={bracket.rel ?? ''}
              onPick={(rel) => onPickRelationship(popover.bracketId, rel)}
            />
          </div>
        );
      }
    }
  }

  return (
    <RowContext.Provider value={rowCtx}>
      <div className="editor-toolbar">
        {/* Left: what the reader sees. Right: what the editor does.
            A reading aid the class withholds is not a switch turned off — the
            switch is not there at all, and `view` above has already forced the
            aid off whatever the browser remembered (§5, §8). */}
        {policy.aids.english && (
          <label className="switch">
            <input
              type="checkbox"
              checked={view.english}
              onChange={(event) => updateView({ english: event.target.checked })}
            />
            <span className="switch-track" aria-hidden="true" />
            <span className="switch-label">English</span>
          </label>
        )}
        {policy.aids.verses && (
          <label className="verses-select">
            Verses{' '}
            <select
              value={view.verses}
              onChange={(event) =>
                updateView({ verses: event.target.value as ViewSettings['verses'] })
              }
            >
              <option value="off">Off</option>
              <option value="bsb">BSB</option>
              <option value="esv">ESV</option>
            </select>
          </label>
        )}
        {policy.aids.verbs && (
          <label className="switch">
            <input
              type="checkbox"
              checked={view.verbs}
              onChange={(event) => updateView({ verbs: event.target.checked })}
            />
            <span className="switch-track" aria-hidden="true" />
            <span className="switch-label">Verbs</span>
          </label>
        )}
        <label className="switch">
          <input
            type="checkbox"
            checked={view.blocks}
            onChange={(event) => updateView({ blocks: event.target.checked })}
          />
          <span className="switch-track" aria-hidden="true" />
          <span className="switch-label">Blocks</span>
        </label>
        {policy.aids.colorCoding && (
          <label className="switch">
            <input
              type="checkbox"
              checked={view.colorCoding}
              onChange={(event) => updateView({ colorCoding: event.target.checked })}
            />
            <span className="switch-track" aria-hidden="true" />
            <span className="switch-label">Color coding</span>
          </label>
        )}
        {policy.aids.colorCoding && view.colorCoding && (
          <button type="button" onClick={() => setColorPanel((open) => !open)}>
            Colors…
          </button>
        )}
        <span className="toolbar-spacer" />
        {/* No flash element here, and nowhere else on the page: §10 A6 — the
            message that rendered above the passage was SHIFTING THE PAGE, and
            a refused gesture now shakes its dot and says nothing. */}
        {/* Undo and redo rebuild the same node views every other command does,
            so they move the page the same way — and they are the two the
            reader is most likely to press from halfway down a long analysis. */}
        <button type="button" disabled={!editor.can().undo()} onClick={onUndo}>
          Undo
        </button>
        <button type="button" disabled={!editor.can().redo()} onClick={onRedo}>
          Redo
        </button>
        {!readOnly && (
          <button
            type="button"
            onClick={onClearTree}
            title="Remove every connection, leaving the propositions as they are"
          >
            Clear tree
          </button>
        )}
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
      {/* A quiet line, not a warning: what the class has withheld, so a
          missing control reads as a rule rather than a broken tool (§8). */}
      {locked.length > 0 && (
        <p className="class-rules muted">Class rules: {locked.join(' · ')}.</p>
      )}
      {helpPanel && <HelpPanel />}
      {view.verses !== 'off' && corpusRange !== null && (
        <VersePanel source={view.verses} start={corpusRange[0]} end={corpusRange[1]} />
      )}
      {colorPanel && view.colorCoding && (
        <ColorSettings
          taxonomy={taxonomy}
          view={view}
          onChange={(colors) => updateView({ colors })}
          onClose={() => setColorPanel(false)}
        />
      )}
      <div
        ref={shellRef}
        className="editor-shell"
        style={
          {
            // The text column begins at the tree's VIEWPORT: a tree wider than
            // that scrolls inside it and never pushes a word.
            paddingLeft: overlay?.viewport ?? `calc(50% - ${VERSE_LABEL_W / 2}px)`,
            // The strip stands in the shell's right padding, so no line of Greek
            // ever runs under it.
            paddingRight: view.blocks ? STRIP_LANE : undefined,
            // Where the tree's margin ends and the text column begins. The
            // skins that make this a two-page spread — the book's gutter, the
            // notebook's binding — need it in CSS, and only the layout knows
            // it.
            '--tree-margin':
              overlay === null ? `calc(50% - ${VERSE_LABEL_W / 2}px)` : `${overlay.viewport}px`,
            // How much tree there is beyond the viewport's right edge — nil
            // for a tree that fits. Print reads this: paper cannot scroll, so
            // it lays the whole width out and scales it down instead.
            '--tree-overflow': `${overlay === null ? 0 : overlay.margin - overlay.viewport}px`,
            // The menu's berth: a margin the shell keeps on its left.
            '--menu-gutter': `${MENU_GUTTER}px`,
          } as CSSProperties
        }
      >
        {/* The tree's own viewport. It is exactly the margin wide, and the
            tree inside it is as wide as the tree really is: when that is
            more, this scrolls sideways and the text column does not move.
            While a connection is being aimed, the tree is drawn AS IT WOULD
            BE: making it then moves nothing. */}
        {/* A tree wider than its window scrolls, and what is scrolled out of
            sight is simply not drawn — so the EDGE it goes out at is drawn
            instead (ruled 2026-09-17): a rule down the viewport's left side,
            outside the scroller, saying "the tree continues past here". */}
        {shown !== null && shown.margin > shown.viewport && (
          <div className="tree-edge" aria-hidden="true" style={{ height: shown.height }} />
        )}
        {shown !== null && (
          <div
            ref={treeRef}
            className={
              shown.margin > shown.viewport ? 'tree-viewport scrollable' : 'tree-viewport'
            }
            style={{ height: shown.height }}
          >
            <BracketLayer
              brackets={shown.brackets}
              dots={shown.dots}
              width={shown.margin}
              height={shown.height}
              selectedDotId={selectedDotId}
              shake={shake}
              onDotClick={onDotClick}
              onLabelClick={onLabelClick}
              onStarClick={onStarClick}
              onDotDelete={(dot) => onDotDelete(dot.id)}
              // §5.2's aiming signals, all worked out from the CORE above and
              // handed down already answered: the span the hovered dot names,
              // the exact set the aimed join would break, whether that target
              // refuses, and what a gesture just made whole.
              onDotHover={(dot) => setHoverDotId(dot === null ? null : dot.id)}
              endangered={aim === null ? NO_IDS : aim.broken}
              aimTargetId={aim === null ? null : hoverDotId}
              aimRefused={aim !== null && aim.refused}
              anchored={anchored}
              pointer={flexed === null ? pointer : null}
              view={view}
            />
          </div>
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
            // Read-only: the bands still read down the edge — they are part of
            // the analysis — but the + and − that make and unmake them go.
            canEdit={!readOnly}
          />
        )}
        {popoverNode}
      </div>
    </RowContext.Provider>
  );
}
