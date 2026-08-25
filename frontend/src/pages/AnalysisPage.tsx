import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Analysis, Document as AnalysisDocument } from '../types';
import { errorMessages, getAnalysis, updateAnalysis } from '../api';
import AnalysisEditor from '../editor/AnalysisEditor';
import NotesEditor from '../notes/NotesEditor';

/** Printable width of US Letter portrait at 0.5in margins, in CSS pixels. */
const PRINT_WIDTH_PX = 7.5 * 96;
import { useUnsavedChanges } from '../unsavedChanges';

export default function AnalysisPage() {
  const { id } = useParams<{ id: string }>();

  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  // The document handed to the editor: set once on load so edit history
  // survives saves (saving must not rebuild the editor).
  const [initialDoc, setInitialDoc] = useState<AnalysisDocument | null>(null);
  const draftRef = useRef<AnalysisDocument | null>(null);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
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
        setNotes(a.notes);
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
  }, []);

  const titleDirty = analysis !== null && title !== analysis.title;
  const notesDirty = analysis !== null && notes !== analysis.notes;

  // Let the header links confirm before navigating away from unsaved edits.
  useUnsavedChanges(dirty || titleDirty || notesDirty);

  const save = async () => {
    if (id === undefined || draftRef.current === null) return;
    setBusy(true);
    setErrors([]);
    try {
      const updated = await updateAnalysis(id, { title, notes, document: draftRef.current });
      // Keep the editor untouched: update metadata only.
      setAnalysis((prev) =>
        prev === null
          ? updated
          : {
              ...prev,
              title: updated.title,
              notes: updated.notes,
              passageRef: updated.passageRef,
              updatedAt: updated.updatedAt,
            },
      );
      setTitle(updated.title);
      setNotes(updated.notes);
      setDirty(false);
    } catch (err) {
      setErrors(errorMessages(err));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Printing is the browser's, but the fit is ours: the analysis is as wide as
   * its deepest tree, which is often wider than a page, so it is scaled down
   * to the printable width first (see the @media print block).
   */
  const print = () => {
    const shell = document.querySelector<HTMLElement>('.editor-shell');
    if (shell !== null) {
      const scale = Math.min(1, PRINT_WIDTH_PX / Math.max(1, shell.scrollWidth));
      shell.style.setProperty('--print-scale', scale.toFixed(3));
    }
    window.print();
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
          disabled={busy || analysis === null || (!dirty && !titleDirty && !notesDirty)}
        >
          Save
        </button>
        {/* No Delete here. Throwing an analysis away is a decision about the
            LIST, and it is taken there — see HomePage. */}
        <button type="button" onClick={print} disabled={analysis === null}>
          Print
        </button>
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
          {/* has-notes is what the print sheet reads: an empty box prints
              nothing rather than a blank page. */}
          <section className={notes.trim() === '' ? 'notes-panel' : 'notes-panel has-notes'}>
            <h2>Notes</h2>
            <NotesEditor value={notes} onChange={setNotes} />
          </section>
        </>
      )}
      {analysis === null && errors.length === 0 && <p className="muted">Loading…</p>}
    </div>
  );
}
