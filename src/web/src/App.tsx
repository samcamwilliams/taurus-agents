import { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AgentsPage } from './pages/AgentsPage';
import { LoginPage } from './pages/LoginPage';
import { setCsrfToken } from './api';

type AuthState = 'loading' | 'authenticated' | 'login';

export function App() {
  const [auth, setAuth] = useState<AuthState>('loading');

  useEffect(() => {
    fetch('/api/auth/check')
      .then((r) => r.json())
      .then((data) => {
        if (!data.authEnabled || data.authenticated) {
          if (data.csrfToken) setCsrfToken(data.csrfToken);
          setAuth('authenticated');
        } else {
          setAuth('login');
        }
      })
      .catch(() => setAuth('login'));
  }, []);

  if (auth === 'loading') return null;

  if (auth === 'login') {
    return (
      <LoginPage
        onLogin={(csrfToken) => {
          setCsrfToken(csrfToken);
          setAuth('authenticated');
        }}
      />
    );
  }

  return (
    <Routes>
      <Route path="/" element={<AgentsPage />} />
      <Route path="/agents/:agentId" element={<AgentsPage />} />
      <Route path="/agents/:agentId/runs/:runId" element={<AgentsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
