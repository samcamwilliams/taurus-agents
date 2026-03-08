import { Circle, Loader2, Pause, AlertCircle, Ban } from 'lucide-react';
import type { AgentStatus } from '../types';

const iconMap: Record<AgentStatus, typeof Circle> = {
  idle: Circle,
  running: Loader2,
  paused: Pause,
  error: AlertCircle,
  disabled: Ban,
};

export function StatusBadge({ status }: { status: AgentStatus }) {
  const Icon = iconMap[status];
  return (
    <span className={`status-badge ${status}`}>
      <Icon size={12} className={status === 'running' ? 'spin' : ''} />
      {status}
    </span>
  );
}
