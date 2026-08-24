import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Analysis, Document as AnalysisDocument } from '../types';
import { deleteAnalysis, errorMessages, getAnalysis, updateAnalysis } from '../api';
import AnalysisEditor from '../editor/AnalysisEditor';
import { useUnsavedChanges } from '../unsavedChanges';

export default function AnalysisPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  // The document handed to the editor: set once on load so edit history
  // survives saves (saving must not rebuild the editor).
  const [initialDoc, setInitialDoc] = useState<AnalysisDocument | null>(null);
  const draftRef = useRef<AnalysisDocument | null>(null);
  const [title, setTitle] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (id === undefined) return;
    let cancelled = false;
    getAnalysis(id)
      .then((a) => {
        if (cancelled) return;
        setAnalysis(a);
        setInitialDoc(a.document);
        draftRef.current = a.document;
        setTitle(a.title);
      })
      .catch((err: unknown) => {
        if (!cancelled) setErrors(errorMessages(err));
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Warn before closing the tab with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [dirty]);

  const onDocumentChange = useCallback((doc: AnalysisDocument) => {
    draftRef.current = doc;
    setDirty(true);
    setSavedAt(null);
  }, []);

  const titleDirty = analysis !== null && title !== analysis.title;

  // Let the header links confirm before navigating away from unsaved edits.
  useUnsavedChanges(dirty || titleDirty);

  const save = async () => {
    if (id === undefined || draftRef.current === null) return;
    setBusy(true);
    setErrors([]);
    try {
      const updated = await updateAnalysis(id, { title, document: draftRef.current });
      // Keep the editor untouched: update metadata only.
      setAnalysis((prev) =>
        prev === null ? updated : { ...prev, title: updated.title, passageRef: updated.passageRef, updatedAt: updated.updatedAt },
      );
      setTitle(updated.title);
      setDirty(false);
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
        <button
          className="primary"
          onClick={() => void save()}
          disabled={busy || analysis === null || (!dirty && !titleDirty)}
        >
          Save
        </button>
        <button className="danger" onClick={() => void remove()} disabled={busy || analysis === null}>
          Delete
        </button>
        {dirty && <span className="muted">Unsaved changes</span>}
        {savedAt !== null && errors.length === 0 && !dirty && (
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
      {analysis !== null && initialDoc !== null && (
        <>
          <p className="muted passage-ref">{analysis.passageRef}</p>
          <AnalysisEditor document={initialDoc} onChange={onDocumentChange} />
        </>
      )}
      {analysis === null && errors.length === 0 && <p className="muted">Loading…</p>}
    </div>
  );
}
