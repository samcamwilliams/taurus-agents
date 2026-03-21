import { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { AgentsPage } from './pages/AgentsPage';
import { LoginPage } from './pages/LoginPage';
import { setCsrfToken } from './api';
import { useTheme } from './hooks/useTheme';

type AuthState = 'loading' | 'authenticated' | 'login';

export function App() {
  const [auth, setAuth] = useState<AuthState>('loading');
  const [username, setUsername] = useState<string | null>(null);
  const navigate = useNavigate();
  const { setTheme } = useTheme();

  useEffect(() => {
    fetch('/api/auth/check')
      .then((r) => r.json())
      .then((data) => {
        if (data.authenticated) {
          if (data.csrfToken) setCsrfToken(data.csrfToken);
          if (data.username) setUsername(data.username);
          if (data.theme) setTheme(data.theme);
          setAuth('authenticated');
        } else {
          setAuth('login');
        }
      })
      .catch(() => setAuth('login'));
  }, [setTheme]);

  if (auth === 'loading') return null;

  if (auth === 'login') {
    return (
      <LoginPage
        onLogin={({ csrfToken, username: nextUsername, theme }) => {
          setCsrfToken(csrfToken);
          if (nextUsername) setUsername(nextUsername);
          if (theme) setTheme(theme);
          setAuth('authenticated');
        }}
      />
    );
  }

  return (
    <Routes>
      <Route path="/" element={<AgentsPage authEnabled={true} onLogout={() => { navigate('/', { replace: true }); setAuth('login'); setUsername(null); }} />} />
      <Route path="/agents/:agentId" element={<AgentsPage authEnabled={true} onLogout={() => { navigate('/', { replace: true }); setAuth('login'); setUsername(null); }} />} />
      <Route path="/agents/:agentId/dashboards/:dashboardName" element={<AgentsPage authEnabled={true} onLogout={() => { navigate('/', { replace: true }); setAuth('login'); setUsername(null); }} />} />
      <Route path="/agents/:agentId/runs/:runId" element={<AgentsPage authEnabled={true} onLogout={() => { navigate('/', { replace: true }); setAuth('login'); setUsername(null); }} />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
