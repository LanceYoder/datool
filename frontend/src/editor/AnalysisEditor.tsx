// The interactive bracketing editor: Tiptap editor state + React node views
// for proposition rows + a clickable SVG margin overlay drawn from layout.ts.
//
// Interaction model:
//  - click a proposition row  -> select that unit; shift-click extends the
//    selection to the minimal contiguous run of siblings covering both;
//  - pick a relationship in the toolbar -> wrap the selected run;
//  - click a bracket's line/label in the margin -> select the bracket; the
//    toolbar then offers re-label / star side / reverse / confirm / dissolve;
//  - Mod-z / Mod-Shift-z (and toolbar buttons) undo/redo.

import {
  createContext,
  useCallback,
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
import type { Editor } from '@tiptap/core';
import type {
  CorpusWord,
  Document as AnalysisDocument,
  Proposition,
  TaxonomyEntry,
} from '../types';
import { errorMessages, getCorpusWords, getTaxonomy } from '../api';
import { buildTextById, documentToNode, nodeToDocument } from './convert';
import { editorExtensions } from './editor';
import { EditorProposition } from './schema';
import {
  canWrapUnits,
  confirmFlag,
  findBrackets,
  liftBracket,
  setProminent,
  setRelationship,
  toggleReversed,
  wrapUnits,
} from './commands';
import { COL_W, REVIEW_COLOR, computeColumns, layoutBrackets } from './layout';
import type { BracketGeom } from './layout';
import { unitRangeInfo } from './selection';

const LABEL_GUTTER = 46; // px between the bracket columns and the row gutter

// ---------------------------------------------------------------------------
// Row rendering (React node view)

interface RowContextValue {
  words: ReadonlyMap<number, CorpusWord>;
  propsById: ReadonlyMap<string, Proposition>;
  selectedPids: ReadonlySet<string>;
  onUnitMouseDown: (pos: number, shiftKey: boolean) => void;
}

const RowContext = createContext<RowContextValue | null>(null);

function rowText(
  prop: Proposition | undefined,
  attrText: string,
  words: ReadonlyMap<number, CorpusWord>,
): ReactNode {
  if (prop === undefined || prop.source.kind === 'raw') {
    return attrText;
  }
  const parts: ReactNode[] = [];
  for (let i = prop.source.start; i <= prop.source.end; i += 1) {
    const w = words.get(i);
    if (w === undefined) continue;
    parts.push(
      <span key={i} className="word" title={`${w.lemma} · ${w.parsing}`}>
        {w.text}
      </span>,
      ' ',
    );
  }
  return parts.length > 0 ? parts : attrText;
}

function PropositionRow({ node, getPos }: ReactNodeViewProps) {
  const ctx = useContext(RowContext);
  const pid = String(node.attrs.pid);
  const selected = ctx?.selectedPids.has(pid) ?? false;
  const color = typeof node.attrs.color === 'string' ? node.attrs.color : undefined;

  return (
    <NodeViewWrapper
      as="div"
      className={selected ? 'prop-row selected' : 'prop-row'}
      data-pid={pid}
      onMouseDown={(event: React.MouseEvent) => {
        event.preventDefault();
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        if (pos !== undefined && ctx !== null) {
          ctx.onUnitMouseDown(pos, event.shiftKey);
        }
      }}
    >
      <span className="verse-label">{String(node.attrs.label)}</span>
      <span className="prop-text greek" style={color !== undefined ? { color } : undefined}>
        {ctx !== null
          ? rowText(ctx.propsById.get(pid), String(node.attrs.text), ctx.words)
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
// Selection state

type Selection =
  | { kind: 'units'; anchor: number; head: number }
  | { kind: 'bracket'; pos: number }
  | null;

// ---------------------------------------------------------------------------

export interface AnalysisEditorProps {
  /** The loaded document; sources/labels are carried through edits by pid. */
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
  const [selection, setSelection] = useState<Selection>(null);
  const [layoutTick, setLayoutTick] = useState(0);
  const shellRef = useRef<HTMLDivElement | null>(null);

  const propsById = useMemo(
    () => new Map(baseDoc.propositions.map((p) => [p.id, p])),
    [baseDoc],
  );
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
        setSelection(null);
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

  const onUnitMouseDown = useCallback(
    (pos: number, shiftKey: boolean) => {
      setSelection((prev) =>
        shiftKey && prev !== null && prev.kind === 'units'
          ? { kind: 'units', anchor: prev.anchor, head: pos }
          : { kind: 'units', anchor: pos, head: pos },
      );
    },
    [],
  );

  // Derived selection info.
  const unitInfo =
    editor !== null && selection?.kind === 'units'
      ? unitRangeInfo(editor.state.doc, selection.anchor, selection.head)
      : null;
  const selectedPids = useMemo(
    () => new Set(unitInfo?.pids ?? []),
    [unitInfo?.pids.join(',')],
  );
  const selectedBracketPos = selection?.kind === 'bracket' ? selection.pos : null;

  const rowCtx = useMemo<RowContextValue>(
    () => ({ words, propsById, selectedPids, onUnitMouseDown }),
    [words, propsById, selectedPids, onUnitMouseDown],
  );

  // ---- Geometry -----------------------------------------------------------
  // Rebuild the display tree + measure row centers; zip layout brackets
  // (pre-order) with PM bracket positions (also pre-order).
  interface Overlay {
    brackets: (BracketGeom & { pos: number })[];
    margin: number;
    height: number;
  }
  const overlay: Overlay | null = useMemo(() => {
    if (editor === null) return null;
    const shell = shellRef.current;
    if (shell === null) return null;
    const shellRect = shell.getBoundingClientRect();
    const rowYs = new Map<string, number>();
    for (const el of shell.querySelectorAll<HTMLElement>('[data-pid]')) {
      const pid = el.dataset.pid;
      if (pid === undefined) continue;
      const rect = el.getBoundingClientRect();
      rowYs.set(pid, rect.top - shellRect.top + rect.height / 2);
    }
    if (rowYs.size === 0) return null;

    const current = nodeToDocument(editor.state.doc, baseDoc);
    const { maxColumn } = computeColumns(current.tree);
    const margin = maxColumn * COL_W + LABEL_GUTTER;
    const layout = layoutBrackets(
      current.tree,
      rowYs,
      margin,
      (rel) => taxonomyByCode.get(rel)?.labels,
    );
    const pmBrackets = findBrackets(editor.state.doc);
    const brackets = layout.brackets.map((geom, i) => ({
      ...geom,
      pos: pmBrackets[i]?.pos ?? -1,
    }));
    return { brackets, margin, height: shellRect.height };
    // layoutTick + the editor doc drive re-measurement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, editor?.state.doc, layoutTick, baseDoc, taxonomyByCode]);

  if (editor === null) return null;

  const wrapEnabled =
    unitInfo !== null && unitInfo.count >= 2 && canWrapUnits(editor.state, unitInfo.from, unitInfo.to);
  const selectedBracket =
    selectedBracketPos !== null ? editor.state.doc.nodeAt(selectedBracketPos) : null;

  return (
    <RowContext.Provider value={rowCtx}>
      <Toolbar
        editor={editor}
        taxonomy={taxonomy}
        wrapEnabled={wrapEnabled}
        onWrap={(rel) => {
          if (unitInfo !== null) wrapUnits(editor, unitInfo.from, unitInfo.to, rel, taxonomy);
        }}
        bracketPos={selectedBracketPos}
        bracket={selectedBracket?.type.name === 'bracket' ? selectedBracket : null}
        clearSelection={() => setSelection(null)}
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
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setSelection({ kind: 'bracket', pos: b.pos });
                  }}
                >
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
                  {b.review && <circle cx={b.x} cy={b.top - 8} r={3} fill={REVIEW_COLOR} />}
                </g>
              );
            })}
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
  wrapEnabled: boolean;
  onWrap: (rel: string) => void;
  bracketPos: number | null;
  bracket: ReturnType<Editor['state']['doc']['nodeAt']>;
  clearSelection: () => void;
}

function RelationshipSelect({
  taxonomy,
  value,
  placeholder,
  disabled,
  onPick,
}: {
  taxonomy: TaxonomyEntry[];
  value: string;
  placeholder: string;
  disabled?: boolean;
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
      disabled={disabled === true}
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

function Toolbar({
  editor,
  taxonomy,
  wrapEnabled,
  onWrap,
  bracketPos,
  bracket,
  clearSelection,
}: ToolbarProps) {
  const bracketAttrs = bracket?.type.name === 'bracket' ? bracket.attrs : null;
  const childCount = bracket?.childCount ?? 0;

  return (
    <div className="editor-toolbar">
      <RelationshipSelect
        taxonomy={taxonomy}
        value=""
        placeholder={wrapEnabled ? 'Relate selection as…' : 'Select 2+ adjacent units'}
        disabled={!wrapEnabled}
        onPick={onWrap}
      />

      {bracketPos !== null && bracketAttrs !== null && (
        <span className="bracket-controls">
          <RelationshipSelect
            taxonomy={taxonomy}
            value={String(bracketAttrs.rel)}
            placeholder="Relationship"
            onPick={(rel) => setRelationship(editor, bracketPos, rel, taxonomy)}
          />
          {bracketAttrs.prominent !== null &&
            Array.from({ length: childCount }, (_, i) => (
              <button
                key={i}
                className={bracketAttrs.prominent === i ? 'star-btn active' : 'star-btn'}
                title={`Star child ${i + 1}`}
                onClick={() => setProminent(editor, bracketPos, i)}
              >
                *{i + 1}
              </button>
            ))}
          {bracketAttrs.prominent !== null && (
            <button title="Swap which label sits at which end" onClick={() => toggleReversed(editor, bracketPos)}>
              Reverse
            </button>
          )}
          {bracketAttrs.flag === 'review' && (
            <button className="confirm-btn" onClick={() => confirmFlag(editor, bracketPos)}>
              Confirm
            </button>
          )}
          <button
            title="Dissolve this bracket (children join its parent)"
            onClick={() => {
              liftBracket(editor, bracketPos);
              clearSelection();
            }}
          >
            Dissolve
          </button>
        </span>
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
