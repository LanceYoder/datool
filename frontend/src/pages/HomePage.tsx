import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { AnalysisSummary, FirstPassResult } from '../types';
import { createAnalysis, errorMessages, firstPass, listAnalyses } from '../api';

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function alignmentLine(result: FirstPassResult): string {
  const a = result.alignment;
  if (a === null) return 'not aligned — raw mode';
  const exact = a.exact ? ' (exact)' : '';
  return `${a.ref} — ${a.matchedTokens}/${a.totalTokens} tokens matched${exact}`;
}

export default function HomePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const pasteRef = useRef<HTMLTextAreaElement>(null);
  const [analyses, setAnalyses] = useState<AnalysisSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const [text, setText] = useState('');
  const [result, setResult] = useState<FirstPassResult | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listAnalyses()
      .then((items) => {
        if (!cancelled) setAnalyses(items);
      })
      .catch((err: unknown) => {
        if (!cancelled) setListError(errorMessages(err).join('; '));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Arriving via the header's + button: start typing the new passage right away.
  const startNew = searchParams.get('new') !== null;
  useEffect(() => {
    if (startNew) pasteRef.current?.focus();
  }, [startNew]);

  const runFirstPass = async () => {
    setBusy(true);
    setErrors([]);
    setResult(null);
    try {
      setResult(await firstPass(text));
    } catch (err) {
      setErrors(errorMessages(err));
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (result === null) return;
    setBusy(true);
    setErrors([]);
    try {
      const title = result.alignment?.ref ?? 'Untitled analysis';
      const created = await createAnalysis({ title, document: result.document });
      navigate(`/analysis/${created.id}`);
    } catch (err) {
      setErrors(errorMessages(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="home-page">
      <section className="card">
        <h2>New analysis</h2>
        <textarea
          ref={pasteRef}
          className="greek paste-area"
          placeholder="Paste a Greek passage…"
          rows={5}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setResult(null);
          }}
        />
        <div className="row-actions">
          <button onClick={() => void runFirstPass()} disabled={busy || text.trim() === ''}>
            Locate
          </button>
          {result !== null && (
            <>
              <span className="alignment-line">{alignmentLine(result)}</span>
              <button className="primary" onClick={() => void create()} disabled={busy}>
                Create
              </button>
            </>
          )}
        </div>
        {errors.length > 0 && (
          <ul className="error-box">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Analyses</h2>
        {listError !== null && <div className="error-box">{listError}</div>}
        {analyses === null && listError === null && <p className="muted">Loading…</p>}
        {analyses !== null && analyses.length === 0 && <p className="muted">No analyses yet.</p>}
        {analyses !== null && analyses.length > 0 && (
          <ul className="analysis-list">
            {analyses.map((a) => (
              <li key={a.id}>
                <Link to={`/analysis/${a.id}`} className="analysis-link">
                  <span className="analysis-title">{a.title}</span>
                  <span className="muted">{a.passageRef}</span>
                  <span className="muted analysis-date">{formatDate(a.updatedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
