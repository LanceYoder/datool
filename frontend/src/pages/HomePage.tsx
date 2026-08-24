import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { AnalysisSummary, DeletedAnalysisSummary, FirstPassResult } from '../types';
import { normalizeDocument, withoutConnections } from '../editor/convert';
import { fitsWidth } from '../editor/layout';
import {
  createAnalysis,
  deleteAnalysis,
  errorMessages,
  firstPass,
  listAnalyses,
  listDeletedAnalyses,
  restoreAnalysis,
} from '../api';

/** How long typing must pause before the passage is located. */
const LOCATE_DELAY_MS = 450;

/** Width the analysis will have on this screen — the app's own column. */
function shellWidth(): number {
  return Math.min(window.innerWidth, 1600) - 64;
}

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
  const [deleted, setDeleted] = useState<DeletedAnalysisSummary[]>([]);
  const [showTrash, setShowTrash] = useState(false);

  const [text, setText] = useState('');
  const [result, setResult] = useState<FirstPassResult | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const locateSeq = useRef(0);

  useEffect(() => {
    let cancelled = false;
    listAnalyses()
      .then((items) => {
        if (!cancelled) setAnalyses(items);
      })
      .catch((err: unknown) => {
        if (!cancelled) setListError(errorMessages(err).join('; '));
      });
    // Listing the trash is also what purges the expired rows (see the API), so
    // it runs on every visit, whether or not the section is open.
    listDeletedAnalyses()
      .then((items) => {
        if (!cancelled) setDeleted(items);
      })
      .catch(() => {
        // A trash that will not list is not worth an error over the page.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const restore = async (id: string) => {
    setErrors([]);
    try {
      await restoreAnalysis(id);
      setDeleted(await listDeletedAnalyses());
      setAnalyses(await listAnalyses());
    } catch (err) {
      setErrors(errorMessages(err));
    }
  };

  const purge = async (item: DeletedAnalysisSummary) => {
    if (!window.confirm(`Delete “${item.title}” for good? This cannot be undone.`)) return;
    setErrors([]);
    try {
      await deleteAnalysis(item.id, true);
      setDeleted(await listDeletedAnalyses());
    } catch (err) {
      setErrors(errorMessages(err));
    }
  };

  // Arriving via the header's + button: start typing the new passage right away.
  const startNew = searchParams.get('new') !== null;
  useEffect(() => {
    if (startNew) pasteRef.current?.focus();
  }, [startNew]);

  // Locating happens WHILE you type: a pause long enough to have finished the
  // reference (or the paste) runs it, and the newest keystroke always wins —
  // an earlier answer arriving late is dropped rather than shown.
  useEffect(() => {
    const wanted = text.trim();
    if (wanted === '') {
      setResult(null);
      setErrors([]);
      setLocating(false);
      return;
    }
    setLocating(true);
    const seq = ++locateSeq.current;
    const timer = window.setTimeout(() => {
      firstPass(wanted)
        .then((found) => {
          if (seq !== locateSeq.current) return;
          setResult(found);
          setErrors([]);
        })
        .catch((err: unknown) => {
          if (seq !== locateSeq.current) return;
          setResult(null);
          setErrors(errorMessages(err));
        })
        .finally(() => {
          if (seq === locateSeq.current) setLocating(false);
        });
    }, LOCATE_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [text]);

  const create = async () => {
    if (result === null) return;
    setBusy(true);
    setErrors([]);
    try {
      const title = result.alignment?.ref ?? 'Untitled analysis';
      // A proposed tree too wide to draw is never stored: the analysis starts
      // from its propositions instead. Deciding here — before it is saved —
      // is what keeps it from coming back.
      const proposed = normalizeDocument(result.document);
      const document = fitsWidth(proposed.forest, shellWidth())
        ? proposed
        : withoutConnections(proposed);
      const created = await createAnalysis({ title, document });
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
          placeholder="Paste a Greek passage, or type a reference — Eph 1:3–14…"
          rows={5}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setResult(null);
          }}
        />
        <div className="row-actions">
          <button
            className="primary"
            onClick={() => void create()}
            disabled={busy || result === null}
          >
            Create
          </button>
          {result !== null && <span className="alignment-line">{alignmentLine(result)}</span>}
          {result === null && (
            <span className="muted alignment-line">
              {locating
                ? 'Locating…'
                : 'A reference finds the passage in the SBLGNT; anything else is matched as pasted text.'}
            </span>
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

      {deleted.length > 0 && (
        <section className="trash-section">
          <h2>
            <button
              type="button"
              className="link-button"
              onClick={() => setShowTrash((open) => !open)}
            >
              Recently deleted ({deleted.length}) {showTrash ? '▾' : '▸'}
            </button>
          </h2>
          {showTrash && (
            <ul className="analysis-list">
              {deleted.map((a) => (
                <li key={a.id} className="trash-row">
                  <span className="analysis-title">{a.title}</span>
                  <span className="muted">{a.passageRef}</span>
                  <span className="muted analysis-date">
                    {a.daysLeft === 0
                      ? 'deleted — going today'
                      : `${a.daysLeft} day${a.daysLeft === 1 ? '' : 's'} left`}
                  </span>
                  <button type="button" onClick={() => void restore(a.id)}>
                    Restore
                  </button>
                  <button type="button" className="danger" onClick={() => void purge(a)}>
                    Delete forever
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
