import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Copy, FileText, Search, Trash2 } from 'lucide-react';
import type { MessageRecord } from '../types';
import { fmtCost, fmtTokens, extractMessageText, stripInjectedMessageEnvelope } from '../utils/format';
import { copyToClipboard } from '../utils/clipboard';

interface MessageMenuProps {
  message: MessageRecord;
  onInspect?: (message: MessageRecord) => void;
  onDelete?: (message: MessageRecord) => void;
}

export function MessageMenu({ message, onInspect, onDelete }: MessageMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const messageLabel = message.author?.label ?? message.role;
  const messageContent = message.role === 'user'
    ? stripInjectedMessageEnvelope(message.content)
    : message.content;

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
            onClick={async () => {
              await copyToClipboard(extractMessageText(messageContent));
              setOpen(false);
            }}
          >
            <Copy size={12} /> Copy
          </button>
          <button
            className="msg-menu__item"
            onClick={async () => {
              const md = `**${messageLabel}** (${new Date(message.created_at).toLocaleString()})\n\n${extractMessageText(messageContent)}`;
              await copyToClipboard(md);
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
          {onDelete && (
            <button
              className="msg-menu__item msg-menu__item--danger"
              onClick={() => { onDelete(message); setOpen(false); }}
            >
              <Trash2 size={12} /> Delete
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
