// The reader's own account: who they are, what organizations they belong to,
// and the one thing they can change here — their password (accounts-spec §8).
//
// Nothing here CREATES an organization. §2 makes that site staff's to do, at a
// school's request, so the page only lists the memberships and invitations
// the reader already has.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  acceptInvitation,
  changePassword,
  declineInvitation,
  errorMessages,
  updateMe,
} from '../api';
import { useSession } from '../session';
import type { Role } from '../types';

const ROLE_WORD: Record<Role, string> = {
  admin: 'Administrator',
  professor: 'Professor',
  student: 'Student',
};

/** Where a membership's own page is, if that role has one. */
function membershipLink(role: Role, orgId: number): string | null {
  if (role === 'admin') return `/org/${orgId}`;
  if (role === 'professor') return `/teach/${orgId}`;
  return null;
}

export default function AccountPage() {
  const { user, refresh } = useSession();
  const [name, setName] = useState<string | null>(null);
  const [nameBusy, setNameBusy] = useState(false);
  const [nameErrors, setNameErrors] = useState<string[]>([]);
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [pwErrors, setPwErrors] = useState<string[]>([]);
  const [pwDone, setPwDone] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);
  const [inviteErrors, setInviteErrors] = useState<string[]>([]);
  const [inviteBusy, setInviteBusy] = useState<number | null>(null);

  if (user === null) return null;

  // The name field starts as whatever the session says, and only becomes
  // state of its own once it is typed in.
  const shownName = name ?? user.name;

  const submitName = async (event: React.FormEvent) => {
    event.preventDefault();
    setNameBusy(true);
    setNameErrors([]);
    try {
      await updateMe({ name: shownName.trim() });
      await refresh();
      setName(null);
    } catch (err) {
      setNameErrors(errorMessages(err));
    } finally {
      setNameBusy(false);
    }
  };

  const submitPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setPwBusy(true);
    setPwErrors([]);
    setPwDone(false);
    try {
      await changePassword({ current, password });
      setCurrent('');
      setPassword('');
      setPwDone(true);
    } catch (err) {
      setPwErrors(errorMessages(err));
    } finally {
      setPwBusy(false);
    }
  };

  /**
   * Answering an invitation. Until this is done the row on the other side
   * grants the organization nothing: no policy over this account, no reading
   * of its analyses, no role in the header. Declining removes it outright.
   */
  const answer = async (membershipId: number, join: boolean) => {
    setInviteBusy(membershipId);
    setInviteErrors([]);
    try {
      if (join) await acceptInvitation(membershipId);
      else await declineInvitation(membershipId);
      await refresh();
    } catch (err) {
      setInviteErrors(errorMessages(err));
    } finally {
      setInviteBusy(null);
    }
  };

  return (
    <div className="account-page">
      <section className="card">
        <h2>Account</h2>
        <dl className="detail-list">
          <div className="detail-row">
            <dt>Email</dt>
            <dd>{user.email}</dd>
          </div>
        </dl>
        <form onSubmit={(event) => void submitName(event)}>
          <label className="form-row">
            <span className="form-label">Name</span>
            <input
              className="form-input"
              value={shownName}
              autoComplete="name"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <div className="row-actions">
            <button type="submit" disabled={nameBusy || shownName.trim() === user.name.trim()}>
              Save name
            </button>
          </div>
        </form>
        {nameErrors.length > 0 && (
          <ul className="error-box">
            {nameErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        )}
      </section>

      {user.invitations.length > 0 && (
        <section className="card">
          <h2>Invitations</h2>
          <p className="muted">
            You have been asked to join these. Nothing changes for your account
            until you accept.
          </p>
          <ul className="analysis-list">
            {user.invitations.map((invitation) => (
              <li key={invitation.membershipId} className="member-row">
                <span className="analysis-title">{invitation.org.name}</span>
                <span className="muted">as {ROLE_WORD[invitation.role]}</span>
                <button
                  type="button"
                  className="primary"
                  disabled={inviteBusy === invitation.membershipId}
                  onClick={() => void answer(invitation.membershipId, true)}
                >
                  Accept
                </button>
                <button
                  type="button"
                  disabled={inviteBusy === invitation.membershipId}
                  onClick={() => void answer(invitation.membershipId, false)}
                >
                  Decline
                </button>
              </li>
            ))}
          </ul>
          {inviteErrors.length > 0 && (
            <ul className="error-box">
              {inviteErrors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section>
        <h2>Organizations</h2>
        {user.memberships.length === 0 && (
          <p className="muted">You belong to no organization.</p>
        )}
        {user.memberships.length > 0 && (
          <ul className="analysis-list">
            {user.memberships.map((m) => {
              const to = membershipLink(m.role, m.org.id);
              return (
                <li key={`${m.org.id}-${m.role}`} className="member-row">
                  <span className="analysis-title">{m.org.name}</span>
                  <span className="muted">{ROLE_WORD[m.role]}</span>
                  <span className="muted">
                    {m.role === 'student' && m.professor != null
                      ? `with ${m.professor.name}`
                      : ''}
                  </span>
                  {to !== null && <Link to={to}>Open</Link>}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Change password</h2>
        <form onSubmit={(event) => void submitPassword(event)}>
          <label className="form-row">
            <span className="form-label">Current password</span>
            <input
              className="form-input"
              type="password"
              value={current}
              autoComplete="current-password"
              onChange={(event) => setCurrent(event.target.value)}
            />
          </label>
          <label className="form-row">
            <span className="form-label">New password</span>
            <input
              className="form-input"
              type="password"
              value={password}
              autoComplete="new-password"
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <div className="row-actions">
            <button
              type="submit"
              className="primary"
              disabled={pwBusy || current === '' || password === ''}
            >
              Change password
            </button>
            {pwDone && (
              <span className="muted form-aside" role="status">
                Password changed.
              </span>
            )}
          </div>
        </form>
        {pwErrors.length > 0 && (
          <ul className="error-box">
            {pwErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
