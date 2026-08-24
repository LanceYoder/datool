// The bracketing editor's current shell: Tiptap editor state + React node
// views for proposition rows + an SVG margin overlay drawn from layout.ts.
//
// NOTE: this file is a holding pattern. The editor CORE (forest model,
// commands, layout geometry) has moved to the new interaction design —
// documents are a forest, brackets are built by connecting adjacent roots,
// and the dot geometry in layout.ts is the handle set the new UI will hang
// its interactions off. That UI is not built here yet. What this file does
// today:
//   - renders the rows and the read-only bracket display (spines, ticks,
//     stars, labels, and the dots, drawn but inert);
//   - clicking a bracket selects it and offers the local bracket operations
//     that survived: relabel, flip the star, confirm a review flag,
//     disconnect a root bracket;
//   - double-clicking a word splits its proposition (unzipping it to a root
//     first, per the new split semantics);
//   - Mod-z / Mod-Shift-z (and toolbar buttons) undo/redo.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  EditorContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
} from '@tiptap/react';
import type { ReactNodeViewProps } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
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
  confirmFlag,
  disconnectRoot,
  findBrackets,
  flipStar,
  setRelationship,
  splitProposition,
} from './commands';
import { COL_W, REVIEW_COLOR, STUB_W, computeColumns, layoutBrackets, layoutDots } from './layout';
import type { BracketGeom, DotGeom, RowBox } from './layout';

const LABEL_GUTTER = 46; // px between the bracket columns and the row gutter

// ---------------------------------------------------------------------------
// Row rendering (React node view)

interface RowContextValue {
  words: ReadonlyMap<number, CorpusWord>;
  /** Split the proposition at `pos` after its `ordinal`-th word (0-based). */
  onSplitAfter: (pos: number, ordinal: number) => void;
}

const RowContext = createContext<RowContextValue | null>(null);

/** Word tokens of one proposition row, from its source attrs. */
function rowTokens(
  node: ReactNodeViewProps['node'],
  words: ReadonlyMap<number, CorpusWord>,
): { key: string | number; display: string; hover?: string }[] {
  const { srcStart, srcEnd } = node.attrs as { srcStart: unknown; srcEnd: unknown };
  if (typeof srcStart === 'number' && typeof srcEnd === 'number') {
    const out = [];
    for (let i = srcStart; i <= srcEnd; i += 1) {
      const w = words.get(i);
      if (w !== undefined) {
        out.push({ key: i, display: displayWordText(w.text), hover: `${w.lemma} · ${w.parsing}` });
      }
    }
    if (out.length > 0) return out;
  }
  return String(node.attrs.text ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((t, i) => ({ key: i, display: t }));
}

function PropositionRow({ node, getPos }: ReactNodeViewProps) {
  const ctx = useContext(RowContext);
  const pid = String(node.attrs.pid);
  const color = typeof node.attrs.color === 'string' ? node.attrs.color : undefined;
  const tokens = ctx !== null ? rowTokens(node, ctx.words) : [];
  const last = tokens.length - 1;

  return (
    <NodeViewWrapper as="div" className="prop-row" data-pid={pid}>
      <span className="verse-label">{String(node.attrs.label)}</span>
      <span className="prop-text greek" style={color !== undefined ? { color } : undefined}>
        {ctx !== null
          ? tokens.map((t, ordinal) => (
              <span
                key={t.key}
                className="word"
                title={
                  (t.hover !== undefined ? `${t.hover}\n` : '') +
                  (ordinal < last ? 'double-click: split after this word' : '')
                }
                onDoubleClick={
                  ordinal < last
                    ? (event) => {
                        event.preventDefault();
                        const pos = typeof getPos === 'function' ? getPos() : undefined;
                        if (pos !== undefined) ctx.onSplitAfter(pos, ordinal);
                      }
                    : undefined
                }
              >
                {t.display}{' '}
              </span>
            ))
          : String(node.attrs.text)}
      </span>
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

  // One batched corpus fetch covering every corpus-sourced proposition.
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

function EditorInner({ baseDoc, words, taxonomy, onChange }: InnerProps) {
  const [selectedBracketPos, setSelectedBracketPos] = useState<number | null>(null);
  const [layoutTick, setLayoutTick] = useState(0);
  const shellRef = useRef<HTMLDivElement | null>(null);

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
        setSelectedBracketPos(null);
        onChange(nodeToDocument(ed.state.doc, baseDoc));
        setLayoutTick((t) => t + 1);
      },
    },
    [content],
  );

  // Re-measure rows when anything moves.
  useEffect(() => {
    const shell = shellRef.current;
    if (shell === null) return;
    const observer = new ResizeObserver(() => {
      setLayoutTick((t) => t + 1);
    });
    observer.observe(shell);
    return () => {
      observer.disconnect();
    };
  }, []);

  // Undo/redo keyboard shortcuts (the editor is not contenteditable).
  useEffect(() => {
    if (editor === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      // Leave native undo alone in text fields (e.g. the title input).
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

  const onSplitAfter = useCallback(
    (pos: number, ordinal: number) => {
      // `firstCount` counts the words that stay in the first half.
      if (editor !== null) splitProposition(editor, pos, ordinal + 1, words);
    },
    [editor, words],
  );

  const rowCtx = useMemo<RowContextValue>(
    () => ({ words, onSplitAfter }),
    [words, onSplitAfter],
  );

  // ---- Geometry -----------------------------------------------------------
  // Measure every row, then lay the whole FOREST out; layout brackets
  // (pre-order) zip index-for-index with the PM bracket positions.
  interface Overlay {
    brackets: (BracketGeom & { pos: number })[];
    dots: DotGeom[];
    margin: number;
    height: number;
  }
  const overlay: Overlay | null = useMemo(() => {
    if (editor === null) return null;
    const shell = shellRef.current;
    if (shell === null) return null;
    const shellRect = shell.getBoundingClientRect();
    const rows = new Map<string, RowBox>();
    for (const el of shell.querySelectorAll<HTMLElement>('[data-pid]')) {
      const pid = el.dataset.pid;
      if (pid === undefined) continue;
      const rect = el.getBoundingClientRect();
      const top = rect.top - shellRect.top;
      rows.set(pid, { y: top + rect.height / 2, top, bottom: top + rect.height });
    }
    if (rows.size === 0) return null;

    const current = nodeToDocument(editor.state.doc, baseDoc);
    const { maxColumn } = computeColumns(current.forest);
    const margin = Math.max(maxColumn * COL_W, STUB_W) + LABEL_GUTTER;
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
    // layoutTick + the editor doc drive re-measurement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, editor?.state.doc, layoutTick, baseDoc, taxonomyByCode]);

  if (editor === null) return null;

  const selectedBracket =
    selectedBracketPos !== null ? editor.state.doc.nodeAt(selectedBracketPos) : null;

  return (
    <RowContext.Provider value={rowCtx}>
      <Toolbar
        editor={editor}
        taxonomy={taxonomy}
        bracketPos={selectedBracketPos}
        bracket={selectedBracket?.type.name === 'bracket' ? selectedBracket : null}
        clearSelection={() => setSelectedBracketPos(null)}
      />
      <div
        ref={shellRef}
        className="editor-shell"
        style={{ paddingLeft: overlay?.margin ?? 3 * COL_W + LABEL_GUTTER }}
      >
        {overlay !== null && (
          <svg
            className="bracket-layer interactive"
            width={overlay.margin}
            height={overlay.height}
            style={{ left: 0 }}
          >
            {overlay.brackets.map((b) => {
              const isSelected = b.pos === selectedBracketPos;
              const stroke = b.review ? REVIEW_COLOR : isSelected ? '#1d4ed8' : '#374151';
              return (
                <g
                  key={b.pos}
                  className="bracket-hit"
                  data-rel={b.rel}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setSelectedBracketPos(b.pos);
                  }}
                >
                  {/* Full hit rect: inner brackets paint later, so they win. */}
                  <rect
                    x={b.rect.x}
                    y={b.rect.y}
                    width={b.rect.width}
                    height={b.rect.height}
                    fill="transparent"
                  />
                  <line x1={b.x} y1={b.top} x2={b.x} y2={b.bottom} stroke={stroke} strokeWidth={isSelected ? 2.5 : 1.5} />
                  {b.ticks.map((t) => (
                    <line key={t.childIndex} x1={t.x1} y1={t.y} x2={t.x2} y2={t.y} stroke={stroke} strokeWidth={isSelected ? 2 : 1.2} />
                  ))}
                  {b.ticks
                    .filter((t) => t.star)
                    .map((t) => (
                      <text key={`s${t.childIndex}`} className="bracket-star" x={(t.x1 + t.x2) / 2} y={t.y - 4} fill={stroke} textAnchor="middle">
                        *
                      </text>
                    ))}
                  {b.labels.map((l, i) => (
                    <text
                      key={i}
                      className="bracket-label"
                      x={l.placement === 'mid' ? b.x - 4 : b.x + 4}
                      y={l.placement === 'mid' ? l.y : l.y - 4}
                      fill={stroke}
                      textAnchor={l.placement === 'mid' ? 'end' : 'start'}
                    >
                      {l.text}
                    </text>
                  ))}
                </g>
              );
            })}
            {/* Dots: drawn for orientation; the interactions land in the rewrite. */}
            <g className="dot-layer" pointerEvents="none">
              {overlay.dots.map((d) => (
                <g key={d.id}>
                  {d.stubX1 !== undefined && d.stubX2 !== undefined && (
                    <line x1={d.stubX1} y1={d.y} x2={d.stubX2} y2={d.y} stroke="#9ca3af" strokeWidth={1} />
                  )}
                  <circle
                    cx={d.x}
                    cy={d.y}
                    r={d.connectable ? 3.5 : 2}
                    fill={d.connectable ? '#374151' : '#9ca3af'}
                  />
                </g>
              ))}
            </g>
          </svg>
        )}
        <EditorContent editor={editor} />
      </div>
    </RowContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Toolbar

const FAMILY_NAMES: Record<string, string> = {
  coordinate: 'Coordinate',
  restatement: 'Restatement',
  distinct: 'Distinct statement',
  contrary: 'Contrary statement',
};

interface ToolbarProps {
  editor: Editor;
  taxonomy: TaxonomyEntry[];
  bracketPos: number | null;
  bracket: ReturnType<Editor['state']['doc']['nodeAt']>;
  clearSelection: () => void;
}

function RelationshipSelect({
  taxonomy,
  value,
  placeholder,
  onPick,
}: {
  taxonomy: TaxonomyEntry[];
  value: string;
  placeholder: string;
  onPick: (rel: string) => void;
}) {
  const families = useMemo(() => {
    const out = new Map<string, TaxonomyEntry[]>();
    for (const t of taxonomy) {
      const group = out.get(t.family) ?? [];
      group.push(t);
      out.set(t.family, group);
    }
    return out;
  }, [taxonomy]);

  return (
    <select
      className="rel-select"
      value={value}
      onChange={(e) => {
        if (e.target.value !== '') onPick(e.target.value);
      }}
    >
      <option value="" disabled>
        {placeholder}
      </option>
      {[...families.entries()].map(([family, entries]) => (
        <optgroup key={family} label={FAMILY_NAMES[family] ?? family}>
          {entries.map((t) => (
            <option key={t.code} value={t.code}>
              {t.symbol} — {t.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function Toolbar({ editor, taxonomy, bracketPos, bracket, clearSelection }: ToolbarProps) {
  const bracketAttrs = bracket?.type.name === 'bracket' ? bracket.attrs : null;
  const binary = bracket?.childCount === 2;
  const isRoot =
    bracketPos !== null && editor.state.doc.resolve(bracketPos).depth === 0;

  return (
    <div className="editor-toolbar">
      {bracketPos !== null && bracketAttrs !== null ? (
        <span className="bracket-controls">
          <RelationshipSelect
            taxonomy={taxonomy}
            value={String(bracketAttrs.rel)}
            placeholder="Relationship"
            onPick={(rel) => setRelationship(editor, bracketPos, rel, taxonomy)}
          />
          {bracketAttrs.prominent !== null && binary && (
            <button
              title="Move the star to the other side (the labels follow it)"
              onClick={() => flipStar(editor, bracketPos, taxonomy)}
            >
              Flip star
            </button>
          )}
          {bracketAttrs.flag === 'review' && (
            <button className="confirm-btn" onClick={() => confirmFlag(editor, bracketPos)}>
              Confirm
            </button>
          )}
          {isRoot && (
            <button
              title="Disconnect this bracket (its parts become separate roots)"
              onClick={() => {
                disconnectRoot(editor, bracketPos);
                clearSelection();
              }}
            >
              Disconnect
            </button>
          )}
        </span>
      ) : (
        <span className="muted">Click a bracket to edit it</span>
      )}

      <span className="toolbar-spacer" />
      <button disabled={!editor.can().undo()} onClick={() => editor.commands.undo()}>
        Undo
      </button>
      <button disabled={!editor.can().redo()} onClick={() => editor.commands.redo()}>
        Redo
      </button>
    </div>
  );
}
