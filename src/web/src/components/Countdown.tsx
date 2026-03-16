import { useState, useEffect, type MouseEvent } from 'react';

interface CountdownProps {
  targetDate: string;
  schedule?: string;
  onClick?: (e?: MouseEvent) => void;
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return 'now';

  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);

  if (days > 0) return `${days}d ${hrs % 24}h`;
  if (hrs > 0) return `${hrs}h ${mins % 60}m`;
  if (mins > 0) return `${mins}m ${secs % 60}s`;
  return `${secs}s`;
}

export function Countdown({ targetDate, schedule, onClick }: CountdownProps) {
  const [remaining, setRemaining] = useState(() => new Date(targetDate).getTime() - Date.now());

  useEffect(() => {
    setRemaining(new Date(targetDate).getTime() - Date.now());
    const interval = setInterval(() => {
      setRemaining(new Date(targetDate).getTime() - Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [targetDate]);

  const tooltip = schedule
    ? `${new Date(targetDate).toLocaleString()}\nSchedule: ${schedule}${onClick ? '\nClick to trigger now' : ''}`
    : new Date(targetDate).toLocaleString();

  return (
    <span className={`countdown${onClick ? ' countdown--clickable' : ''}`} title={tooltip} onClick={onClick ? (e) => onClick(e) : undefined} role={onClick ? 'button' : undefined}>
      <span className="countdown__label">Next</span><span className="countdown__value">{formatRemaining(remaining)}</span>
    </span>
  );
}
