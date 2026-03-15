import { useState, type FormEvent } from 'react';

interface LoginPageProps {
  onLogin: (csrfToken: string) => void;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Login failed');
        return;
      }

      onLogin(data.csrfToken);
    } catch {
      setError('Connection failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-bg" aria-hidden="true" />
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-card__header">
          <h1>Taurus</h1>
        </div>

        <div className="login-card__body">
          {/* Hidden username for password managers */}
          <input
            type="text"
            name="username"
            autoComplete="username"
            value="admin"
            readOnly
            style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', height: 0 }}
          />

          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password"
            autoFocus
            disabled={loading}
          />

          {error && <div className="login-card__error">{error}</div>}

          <button type="submit" className="btn primary login-card__submit" disabled={loading || !password}>
            {loading ? 'Signing in\u2026' : 'Sign in'}
          </button>
        </div>
      </form>
    </div>
  );
}
