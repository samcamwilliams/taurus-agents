import { Pause } from 'lucide-react';
import type { AgentStatus, RunStatus } from '../types';
import type { ChannelIndicatorMode } from '../hooks/usePreferences';

type Status = AgentStatus | RunStatus;

const STATUS_CLASS: Record<Status, string> = {
  idle:      'status-dot--idle',
  running:   'status-dot--running',
  paused:    'status-dot--paused',
  error:     'status-dot--error',
  disabled:  'status-dot--idle',
  completed: 'status-dot--completed',
  stopped:   'status-dot--idle',
};

export function StatusDot({
  status,
  size = 8,
  label,
  indicatorMode = 'animated',
}: {
  status: Status;
  size?: number;
  label?: boolean;
  indicatorMode?: ChannelIndicatorMode;
}) {
  const cls = STATUS_CLASS[status] ?? 'status-dot--idle';

  if (indicatorMode === 'muted') {
    return <span className="status-dot-placeholder" style={{ width: size, height: size }} aria-hidden />;
  }

  if (status === 'paused') {
    return (
      <span className="status-dot-wrap" title={status}>
        <Pause size={size + 2} className={`status-dot-icon ${cls}`} data-indicator-mode={indicatorMode} />
        {label && <span className="status-dot__label">{status}</span>}
      </span>
    );
  }

  return (
    <span className="status-dot-wrap" title={status}>
      <span
        className={`status-dot ${cls}`}
        data-indicator-mode={indicatorMode}
        style={{ width: size, height: size }}
      />
      {label && <span className="status-dot__label">{status}</span>}
    </span>
  );
}
