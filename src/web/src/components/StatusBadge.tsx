import type { AgentStatus } from '../types';

export function StatusBadge({ status }: { status: AgentStatus }) {
  return <span className={`status-badge ${status}`}>{status}</span>;
}
