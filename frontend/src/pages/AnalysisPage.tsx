import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Analysis } from '../types';
import { deleteAnalysis, errorMessages, getAnalysis, updateAnalysis } from '../api';
import AnalysisView from '../components/AnalysisView';

export default function AnalysisPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [title, setTitle] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  useEffect(() => {
    if (id === undefined) return;
    let cancelled = false;
    getAnalysis(id)
      .then((a) => {
        if (cancelled) return;
        setAnalysis(a);
        setTitle(a.title);
      })
      .catch((err: unknown) => {
        if (!cancelled) setErrors(errorMessages(err));
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const save = async () => {
    if (id === undefined || analysis === null) return;
    setBusy(true);
    setErrors([]);
    try {
      const updated = await updateAnalysis(id, { title, document: analysis.document });
      setAnalysis(updated);
      setTitle(updated.title);
      setSavedAt(new Date());
    } catch (err) {
      setErrors(errorMessages(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (id === undefined) return;
    if (!window.confirm('Delete this analysis? This cannot be undone.')) return;
    setBusy(true);
    setErrors([]);
    try {
      await deleteAnalysis(id);
      navigate('/');
    } catch (err) {
      setErrors(errorMessages(err));
      setBusy(false);
    }
  };

  return (
    <div className="analysis-page">
      <div className="analysis-toolbar">
        <input
          className="title-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Untitled analysis"
          aria-label="Analysis title"
        />
        <button className="primary" onClick={() => void save()} disabled={busy || analysis === null}>
          Save
        </button>
        <button className="danger" onClick={() => void remove()} disabled={busy || analysis === null}>
          Delete
        </button>
        {savedAt !== null && errors.length === 0 && (
          <span className="muted">Saved {savedAt.toLocaleTimeString()}</span>
        )}
      </div>
      {errors.length > 0 && (
        <ul className="error-box">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
      {analysis !== null && (
        <>
          <p className="muted passage-ref">{analysis.passageRef}</p>
          <AnalysisView document={analysis.document} />
        </>
      )}
      {analysis === null && errors.length === 0 && <p className="muted">Loading…</p>}
    </div>
  );
}
