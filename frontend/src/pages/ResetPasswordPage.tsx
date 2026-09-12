// Where a reset mail — and an invitation, which uses the same tokens — lands:
// /reset-password/<uid>/<token>. Setting the password does not sign anyone in,
// so the page hands them on to /login (§3).

import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { errorMessages, resetPassword } from '../api';

export default function ResetPasswordPage() {
  const { uid = '', token = '' } = useParams<{ uid: string; token: string }>();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const mismatch = again !== '' && again !== password;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (mismatch) return;
    setBusy(true);
    setErrors([]);
    try {
      await resetPassword({ uid, token, password });
      setDone(true);
    } catch (err) {
      setErrors(errorMessages(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <section className="card auth-card">
        <h2>Set your password</h2>
        {done ? (
          <>
            <p role="status">Your password is set.</p>
            <div className="row-actions">
              <button
                type="button"
                className="primary"
                onClick={() => navigate('/login', { replace: true })}
              >
                Sign in
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={(event) => void submit(event)}>
            <label className="form-row">
              <span className="form-label">New password</span>
              <input
                className="form-input"
                type="password"
                value={password}
                autoComplete="new-password"
                autoFocus
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <label className="form-row">
              <span className="form-label">New password again</span>
              <input
                className="form-input"
                type="password"
                value={again}
                autoComplete="new-password"
                onChange={(event) => setAgain(event.target.value)}
              />
            </label>
            {mismatch && <p className="muted form-aside">The two do not match yet.</p>}
            <div className="row-actions">
              <button
                type="submit"
                className="primary"
                disabled={busy || password === '' || mismatch || again === ''}
              >
                Set password
              </button>
            </div>
          </form>
        )}
        {errors.length > 0 && (
          <ul className="error-box">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        )}
        <p className="muted form-foot">
          <Link to="/login">Back to sign in</Link>
        </p>
      </section>
    </div>
  );
}
