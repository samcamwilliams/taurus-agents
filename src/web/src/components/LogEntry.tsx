import type { LogEntry as LogEntryType } from '../types';
import { fmtSmartTime } from '../utils/format';

function formatTime(entry: LogEntryType): string {
  const raw = entry.created_at || entry.timestamp;
  if (!raw) return '';
  return fmtSmartTime(new Date(raw));
}

export function LogEntry({ entry }: { entry: LogEntryType }) {
  return (
    <div className={`log-entry ${entry.level || 'info'}`}>
      <span className="log-entry__ts">{formatTime(entry)}</span>
      <span className="log-entry__event">{entry.event || ''}</span>
      {entry.message || ''}
    </div>
  );
}
