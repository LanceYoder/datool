import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  CorpusWord,
  Document as AnalysisDocument,
  Proposition,
  TaxonomyEntry,
} from '../types';
import { errorMessages, getCorpusWords, getTaxonomy } from '../api';
import { COL_W, REVIEW_COLOR, computeColumns, layoutBrackets } from '../editor/layout';

/** Width of the verse-label gutter, left of the bracket margin. */
const GUTTER_W = 56;
/** Extra room left of the outermost bracket so its labels don't clip. */
const LABEL_PAD = 44;
const TEXT_COLOR = '#1f2937';

function mapsEqual(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    if (b.get(k) !== v) return false;
  }
  return true;
}

/** Words of a corpus-sourced proposition, sliced from the batched fetch. Range is [start, end). */
function propWords(p: Proposition, words: ReadonlyMap<number, CorpusWord>): CorpusWord[] {
  if (p.source.kind !== 'corpus') return [];
  const out: CorpusWord[] = [];
  for (let i = p.source.start; i < p.source.end; i++) {
    const w = words.get(i);
    if (w !== undefined) out.push(w);
  }
  return out;
}

function renderPropText(p: Proposition, words: ReadonlyMap<number, CorpusWord> | null): ReactNode {
  if (p.source.kind === 'raw') {
    return p.source.text;
  }
  if (words === null) {
    return <span className="muted">…</span>;
  }
  const ws = propWords(p, words);
  return ws.map((w, i) => (
    <Fragment key={w.index}>
      {i > 0 ? ' ' : null}
      <span className="word" title={`${w.lemma} · ${w.parsing}`}>
        {w.text}
      </span>
    </Fragment>
  ));
}

export default function AnalysisView({ document: doc }: { document: AnalysisDocument }) {
  const [words, setWords] = useState<Map<number, CorpusWord> | null>(null);
  const [taxonomy, setTaxonomy] = useState<Map<string, TaxonomyEntry> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const [rowYs, setRowYs] = useState<Map<string, number>>(new Map());
  const [height, setHeight] = useState(0);

  // One batched corpus fetch per analysis: min start .. max end over all corpus sources.
  const corpusRange = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const p of doc.propositions) {
      if (p.source.kind === 'corpus') {
        min = Math.min(min, p.source.start);
        max = Math.max(max, p.source.end);
      }
    }
    return min < max ? { start: min, end: max } : null;
  }, [doc]);

  useEffect(() => {
    let cancelled = false;
    if (corpusRange === null) {
      setWords(new Map());
      return;
    }
    getCorpusWords(corpusRange.start, corpusRange.end)
      .then((ws) => {
        if (!cancelled) setWords(new Map(ws.map((w) => [w.index, w])));
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(errorMessages(err).join('; '));
      });
    return () => {
      cancelled = true;
    };
  }, [corpusRange]);

  useEffect(() => {
    let cancelled = false;
    getTaxonomy()
      .then((entries) => {
        if (!cancelled) setTaxonomy(new Map(entries.map((e) => [e.code, e])));
      })
      .catch(() => {
        // Fall back to rendering relationship codes as labels.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Measure row y-centers (relative to the container) with refs + ResizeObserver.
  useLayoutEffect(() => {
    const measure = () => {
      const container = containerRef.current;
      if (container === null) return;
      const cRect = container.getBoundingClientRect();
      const next = new Map<string, number>();
      for (const [id, el] of rowRefs.current) {
        const r = el.getBoundingClientRect();
        next.set(id, r.top - cRect.top + r.height / 2);
      }
      setHeight(cRect.height);
      setRowYs((prev) => (mapsEqual(prev, next) ? prev : next));
    };

    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    const container = containerRef.current;
    if (container !== null) ro.observe(container);
    for (const el of rowRefs.current.values()) ro.observe(el);
    return () => ro.disconnect();
  }, [doc, words]);

  const { maxColumn } = useMemo(() => computeColumns(doc.tree), [doc]);
  const svgW = maxColumn * COL_W + LABEL_PAD;

  const layout = useMemo(() => {
    if (rowYs.size === 0) return null;
    return layoutBrackets(doc.tree, rowYs, svgW, (rel) => taxonomy?.get(rel)?.labels);
  }, [doc, rowYs, svgW, taxonomy]);

  return (
    <div className="analysis-view" ref={containerRef}>
      {loadError !== null && <div className="error-box">{loadError}</div>}
      <svg
        className="bracket-layer"
        width={svgW}
        height={Math.max(height, 1)}
        style={{ left: GUTTER_W }}
        aria-hidden="true"
      >
        {layout?.brackets.map((b, i) => {
          const color = b.review ? REVIEW_COLOR : TEXT_COLOR;
          return (
            <g key={i} stroke={color} fill={color}>
              <line x1={b.x} y1={b.top} x2={b.x} y2={b.bottom} strokeWidth={1.5} />
              {b.ticks.map((t) => (
                <line key={t.childIndex} x1={t.x1} y1={t.y} x2={t.x2} y2={t.y} strokeWidth={1.5} />
              ))}
              {b.labels.map((l, j) => (
                <text
                  key={j}
                  className="bracket-label"
                  x={b.x - 3}
                  y={l.y}
                  stroke="none"
                  textAnchor="end"
                  dominantBaseline="middle"
                >
                  {l.text}
                </text>
              ))}
              {b.starChildIndex !== null && (
                <text
                  className="bracket-star"
                  x={b.x + 3}
                  y={(b.ticks[b.starChildIndex]?.y ?? 0) - 3}
                  stroke="none"
                  textAnchor="start"
                >
                  *
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="prop-rows">
        {doc.propositions.map((p) => (
          <div
            key={p.id}
            className="prop-row"
            ref={(el) => {
              if (el !== null) rowRefs.current.set(p.id, el);
              else rowRefs.current.delete(p.id);
            }}
          >
            <span className="verse-label">{p.label}</span>
            <span className="prop-spacer" style={{ width: svgW }} />
            <span className="prop-text greek" style={p.color !== undefined ? { color: p.color } : undefined}>
              {renderPropText(p, words)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
