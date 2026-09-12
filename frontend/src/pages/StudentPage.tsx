// One student's analyses, listed for their professor (accounts-spec §8).
// Opening one opens the ordinary editor with every gesture withheld: §2's
// default is that a professor READS a student's work and never edits it, so
// the link carries `readonly=1` and AnalysisPage puts the locked policy in
// force for that page.
//
// The endpoint is `GET orgs/<id>/students/<mid>/analyses`, so the org has to
// come from somewhere: /teach passes it in the query, and a link opened
// without one falls back to the reader's first teaching membership.

import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { errorMessages, listStudentAnalyses } from '../api';
import { useSession } from '../session';
import type { AnalysisSummary } from '../types';

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export default function StudentPage() {
  const { mid = '' } = useParams<{ mid: string }>();
  const [params] = useSearchParams();
  const { user } = useSession();
  const [analyses, setAnalyses] = useState<AnalysisSummary[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const teaching = user?.memberships.find((m) => m.role === 'professor') ?? null;
  const orgId = params.get('org') ?? (teaching === null ? null : String(teaching.org.id));

  useEffect(() => {
    if (orgId === null) return;
    let cancelled = false;
    listStudentAnalyses(orgId, Number(mid))
      .then((items) => {
        if (!cancelled) setAnalyses(items);
      })
      .catch((err: unknown) => {
        if (!cancelled) setErrors(errorMessages(err));
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, mid]);

  return (
    <div className="student-page">
      <h2>Student’s analyses</h2>
      {orgId === null && <p className="muted">No organization to read these from.</p>}
      {errors.length > 0 && (
        <ul className="error-box">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
      {orgId !== null && analyses === null && errors.length === 0 && (
        <p className="muted">Loading…</p>
      )}
      {analyses !== null && analyses.length === 0 && (
        <p className="muted">This student has no analyses yet.</p>
      )}
      {analyses !== null && analyses.length > 0 && (
        <ul className="analysis-list">
          {analyses.map((a) => (
            <li key={a.id} className="analysis-row">
              <Link to={`/analysis/${a.id}?readonly=1`} className="analysis-link">
                <span className="analysis-title">{a.title}</span>
                <span className="muted">{a.passageRef}</span>
                <span className="muted analysis-date">{formatDate(a.updatedAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="muted form-foot">These open read-only: the work stays the student’s.</p>
    </div>
  );
}
