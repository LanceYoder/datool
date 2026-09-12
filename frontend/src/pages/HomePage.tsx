import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type {
  AnalysisSummary,
  DeletedAnalysisSummary,
  FirstPassResult,
  FirstPassTier,
} from '../types';
import { TIER_LABELS } from '../types';
import { normalizeDocument } from '../editor/convert';
import { allowedTiers, pickTier, usePolicy } from '../policy';
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

/** The remembered auto-analysis tier — a preference, not analysis data. */
const ANALYSIS_LEVEL_KEY = 'datool.analysisLevel';

/** What each tier proposes, for the picker's tooltip. */
const TIER_HINTS: Record<FirstPassTier, string> = {
  none: 'Nothing is proposed: every proposition stands alone and the tree is yours to build',
  minimal: 'Only the connections the tool is certain of',
  full: 'A complete tree to correct',
};

function loadTier(): FirstPassTier | null {
  try {
    const raw = window.localStorage.getItem(ANALYSIS_LEVEL_KEY);
    // 'maximal' is what the retired boolean wrote — read it as 'full'.
    if (raw === 'maximal') return 'full';
    if (raw === 'none' || raw === 'minimal' || raw === 'full') return raw;
    return null;
  } catch {
    return null;
  }
}

function saveTier(tier: FirstPassTier): void {
  try {
    window.localStorage.setItem(ANALYSIS_LEVEL_KEY, tier);
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

  // What the class allows. An individual's policy allows everything, so the
  // picker is the three-way one; a policy naming a single tier hides it
  // altogether and uses that tier (§5).
  const policy = usePolicy();
  const tiers = allowedTiers(policy);

  const [text, setText] = useState('');
  // Auto-analysis tier: 'none' proposes nothing, 'minimal' draws only the
  // deterministic connections, 'full' proposes the whole tree. Remembered per
  // browser — and re-chosen whenever the policy no longer allows it.
  const [tier, setTierState] = useState<FirstPassTier>(() => pickTier(policy, loadTier()));
  const setTier = (next: FirstPassTier) => {
    setTierState(next);
    saveTier(next);
  };
  // A remembered tier the policy withdrew is replaced at once, so nothing is
  // ever sent that the server would refuse.
  const allowedTier = pickTier(policy, tier);
  useEffect(() => {
    if (allowedTier !== tier) setTierState(allowedTier);
  }, [allowedTier, tier]);
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
      firstPass(wanted, allowedTier)
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
  }, [text, allowedTier]);

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
      // The tier goes with the row: the server records it (and the policy in
      // force) on the analysis, and checks it against that policy.
      const created = await createAnalysis({ title, document, firstPassTier: allowedTier });
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
          {/* One tier allowed is not a choice: the picker goes, and that tier
              is simply what the auto-analysis does (§5). */}
          {tiers.length > 1 && (
            <div
              className="level-toggle"
              role="radiogroup"
              aria-label="How much the auto-analysis proposes"
            >
              {tiers.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={allowedTier === t}
                  className={allowedTier === t ? 'on' : ''}
                  title={TIER_HINTS[t]}
                  onClick={() => setTier(t)}
                >
                  {TIER_LABELS[t]}
                </button>
              ))}
            </div>
          )}
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
