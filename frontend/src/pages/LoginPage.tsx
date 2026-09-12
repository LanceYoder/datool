// Signing in: email OR handle, and a password. Nothing else — a learning
// account has no email at all, so the one field takes either (accounts-spec §3).

import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { errorMessages, login } from '../api';
import { useSession } from '../session';

export default function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user, loading, refresh } = useSession();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  // Where to land: where they were headed before the session ran out.
  const next = params.get('next') ?? '/';

  // Already signed in — arriving here from a stale link, or having signed in
  // in another tab — goes straight on.
  useEffect(() => {
    if (!loading && user !== null) navigate(next, { replace: true });
  }, [loading, user, next, navigate]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setErrors([]);
    try {
      await login({ login: identifier.trim(), password });
      await refresh();
      navigate(next, { replace: true });
    } catch (err) {
      setErrors(errorMessages(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <section className="card auth-card">
        <h2>Sign in</h2>
        <form onSubmit={(event) => void submit(event)}>
          <label className="form-row">
            <span className="form-label">Email or login handle</span>
            <input
              className="form-input"
              value={identifier}
              autoComplete="username"
              autoFocus
              onChange={(event) => setIdentifier(event.target.value)}
            />
          </label>
          <label className="form-row">
            <span className="form-label">Password</span>
            <input
              className="form-input"
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <div className="row-actions">
            <button
              type="submit"
              className="primary"
              disabled={busy || identifier.trim() === '' || password === ''}
            >
              Sign in
            </button>
            <Link to="/forgot-password" className="form-aside">
              Forgot your password?
            </Link>
          </div>
        </form>
        {errors.length > 0 && (
          <ul className="error-box">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        )}
        <p className="muted form-foot">
          No account yet? <Link to="/register">Register</Link>
        </p>
      </section>
    </div>
  );
}
