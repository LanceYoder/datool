// "Send me a reset link." The server answers 200 whether or not the address is
// a known account (§6), so this page says the same thing either way — telling
// a stranger which addresses exist is the one thing it must not do.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { errorMessages, forgotPassword } from '../api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setErrors([]);
    try {
      await forgotPassword(email.trim());
      setSent(true);
    } catch (err) {
      setErrors(errorMessages(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <section className="card auth-card">
        <h2>Reset your password</h2>
        {sent ? (
          <p className="muted" role="status">
            If that address has an account, a reset link is on its way to it.
          </p>
        ) : (
          <form onSubmit={(event) => void submit(event)}>
            <label className="form-row">
              <span className="form-label">Email</span>
              <input
                className="form-input"
                type="email"
                value={email}
                autoComplete="email"
                autoFocus
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <div className="row-actions">
              <button type="submit" className="primary" disabled={busy || email.trim() === ''}>
                Send reset link
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
