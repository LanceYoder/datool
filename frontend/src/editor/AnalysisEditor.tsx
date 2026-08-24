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
//                         by family, plus Disconnect (root brackets only)
//   click a star          flipStar (the labels follow the star)
//   hover a row           "Merge below" on every proposition but the last
//   toolbar               Undo / Redo, and nothing else
//
// Selection state: one popover at a time (Escape and an outside click close
// it); the selected dot survives re-renders but is dropped whenever the
// document changes, because every position in the overlay has moved.

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
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
import { errorMessages, getCorpusVerses, getCorpusWords, getTaxonomy } from '../api';
import { buildTextById, displayWordText, documentToNode, nodeToDocument } from './convert';
import { editorExtensions } from './editor';
import { EditorProposition } from './schema';
import {
  connectUnits,
  disconnectRoot,
  findBrackets,
  findPropositionPos,
  flipStar,
  mergeBelow,
  setRelationship,
  splitProposition,
} from './commands';
import { COL_W, STUB_W, computeColumns, layoutBrackets, layoutDots } from './layout';
import type { DotGeom, RowBox } from './layout';
import {
  attachVerses,
  canSplitAfter,
  clampPopover,
  mainPointRefs,
  parseDotId,
} from './interaction';
import type { Point, PropExtent } from './interaction';
import { describeParsing } from './morph';
import BracketLayer from './BracketLayer';
import type { PositionedBracket, ShakeState } from './BracketLayer';
import RelationshipMenu from './RelationshipMenu';

const LABEL_GUTTER = 56; // px between the bracket columns and the row gutter

/** Width of the .verse-label column (styles.css) — the layout's anchor. */
const VERSE_LABEL_W = 72;

/** Nominal popover boxes, used to keep them inside the shell. */
const WORD_SIZE = { width: 280, height: 170 };
const MENU_SIZE = { width: 260, height: 400 };

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
  /**
   * English (WEB) verses rendered above each row — a verse sits on the row
   * holding its first analyzed word. Display only.
   */
  versesByPid: ReadonlyMap<string, VerseText[]>;
  /**
   * A single click on ANY word: the word-info popover (lemma, morphology,
   * gloss), plus "Split after" when the word is splittable. `index` is the
   * corpus word index, null for raw text.
   */
  onWordClick: (
    pid: string,
    ordinal: number,
    word: string,
    index: number | null,
    splittable: boolean,
    target: HTMLElement,
  ) => void;
  onMergeBelow: (pid: string) => void;
}

const RowContext = createContext<RowContextValue | null>(null);

/** Word tokens of one proposition row, from its source attrs. */
function rowTokens(
  node: ReactNodeViewProps['node'],
  words: ReadonlyMap<number, CorpusWord>,
): { key: string | number; display: string; hover?: string; index?: number }[] {
  const { srcStart, srcEnd } = node.attrs as { srcStart: unknown; srcEnd: unknown };
  if (typeof srcStart === 'number' && typeof srcEnd === 'number') {
    const out = [];
    for (let i = srcStart; i <= srcEnd; i += 1) {
      const w = words.get(i);
      if (w !== undefined) {
        out.push({
          key: i,
          display: displayWordText(w.text),
          hover: `${w.lemma} · ${w.parsing}`,
          index: i,
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

/** The main point's red — wins over any stored per-proposition color. */
const MAIN_POINT_COLOR = '#b91c1c';

function PropositionRow({ node }: ReactNodeViewProps) {
  const ctx = useContext(RowContext);
  const pid = String(node.attrs.pid);
  const stored = typeof node.attrs.color === 'string' ? node.attrs.color : undefined;
  const isMain = ctx !== null && ctx.mainPids.has(pid);
  const color = isMain ? MAIN_POINT_COLOR : stored;
  const tokens = ctx !== null ? rowTokens(node, ctx.words) : [];

  const verses = ctx?.versesByPid.get(pid);

  return (
    <NodeViewWrapper
      as="div"
      className={isMain ? 'prop-row main-point' : 'prop-row'}
      data-pid={pid}
    >
      <span className="verse-label">{String(node.attrs.label)}</span>
      <div className="prop-body">
        {verses !== undefined && verses.length > 0 && (
          <div className="english-line" contentEditable={false}>
            {verses.map((v) => (
              <span key={`${v.book}:${v.chapter}:${v.verse}`}>
                <span className="ev">{v.verse}</span> {v.text}{' '}
              </span>
            ))}
          </div>
        )}
        <span className="prop-text greek" style={color !== undefined ? { color } : undefined}>
          {ctx !== null
            ? tokens.map((t, ordinal) => {
                const splittable = canSplitAfter(ordinal, tokens.length);
                // Morphology stays on the tooltip; the split hint joins it.
                const title =
                  (t.hover !== undefined ? t.hover : '') +
                  (splittable
                    ? `${t.hover !== undefined ? '\n' : ''}click: split after this word`
                    : '');
                return (
                  <span
                    key={t.key}
                    className={splittable ? 'word splittable' : 'word'}
                    title={title === '' ? undefined : title}
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
                  >
                    {t.display}{' '}
                  </span>
                );
              })
            : String(node.attrs.text)}
          {/* Inside the text span, so it flows right after the last word. */}
          {ctx !== null && ctx.lastPid !== pid && (
            <button
              type="button"
              className="merge-below"
              title="Merge this proposition with the one below it"
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                ctx.onMergeBelow(pid);
              }}
            >
              Merge below
            </button>
          )}
        </span>
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
  const [verses, setVerses] = useState<VerseText[] | null>(null);
  const [taxonomy, setTaxonomy] = useState<TaxonomyEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // One batched corpus fetch covering every corpus-sourced proposition; the
  // English reference verses ride the same range.
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
      setVerses([]);
    } else {
      getCorpusWords(min, max)
        .then((ws) => {
          if (!cancelled) setWords(new Map(ws.map((w) => [w.index, w])));
        })
        .catch((err: unknown) => {
          if (!cancelled) setLoadError(errorMessages(err).join('; '));
        });
      // The English line is a nicety: failing to load it never blocks editing.
      getCorpusVerses(min, max)
        .then((vs) => {
          if (!cancelled) setVerses(vs);
        })
        .catch(() => {
          if (!cancelled) setVerses([]);
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
  if (words === null || verses === null || taxonomy === null) {
    return <p className="muted">Loading…</p>;
  }
  return (
    <EditorInner
      baseDoc={baseDoc}
      words={words}
      verses={verses}
      taxonomy={taxonomy}
      onChange={onChange}
    />
  );
}

interface InnerProps {
  baseDoc: AnalysisDocument;
  words: Map<number, CorpusWord>;
  verses: VerseText[];
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
}

function EditorInner({ baseDoc, words, verses, taxonomy, onChange }: InnerProps) {
  const [selectedDotId, setSelectedDotId] = useState<string | null>(null);
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [shake, setShake] = useState<ShakeState | null>(null);
  // docTick advances on every document change, layoutTick on every measurement
  // (they are separate so re-observing rows can never feed itself).
  const [docTick, setDocTick] = useState(0);
  const [layoutTick, setLayoutTick] = useState(0);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const flashTimer = useRef<number | null>(null);
  const shakeSeq = useRef(0);

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
  // callback would re-arm itself forever.
  useEffect(() => {
    const shell = shellRef.current;
    if (shell === null) return;
    const observer = new ResizeObserver(() => {
      setLayoutTick((t) => t + 1);
    });
    observer.observe(shell);
    for (const row of shell.querySelectorAll<HTMLElement>('[data-pid]')) {
      observer.observe(row);
    }
    return () => {
      observer.disconnect();
    };
  }, [editor, docTick]);

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
  }, [editor]);

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

  /** The completed analysis's main point (empty while the forest is loose). */
  const mainPids = useMemo<ReadonlySet<string>>(() => {
    if (editor === null) return new Set<string>();
    return new Set(mainPointRefs(nodeToDocument(editor.state.doc, baseDoc).forest));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, docTick, baseDoc]);

  /** Which row shows which English verse (re-attached after every edit). */
  const versesByPid = useMemo(() => {
    const extents: PropExtent[] = [];
    if (editor !== null) {
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'proposition') {
          extents.push({
            pid: String(node.attrs.pid),
            srcStart: typeof node.attrs.srcStart === 'number' ? node.attrs.srcStart : null,
            srcEnd: typeof node.attrs.srcEnd === 'number' ? node.attrs.srcEnd : null,
          });
          return false;
        }
        return true;
      });
    }
    return attachVerses(extents, verses);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, docTick, verses]);

  // ---- Geometry -----------------------------------------------------------
  // Measure every row, then lay the whole FOREST out; layout brackets
  // (pre-order) zip index-for-index with the PM bracket positions.
  const overlay: Overlay | null = useMemo(() => {
    if (editor === null) return null;
    const shell = shellRef.current;
    if (shell === null) return null;
    const shellRect = shell.getBoundingClientRect();
    const rows = new Map<string, RowBox>();
    for (const el of shell.querySelectorAll<HTMLElement>('[data-pid]')) {
      const pid = el.dataset.pid;
      if (pid === undefined) continue;
      // Anchor ticks and dots to the GREEK line, not the whole row — the
      // English reference line above it must not pull the geometry off.
      const target = el.querySelector<HTMLElement>('.prop-text') ?? el;
      const rect = target.getBoundingClientRect();
      const top = rect.top - shellRect.top;
      rows.set(pid, { y: top + rect.height / 2, top, bottom: top + rect.height });
    }
    if (rows.size === 0) return null;

    const current = nodeToDocument(editor.state.doc, baseDoc);
    const { maxColumn } = computeColumns(current.forest);
    // The verse-label column (13a, 13b, …) is the workflow's anchor: pin its
    // center to the middle of the shell, so the tree has the whole left half
    // to grow into without ever shifting the words. Only a tree too deep for
    // that half pushes the text right (the Math.max arm).
    const need = Math.max(maxColumn * COL_W, STUB_W) + LABEL_GUTTER;
    const centered = Math.round(shellRect.width / 2 - VERSE_LABEL_W / 2);
    const margin = Math.max(need, centered);
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
    return {
      brackets,
      dots: layoutDots(current.forest, rows, margin),
      margin,
      height: shellRect.height,
    };
    // docTick + layoutTick drive re-measurement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, docTick, layoutTick, baseDoc, taxonomyByCode]);

  const rowCtx = useMemo<RowContextValue>(
    () => ({
      words,
      lastPid: pids.length > 0 ? (pids[pids.length - 1] ?? null) : null,
      mainPids,
      versesByPid,
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
      onMergeBelow: (pid) => {
        if (editor === null) return;
        setPopover(null);
        mergeBelow(editor, pid, words);
      },
    }),
    [words, pids, mainPids, versesByPid, editor],
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

  const onPickRelationship = (pos: number, rel: string) => {
    setRelationship(editor, pos, rel, taxonomy);
  };

  const onDisconnect = (pos: number) => {
    disconnectRoot(editor, pos);
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
            </div>
          )}
          {popover.splittable && (
            <button
              type="button"
              role="menuitem"
              className="popover-item"
              title={`Split this proposition after “${popover.word}”`}
              onClick={() => onSplit(popover.pid, popover.ordinal)}
            >
              Split after
            </button>
          )}
        </div>
      );
    } else {
      const geom = overlay.brackets.find((b) => b.pos === popover.pos);
      const node = editor.state.doc.nodeAt(popover.pos);
      if (geom !== undefined && node !== null && node.type.name === 'bracket') {
        const at = clampPopover(
          popover.at ?? { x: geom.x + 8, y: geom.connectY + 8 },
          MENU_SIZE,
          bounds,
        );
        const isRoot = editor.state.doc.resolve(popover.pos).depth === 0;
        popoverNode = (
          <div
            ref={popoverRef}
            className="popover menu-popover"
            style={{ left: at.x, top: at.y }}
          >
            <RelationshipMenu
              taxonomy={taxonomy}
              current={String(node.attrs.rel)}
              root={isRoot}
              onPick={(rel) => onPickRelationship(popover.pos, rel)}
              onDisconnect={() => onDisconnect(popover.pos)}
            />
          </div>
        );
      }
    }
  }

  return (
    <RowContext.Provider value={rowCtx}>
      <div className="editor-toolbar">
        <button type="button" disabled={!editor.can().undo()} onClick={() => editor.commands.undo()}>
          Undo
        </button>
        <button type="button" disabled={!editor.can().redo()} onClick={() => editor.commands.redo()}>
          Redo
        </button>
        <span className="toolbar-spacer" />
        {flash !== null ? (
          <span className="toolbar-flash" role="status">
            {flash}
          </span>
        ) : (
          <span className="muted toolbar-hint">
            Click a dot, then click an adjacent one to connect
          </span>
        )}
      </div>
      <div
        ref={shellRef}
        className="editor-shell"
        style={{
          paddingLeft: overlay?.margin ?? `calc(50% - ${VERSE_LABEL_W / 2}px)`,
        }}
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
          />
        )}
        <EditorContent editor={editor} />
        {popoverNode}
      </div>
    </RowContext.Provider>
  );
}
