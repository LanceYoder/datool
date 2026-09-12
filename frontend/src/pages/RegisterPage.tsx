// Registering: an individual account, email and password (accounts-spec §2).
// Provisioned accounts never come through here — an admin or a professor makes
// those, and their owner arrives at /reset-password with an invitation link.

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { errorMessages, register } from '../api';
import { useSession } from '../session';

export default function RegisterPage() {
  const navigate = useNavigate();
  const { refresh } = useSession();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setErrors([]);
    try {
      // Registering signs you in, so there is nowhere to go but the work.
      await register({
        email: email.trim(),
        password,
        ...(name.trim() === '' ? {} : { name: name.trim() }),
      });
      await refresh();
      navigate('/', { replace: true });
    } catch (err) {
      setErrors(errorMessages(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <section className="card auth-card">
        <h2>Register</h2>
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
          <label className="form-row">
            <span className="form-label">Name</span>
            <input
              className="form-input"
              value={name}
              autoComplete="name"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="form-row">
            <span className="form-label">Password</span>
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
              disabled={busy || email.trim() === '' || password === ''}
            >
              Create account
            </button>
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
          Already have one? <Link to="/login">Sign in</Link>
        </p>
      </section>
    </div>
  );
}
