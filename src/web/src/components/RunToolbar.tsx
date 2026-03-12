import { useState, useRef, useEffect } from 'react';
import { PlayCircle, Square, ChevronDown, Eye, EyeOff } from 'lucide-react';
import { StatusDot } from './StatusDot';
import { UsageSummary } from './UsageSummary';
import type { Run, MessageRecord } from '../types';

// ── Floating run controls (Running / Stop / Resume) ──

interface RunControlsProps {
  run: Run;
  onResume?: () => void;
  onStop?: () => void;
}

export function RunControls({ run, onResume, onStop }: RunControlsProps) {
  const isLive = run.status === 'running' || run.status === 'paused';
  if (!isLive) return null;

  return (
    <div className="run-controls">
      <StatusDot status={run.status} />
      <span>{run.status === 'paused' ? 'Paused' : 'Running'}</span>
      {run.status === 'paused' && onResume && (
        <button className="btn btn--sm" onClick={onResume}>
          <PlayCircle size={11} /> Resume
        </button>
      )}
      {onStop && (
        <button className="btn btn--sm" onClick={onStop}>
          <Square size={11} /> Stop
        </button>
      )}
    </div>
  );
}

// ── Run footer (usage summary + dropup menu, inside scroll area) ──

interface RunFooterProps {
  run: Run;
  messages: MessageRecord[];
  showMetadata: boolean;
  onToggleMetadata: () => void;
}

export function RunFooter({ run, messages, showMetadata, onToggleMetadata }: RunFooterProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const totalIn = messages.reduce((s, m) => s + m.input_tokens, 0);
  const totalOut = messages.reduce((s, m) => s + m.output_tokens, 0);
  const totalCost = messages.reduce((s, m) => s + (m.cost ?? 0), 0);
  const totalCacheRead = messages.reduce((s, m) => s + (m.usage?.cacheRead ?? 0), 0);
  const totalCacheWrite = messages.reduce((s, m) => s + (m.usage?.cacheWrite ?? 0), 0);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  return (
    <div className="run-footer">
      {/* Ghost spacer to balance the menu on the right */}
      <div className="run-footer__menu" style={{ visibility: 'hidden' }} aria-hidden>
        <button className="run-footer__menu-trigger" tabIndex={-1}><ChevronDown size={12} /></button>
      </div>

      {/* Usage summary */}
      {totalIn > 0 && (
        <UsageSummary
          label="Total"
          usage={{ input: totalIn, output: totalOut, cacheRead: totalCacheRead || undefined, cacheWrite: totalCacheWrite || undefined }}
          cost={totalCost || undefined}
        />
      )}

      {/* Dropup chevron */}
      <div className="run-footer__menu" ref={menuRef}>
        <button
          className={`run-footer__menu-trigger${showMetadata ? ' run-footer__menu-trigger--active' : ''}`}
          onClick={() => setMenuOpen(!menuOpen)}
          title="View options"
        >
          <ChevronDown size={12} />
        </button>
        {menuOpen && (
          <div className="run-footer__menu-dropdown">
            <button
              className="run-footer__menu-item"
              onClick={() => { onToggleMetadata(); setMenuOpen(false); }}
            >
              {showMetadata ? <EyeOff size={12} /> : <Eye size={12} />}
              {showMetadata ? 'Hide metadata' : 'Show metadata'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
