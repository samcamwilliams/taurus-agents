import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Copy, FileText, Search } from 'lucide-react';
import type { MessageRecord } from '../types';
import { fmtCost, fmtTokens, extractMessageText } from '../utils/format';

interface MessageMenuProps {
  message: MessageRecord;
  onInspect?: (message: MessageRecord) => void;
}

export function MessageMenu({ message, onInspect }: MessageMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const hasUsage = message.role === 'assistant' && message.usage;

  return (
    <div className="msg-menu" ref={ref}>
      <button
        className="msg-menu__trigger"
        onClick={() => setOpen(!open)}
        title="Message actions"
      >
        <ChevronDown size={12} />
      </button>

      {open && (
        <div className="msg-menu__dropdown">
          <button
            className="msg-menu__item"
            onClick={() => {
              navigator.clipboard.writeText(extractMessageText(message.content));
              setOpen(false);
            }}
          >
            <Copy size={12} /> Copy
          </button>
          <button
            className="msg-menu__item"
            onClick={() => {
              const md = `**${message.role}** (${new Date(message.created_at).toLocaleString()})\n\n${extractMessageText(message.content)}`;
              navigator.clipboard.writeText(md);
              setOpen(false);
            }}
          >
            <FileText size={12} /> Copy as Markdown
          </button>
          {onInspect && (
            <button
              className="msg-menu__item"
              onClick={() => { onInspect(message); setOpen(false); }}
            >
              <Search size={12} /> Inspect
            </button>
          )}

          {hasUsage && (
            <>
              <div className="msg-menu__sep" />
              <div className="msg-menu__info">
                <div className="msg-menu__info-row">
                  <span>Input</span>
                  <span>{fmtTokens(message.usage!.input)}</span>
                </div>
                <div className="msg-menu__info-row">
                  <span>Output</span>
                  <span>{fmtTokens(message.usage!.output)}</span>
                </div>
                {(message.usage!.cacheRead ?? 0) > 0 && (
                  <div className="msg-menu__info-row msg-menu__info-row--sub">
                    <span>Cache read</span>
                    <span>{fmtTokens(message.usage!.cacheRead!)}</span>
                  </div>
                )}
                {(message.usage!.cacheWrite ?? 0) > 0 && (
                  <div className="msg-menu__info-row msg-menu__info-row--sub">
                    <span>Cache write</span>
                    <span>{fmtTokens(message.usage!.cacheWrite!)}</span>
                  </div>
                )}
                {(message.usage!.reasoningTokens ?? 0) > 0 && (
                  <div className="msg-menu__info-row msg-menu__info-row--sub">
                    <span>Reasoning</span>
                    <span>{fmtTokens(message.usage!.reasoningTokens!)}</span>
                  </div>
                )}
                {message.cost != null && (
                  <div className="msg-menu__info-row msg-menu__info-row--cost">
                    <span>Cost</span>
                    <span>{fmtCost(message.cost)}</span>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
