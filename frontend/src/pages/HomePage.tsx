import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { AnalysisSummary, DeletedAnalysisSummary, FirstPassResult } from '../types';
import { normalizeDocument } from '../editor/convert';
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

/** The remembered auto-analysis level — a preference, not analysis data. */
const ANALYSIS_LEVEL_KEY = 'datool.analysisLevel';

function loadMaximal(): boolean {
  try {
    return window.localStorage.getItem(ANALYSIS_LEVEL_KEY) === 'maximal';
  } catch {
    return false;
  }
}

function saveMaximal(maximal: boolean): void {
  try {
    window.localStorage.setItem(ANALYSIS_LEVEL_KEY, maximal ? 'maximal' : 'minimal');
  } catch {
    /* a browser that blocks storage just forgets the choice */
  }
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
  // Auto-analysis level: minimal draws only the deterministic connections;
  // maximal proposes the full tree. Remembered per browser.
  const [maximal, setMaximal] = useState<boolean>(loadMaximal);
  const [result, setResult] = useState<FirstPassResult | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const locateSeq = useRef(0);
  // An Enter pressed before the passage has finished locating. The key would
  // otherwise do nothing for as long as the debounce is still running, which
  // looks broken; instead the intent is held and spent the moment the first
  // pass lands.
  const createWhenLocated = useRef(false);

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

  // Deleting belongs to the LIST, not to the analysis you are working in: it
  // is soft, so what it really does is move the row down into the trash.
  const remove = async (item: AnalysisSummary) => {
    if (!window.confirm(`Delete “${item.title}”? It moves to Recently deleted.`)) return;
    setErrors([]);
    try {
      await deleteAnalysis(item.id);
      setAnalyses(await listAnalyses());
      setDeleted(await listDeletedAnalyses());
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
      firstPass(wanted, maximal)
        .then((found) => {
          if (seq !== locateSeq.current) return;
          setResult(found);
          setErrors([]);
          if (createWhenLocated.current) {
            createWhenLocated.current = false;
            void create(found);
          }
        })
        .catch((err: unknown) => {
          if (seq !== locateSeq.current) return;
          createWhenLocated.current = false;
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
  }, [text, maximal]);

  /**
   * Enter creates, so the passage that is created has to be passed IN rather
   * than read from state: when Enter beats the debounce, the first pass that
   * satisfies it has only just arrived and has not been through a render yet.
   */
  const create = async (found: FirstPassResult) => {
    setBusy(true);
    setErrors([]);
    try {
      const title = found.alignment?.ref ?? 'Untitled analysis';
      // Every proposed connection is stored, however deep the tree runs: a
      // tree wider than the window is now read by scrolling the margin
      // sideways, so there is nothing about width left to decide here.
      const document = normalizeDocument(found.document);
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
            createWhenLocated.current = false;
          }}
          onKeyDown={(event) => {
            // A passage arrives by PASTE, not by being typed, so Enter is
            // free for the thing the button does. Shift+Enter still breaks a
            // line, for the rare hand-typed passage that needs one.
            if (event.key !== 'Enter') return;
            if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
            event.preventDefault();
            if (busy || text.trim() === '') return;
            if (result === null) createWhenLocated.current = true;
            else void create(result);
          }}
        />
        <div className="row-actions">
          <button
            className="primary"
            onClick={() => {
              if (result !== null) void create(result);
            }}
            disabled={busy || result === null}
          >
            Create
          </button>
          <div
            className="level-toggle"
            role="radiogroup"
            aria-label="How much the auto-analysis proposes"
            title="Minimal draws only the connections the tool is certain of; Full proposes a complete tree to correct"
          >
            <button
              type="button"
              role="radio"
              aria-checked={!maximal}
              className={maximal ? '' : 'on'}
              onClick={() => {
                setMaximal(false);
                saveMaximal(false);
              }}
            >
              Minimal
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={maximal}
              className={maximal ? 'on' : ''}
              onClick={() => {
                setMaximal(true);
                saveMaximal(true);
              }}
            >
              Full
            </button>
          </div>
          {result !== null && <span className="alignment-line">{alignmentLine(result)}</span>}
          {result === null && locating && (
            <span className="muted alignment-line">Locating…</span>
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
              <li key={a.id} className="analysis-row">
                <Link to={`/analysis/${a.id}`} className="analysis-link">
                  <span className="analysis-title">{a.title}</span>
                  <span className="muted">{a.passageRef}</span>
                  <span className="muted analysis-date">{formatDate(a.updatedAt)}</span>
                </Link>
                <button
                  type="button"
                  className="danger analysis-delete"
                  title={`Delete “${a.title}”`}
                  onClick={() => void remove(a)}
                >
                  Delete
                </button>
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
