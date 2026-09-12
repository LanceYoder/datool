// The administrator's page (accounts-spec §8): the members of one organization,
// what each of them is, and the two ways to make a new account —
//
//   by email   an invitation carrying a set-password link. When mail cannot be
//              sent, the server hands the link back instead, and it is shown
//              here, once, for the admin to pass on.
//   by handle  a LEARNING ACCOUNT: no email at all, so its password is set by
//              a person. One is generated when none is typed, and shown here.
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
import type { OrgMember, ProvisionSecrets, Role } from '../types';
import { isInvited } from '../types';
import { displayName, signIn } from '../accounts';

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
 * Whether this organization may set the member's password at all.
 *
 * A learning account has no inbox, so a person resets it — that is the whole
 * point of the account kind. An account the org PROVISIONED by email gets the
 * reset mail. An account somebody brought with them when they joined is
 * neither: it is theirs, and they reset it from the sign-in page.
 */
export function resetLabel(m: OrgMember): string | null {
  if (m.pending) return null;
  if (!m.hasEmail) return 'New temporary password';
  return m.provisioned ? 'Send reset link' : null;
}

/**
 * The one thing that is shown ONCE and never again: an invitation link (the
 * provisioning flow calls it `inviteLink`, the reset flow `resetLink` — the
 * same thing, so both are read), or a temporary password.
 */
export function HandOut({ who, secrets }: { who: string; secrets: ProvisionSecrets }) {
  // The API sends these as nulls rather than leaving them out, so an absent
  // secret is a null here, not an undefined.
  const link = secrets.inviteLink ?? secrets.resetLink ?? null;
  const temporary = secrets.temporaryPassword ?? null;
  if (link === null && temporary === null) return null;
  return (
    <div className="handout" role="status">
      <strong>{who}</strong>
      {link !== null && (
        <p className="handout-line">
          Set-password link (mail could not be sent — pass it on yourself):{' '}
          <code className="handout-value">{link}</code>
        </p>
      )}
      {temporary !== null && (
        <p className="handout-line">
          Temporary password: <code className="handout-value">{temporary}</code>
        </p>
      )}
      <p className="muted">This is shown once. Copy it now.</p>
    </div>
  );
}

export default function OrgPage() {
  const { id = '' } = useParams<{ id: string }>();
  const [members, setMembers] = useState<OrgMember[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [handout, setHandout] = useState<{ who: string; secrets: ProvisionSecrets } | null>(null);
  // What just happened, for the case where there is no secret to hand over —
  // an invitation that went out by mail, or one waiting to be accepted.
  const [notice, setNotice] = useState<string | null>(null);

  // The provisioning form.
  const [kind, setKind] = useState<'email' | 'handle'>('email');
  const [identifier, setIdentifier] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('student');
  const [password, setPassword] = useState('');
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
      const who = identifier.trim();
      const created = await createOrgMember(id, {
        role,
        ...(kind === 'email' ? { email: who } : { handle: who }),
        ...(name.trim() === '' ? {} : { name: name.trim() }),
        // A temporary password belongs to a LEARNING account only; the field
        // is hidden for email accounts, so nothing typed there may ride along.
        ...(kind === 'handle' && password !== '' ? { password } : {}),
        ...(role === 'student' && professor !== '' ? { professor: Number(professor) } : {}),
      });
      if (isInvited(created)) {
        // One wording whether or not the address already had an account —
        // the answer is deliberately the same either way (see types.ts).
        setHandout(created.inviteLink ? { who, secrets: created } : null);
        setNotice(`Invited ${who} — they join when they accept, or when they set their password.`);
      } else {
        setHandout({ who: memberName(created), secrets: created });
        setNotice(`${memberName(created)} added.`);
      }
      setIdentifier('');
      setName('');
      setPassword('');
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
    try {
      const out = await resetMemberPassword(id, m.membershipId);
      // An email account whose mail went out has nothing to show; anything
      // else — a link that could not be mailed, a new temporary password —
      // is shown here and nowhere else, ever.
      if (out.sent === true) window.alert(`A reset link is on its way to ${memberName(m)}.`);
      setHandout({ who: memberName(m), secrets: out });
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
      {handout !== null && <HandOut who={handout.who} secrets={handout.secrets} />}
      {members === null && <p className="muted">Loading…</p>}
      {members !== null && members.length === 0 && <p className="muted">No members yet.</p>}
      {members !== null && members.length > 0 && (
        <table className="member-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Sign-in</th>
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
                <td className="muted">{signIn(m.user) ?? '—'}</td>
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
                  {resetLabel(m) === null ? (
                    <span className="muted">
                      {m.pending ? 'awaiting their answer' : 'their own account'}
                    </span>
                  ) : (
                    <button type="button" onClick={() => void reset(m)}>
                      {resetLabel(m)}
                    </button>
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
          <div className="form-row">
            <span className="form-label">Account kind</span>
            <div className="level-toggle" role="radiogroup" aria-label="Account kind">
              <button
                type="button"
                role="radio"
                aria-checked={kind === 'email'}
                className={kind === 'email' ? 'on' : ''}
                onClick={() => {
                  setKind('email');
                  setPassword(''); // the field disappears; so must its value
                }}
              >
                By email
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={kind === 'handle'}
                className={kind === 'handle' ? 'on' : ''}
                onClick={() => setKind('handle')}
              >
                Learning account
              </button>
            </div>
          </div>
          <label className="form-row">
            <span className="form-label">{kind === 'email' ? 'Email' : 'Login handle'}</span>
            <input
              className="form-input"
              type={kind === 'email' ? 'email' : 'text'}
              value={identifier}
              placeholder={kind === 'email' ? 'student@example.edu' : 'greek101-smith'}
              onChange={(event) => setIdentifier(event.target.value)}
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
          {kind === 'handle' && (
            <label className="form-row">
              <span className="form-label">Temporary password</span>
              <input
                className="form-input"
                value={password}
                placeholder="Leave empty and one is generated"
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
          )}
          <div className="row-actions">
            <button
              type="submit"
              className="primary"
              disabled={busy || identifier.trim() === ''}
            >
              Add member
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
