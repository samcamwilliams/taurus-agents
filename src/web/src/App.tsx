import { Routes, Route, Navigate } from 'react-router-dom';
import { AgentsPage } from './pages/AgentsPage';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<AgentsPage />} />
      <Route path="/agents/:agentId" element={<AgentsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
