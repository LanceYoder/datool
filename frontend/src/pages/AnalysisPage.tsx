import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useParams } from 'react-router-dom';
import type { Analysis, Document as AnalysisDocument, TextFlow } from '../types';
import { errorMessages, getAnalysis, getTextFlow, updateAnalysis } from '../api';
import AnalysisEditor from '../editor/AnalysisEditor';
import type { EditorActions } from '../editor/AnalysisEditor';
import NotesEditor from '../notes/NotesEditor';
import TextFlowPanel from '../textflow/TextFlowPanel';
import { isAligned, reconcileFlow } from '../textflow/textflow';

/**
 * The propositions the flow's lines ARE: every corpus-sourced proposition, in
 * document order. (A raw one — a proposition typed rather than read out of the
 * corpus — has no place in the flow, which is the passage re-read.)
 */
function corpusPropositions(doc: AnalysisDocument): { start: number; end: number }[] {
  return doc.propositions.flatMap((p) =>
    p.source.kind === 'corpus' ? [{ start: p.source.start, end: p.source.end }] : [],
  );
}

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
  // The text flow lives inside the same document, but the editor never sees
  // it, so the page holds the current one for the panel to render.
  const [textFlow, setTextFlow] = useState<TextFlow | null>(null);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  // Where the fold falls, reported by the editor. The book skin draws its
  // gutter down the whole leaf, which is this element, not the editor's shell.
  const [treeMargin, setTreeMargin] = useState<number | null>(null);
  // Whether the title is being edited. Held as state rather than left to
  // :focus so the mirror below is simply not rendered while typing — a
  // sibling selector would have to guess at DOM order to do the same.
  const [titleEditing, setTitleEditing] = useState(false);

  useEffect(() => {
    if (id === undefined) return;
    let cancelled = false;
    getAnalysis(id)
      .then((a) => {
        if (cancelled) return;
        setAnalysis(a);
        setInitialDoc(a.document);
        draftRef.current = a.document;
        setTextFlow(a.document.textFlow ?? null);
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

  // The editor rebuilds the document from its own state, which knows nothing
  // of the text flow — so the flow the draft already carries is carried over
  // rather than dropped by the next bracketing edit.
  //
  // And the flow's lines ARE the propositions: an edit that divided or joined
  // them re-cuts the flow to match, keeping the indents and embeddings the new
  // division still allows. This is the tree -> flow direction.
  const onDocumentChange = useCallback((doc: AnalysisDocument) => {
    const carried = draftRef.current?.textFlow ?? null;
    const props = corpusPropositions(doc);
    let next = carried === null ? doc : { ...doc, textFlow: carried };
    if (props.length > 0 && !isAligned(carried, props)) {
      const flow = reconcileFlow(carried, props);
      next = { ...next, textFlow: flow };
      setTextFlow(flow);
    }
    draftRef.current = next;
    setDirty(true);
  }, []);

  // The mirror image: a flow edit merges into the LATEST draft, never into the
  // document as it loaded, so it cannot undo concurrent proposition edits.
  // Only indents and embeddings arrive here now — where the lines are DIVIDED
  // is the propositions', and comes back through onDocumentChange above.
  const onTextFlowChange = useCallback((flow: TextFlow) => {
    const base = draftRef.current;
    if (base === null) return;
    draftRef.current = { ...base, textFlow: flow };
    setTextFlow(flow);
    setDirty(true);
  }, []);

  /** The passage the flow covers: every corpus-sourced proposition, end to end. */
  const passageRange = useMemo(() => {
    if (initialDoc === null) return null;
    let min = Infinity;
    let max = -Infinity;
    for (const p of initialDoc.propositions) {
      if (p.source.kind === 'corpus') {
        min = Math.min(min, p.source.start);
        max = Math.max(max, p.source.end);
      }
    }
    return min > max ? null : { start: min, end: max };
  }, [initialDoc]);

  // There is ALWAYS a flow. A document saved before the flow existed — or one
  // whose lines no longer match its propositions — takes the flow the first
  // pass derives for the passage (the same clause division and indents as the
  // analysis), re-cut to the propositions; if that cannot be had, one flush
  // line per proposition. Deriving it is not an EDIT: the page stays clean, so
  // merely opening an old analysis raises no unsaved-changes warning, and the
  // flow goes with the next save the analyst makes.
  useEffect(() => {
    if (initialDoc === null || passageRange === null) return;
    if (isAligned(initialDoc.textFlow ?? null, corpusPropositions(initialDoc))) return;
    let cancelled = false;
    setTextFlow(null); // the panel waits
    const install = (derived: TextFlow | null) => {
      if (cancelled) return;
      const base = draftRef.current ?? initialDoc;
      const flow = reconcileFlow(derived, corpusPropositions(base));
      draftRef.current = { ...base, textFlow: flow };
      setTextFlow(flow);
    };
    getTextFlow(passageRange.start, passageRange.end)
      .then(install)
      .catch(() => {
        install(null);
      });
    return () => {
      cancelled = true;
    };
  }, [initialDoc, passageRange]);

  // The editor's own split and merge, reached from the text flow: the two
  // views divide one document, and one undo history.
  const editorActions = useRef<EditorActions | null>(null);
  const onSplitWord = useCallback((index: number) => {
    editorActions.current?.splitAfter(index);
  }, []);
  const onMergeAfterLine = useCallback((index: number) => {
    editorActions.current?.mergeAt(index);
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

  // The title's opening letter, for skins that illuminate it. Split here
  // rather than in CSS because ::first-letter cannot reach inside an input.
  const shownTitle = title.trim() === '' ? '' : title;
  const initial = [...shownTitle][0] ?? '';
  const rest = initial === '' ? '' : shownTitle.slice(initial.length);

  return (
    <div
      className="analysis-page"
      style={
        treeMargin === null
          ? undefined
          : ({ '--tree-margin': `${treeMargin}px` } as CSSProperties)
      }
    >
      {/* The spread: everything the book skin's fold may run down — the fold
          ends with the editor, so the full-width panels below stay uncut. */}
      <div className="analysis-spread">
      <div className="analysis-toolbar">
        <div className={titleEditing ? 'title-field editing' : 'title-field'}>
          <input
            className="title-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onFocus={() => setTitleEditing(true)}
            onBlur={() => setTitleEditing(false)}
            placeholder="Untitled analysis"
            aria-label="Analysis title"
          />
          {/* The same title again, set the way a manuscript would set it, and
              shown only by a skin that asks for it. It stands OVER the input
              and lets every click through; typing hides it, because a letter
              being illuminated is not a letter being edited. The input keeps
              the real value and the accessible name — this is decoration. */}
          {initial !== '' && !titleEditing && (
            <span className="title-illuminated" aria-hidden="true">
              <span className="title-initial">{initial}</span>
              <span className="title-rest">{rest}</span>
            </span>
          )}
        </div>
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
          <AnalysisEditor
            document={initialDoc}
            onChange={onDocumentChange}
            onTreeMargin={setTreeMargin}
            actionsRef={editorActions}
          />
        </>
      )}
      </div>
      {/* Below the spread: the text flow across the whole width — it is the
          passage re-read, and reads like one — with the notes under it. */}
      {analysis !== null && initialDoc !== null && (
        <div className="analysis-lower">
          <TextFlowPanel
            flow={textFlow}
            range={passageRange}
            onChange={onTextFlowChange}
            onSplitWord={onSplitWord}
            onMergeAfterLine={onMergeAfterLine}
          />
          {/* has-notes is what the print sheet reads: an empty box prints
              nothing rather than a blank page. */}
          <section className={notes.trim() === '' ? 'notes-panel' : 'notes-panel has-notes'}>
            <h2>Notes</h2>
            <NotesEditor value={notes} onChange={setNotes} />
          </section>
        </div>
      )}
      {analysis === null && errors.length === 0 && <p className="muted">Loading…</p>}
    </div>
  );
}
