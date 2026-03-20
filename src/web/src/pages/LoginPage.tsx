import type { Theme } from '../hooks/useTheme';
import { useState, type FormEvent } from 'react';
import { Logo } from '../components/Logo';

interface LoginPageProps {
  onLogin: (payload: { csrfToken: string; username?: string | null; theme?: Theme | null }) => void;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [username, setUsername] = useState('');
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
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Login failed');
        return;
      }

      onLogin({
        csrfToken: data.csrfToken,
        username: data.username ?? null,
        theme: data.theme ?? null,
      });
    } catch {
      setError('Connection failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-bg" aria-hidden="true">
        <div className="login-bg__grid" />
      </div>
      <div className="login-shell">
        <section className="login-intro" aria-label="Taurus">
          <Logo className="login-intro__eyebrow" />
          <h1>
            <span>Cybernetic</span>
            <span>Control</span>
            <span>System.</span>
          </h1>
        </section>

        <form className="login-card" onSubmit={handleSubmit}>
          <div className="login-card__header">
            <h2>Welcome back.</h2>
          </div>

          <div className="login-card__body">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              type="text"
              name="username"
              autoComplete="off"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              autoFocus
              disabled={loading}
            />

            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              disabled={loading}
            />

            {error && <div className="login-card__error">{error}</div>}

            <button type="submit" className="btn primary login-card__submit" disabled={loading || !username || !password}>
              {loading ? 'Signing in\u2026' : 'Sign in'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
