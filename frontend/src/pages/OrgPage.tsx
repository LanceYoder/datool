// The administrator's page (accounts-spec §8): the members of one organization,
// what each of them is, and the one way to make a new account — by email. An
// address that already has an account is invited; a new one is made and sent
// a set-password mail. When mail cannot be sent, the server hands the link
// back instead, and it is shown here, once, for the admin to pass on.
//
// Nothing on this page reads anybody's analyses: that is the professor's, and
// it lives at /teach.

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  createOrgMember,
  errorMessages,
  listOrgMembers,
  resetMemberPassword,
  updateOrgMember,
} from '../api';
import type { OrgMember, Role } from '../types';
import { displayName } from '../accounts';

const ROLE_WORD: Record<Role, string> = {
  admin: 'Administrator',
  professor: 'Professor',
  student: 'Student',
};

/** What a member is called on screen. A pending invitation has no name to
 *  show — only the address it was sent to, which is what displayName falls
 *  back to. */
export function memberName(m: OrgMember): string {
  return displayName(m.user, `#${m.membershipId}`);
}

/**
 * Whether this organization may reset the member's password at all: only an
 * account the org PROVISIONED gets the reset mail from here. An account
 * somebody brought with them when they joined is theirs, and they reset it
 * from the sign-in page. A pending invitation is not a member yet.
 */
export function canReset(m: OrgMember): boolean {
  return m.provisioned && !m.pending;
}

/** A set-password link the server handed back because mail could not be sent. */
export interface LinkHandout {
  who: string;
  link: string;
}

/**
 * The one thing that is shown ONCE and never again: the set-password link
 * (the provisioning flow calls it `inviteLink`, the reset flow `resetLink` —
 * the same thing). Rendered only when the server returned one.
 */
export function HandOut({ who, link }: LinkHandout) {
  return (
    <div className="handout" role="status">
      <strong>{who}</strong>
      <p className="handout-line">
        Set-password link (mail could not be sent — pass it on yourself):{' '}
        <code className="handout-value">{link}</code>
      </p>
      <p className="muted">This is shown once. Copy it now.</p>
    </div>
  );
}

export default function OrgPage() {
  const { id = '' } = useParams<{ id: string }>();
  const [members, setMembers] = useState<OrgMember[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [handout, setHandout] = useState<LinkHandout | null>(null);
  // What just happened, for the usual case where there is no link to hand
  // over — the mail went out.
  const [notice, setNotice] = useState<string | null>(null);

  // The provisioning form.
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('student');
  const [professor, setProfessor] = useState('');

  const load = useCallback(async () => {
    try {
      setMembers(await listOrgMembers(id));
    } catch (err) {
      setErrors(errorMessages(err));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const professors = (members ?? []).filter((m) => m.role === 'professor' && m.active);

  const provision = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setErrors([]);
    setHandout(null);
    setNotice(null);
    try {
      const who = email.trim();
      const created = await createOrgMember(id, {
        role,
        email: who,
        ...(name.trim() === '' ? {} : { name: name.trim() }),
        ...(role === 'student' && professor !== '' ? { professor: Number(professor) } : {}),
      });
      // One wording whether or not the address already had an account — the
      // answer is deliberately the same either way (see types.ts).
      if (created.inviteLink) {
        setHandout({ who, link: created.inviteLink });
      } else {
        setNotice(
          `${who} has been sent an email to set their password — or, if they already had an account, an invitation to accept.`,
        );
      }
      setEmail('');
      setName('');
      await load();
    } catch (err) {
      setErrors(errorMessages(err));
    } finally {
      setBusy(false);
    }
  };

  const patch = async (
    m: OrgMember,
    input: { role?: Role; professor?: number | null; active?: boolean },
  ) => {
    setErrors([]);
    try {
      await updateOrgMember(id, m.membershipId, input);
      await load();
    } catch (err) {
      setErrors(errorMessages(err));
    }
  };

  const reset = async (m: OrgMember) => {
    setErrors([]);
    setHandout(null);
    setNotice(null);
    try {
      const out = await resetMemberPassword(id, m.membershipId);
      // The mail went out and there is nothing to show — or it could not be
      // sent, and the link is shown here and nowhere else, ever.
      if (out.resetLink) setHandout({ who: memberName(m), link: out.resetLink });
      else setNotice(`A reset link is on its way to ${memberName(m)}.`);
    } catch (err) {
      setErrors(errorMessages(err));
    }
  };

  return (
    <div className="org-page">
      <h2>Members</h2>
      {errors.length > 0 && (
        <ul className="error-box">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
      {notice !== null && (
        <p className="muted" role="status">
          {notice}
        </p>
      )}
      {handout !== null && <HandOut who={handout.who} link={handout.link} />}
      {members === null && <p className="muted">Loading…</p>}
      {members !== null && members.length === 0 && <p className="muted">No members yet.</p>}
      {members !== null && members.length > 0 && (
        <table className="member-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Email</th>
              <th scope="col">Role</th>
              <th scope="col">Professor</th>
              <th scope="col">Status</th>
              <th scope="col">Password</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.membershipId} className={m.active ? undefined : 'inactive'}>
                <td>
                  {memberName(m)}
                  {m.pending && (
                    <span className="muted"> — invited, not yet accepted</span>
                  )}
                </td>
                <td className="muted">{m.user.email}</td>
                <td>
                  <label>
                    <span className="visually-hidden">Role for {memberName(m)}</span>
                    <select
                      className="form-select"
                      value={m.role}
                      onChange={(event) => void patch(m, { role: event.target.value as Role })}
                    >
                      {(['admin', 'professor', 'student'] as Role[]).map((r) => (
                        <option key={r} value={r}>
                          {ROLE_WORD[r]}
                        </option>
                      ))}
                    </select>
                  </label>
                </td>
                <td>
                  {m.role !== 'student' ? (
                    <span className="muted">—</span>
                  ) : (
                    <label>
                      <span className="visually-hidden">Professor for {memberName(m)}</span>
                      <select
                        className="form-select"
                        value={m.professor === null ? '' : String(m.professor.id)}
                        onChange={(event) =>
                          void patch(m, {
                            professor: event.target.value === '' ? null : Number(event.target.value),
                          })
                        }
                      >
                        <option value="">Not assigned</option>
                        {professors.map((p) => (
                          <option key={p.membershipId} value={p.membershipId}>
                            {memberName(p)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </td>
                <td>
                  <button type="button" onClick={() => void patch(m, { active: !m.active })}>
                    {m.active ? 'Deactivate' : 'Reactivate'}
                  </button>
                </td>
                <td>
                  {canReset(m) ? (
                    <button type="button" onClick={() => void reset(m)}>
                      Send reset link
                    </button>
                  ) : (
                    // Their password is their own (or they have not joined yet).
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <section className="card">
        <h2>Add a member</h2>
        <form onSubmit={(event) => void provision(event)}>
          <label className="form-row">
            <span className="form-label">Email</span>
            <input
              className="form-input"
              type="email"
              value={email}
              placeholder="student@example.edu"
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="form-row">
            <span className="form-label">Name</span>
            <input
              className="form-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="form-row">
            <span className="form-label">Role</span>
            <select
              className="form-select"
              value={role}
              onChange={(event) => setRole(event.target.value as Role)}
            >
              {(['student', 'professor', 'admin'] as Role[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_WORD[r]}
                </option>
              ))}
            </select>
          </label>
          {role === 'student' && (
            <label className="form-row">
              <span className="form-label">Professor</span>
              <select
                className="form-select"
                value={professor}
                onChange={(event) => setProfessor(event.target.value)}
              >
                <option value="">Not assigned</option>
                {professors.map((p) => (
                  <option key={p.membershipId} value={p.membershipId}>
                    {memberName(p)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="row-actions">
            <button
              type="submit"
              className="primary"
              disabled={busy || email.trim() === ''}
            >
              Add member
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
