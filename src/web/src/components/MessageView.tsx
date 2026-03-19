import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Terminal, FileText, FilePen, FolderSearch, Search,
  Pause, Globe, Download, MonitorPlay, Eye,
  Wrench, Minimize2, Maximize2, X, ArrowDown,
} from 'lucide-react';
import type { MessageRecord } from '../types';
import { Markdown } from './Markdown';
import { fmtSmartTime } from '../utils/format';
import { JsonKV } from './JsonKV';
import { DiffView } from './DiffView';
import { Lightbox } from './Lightbox';
import { MessageMenu } from './MessageMenu';
import { UsageSummary } from './UsageSummary';

const TOOL_ICONS: Record<string, typeof Terminal> = {
  Bash: Terminal,
  Read: Eye,
  Write: FileText,
  Edit: FilePen,
  Glob: FolderSearch,
  Grep: Search,
  Pause: Pause,
  WebSearch: Globe,
  WebFetch: Download,
  Browser: MonitorPlay,
};

function ToolHeader({ name, description, onZoom }: { name: string; description?: string; onZoom?: () => void }) {
  const Icon = TOOL_ICONS[name] ?? Wrench;
  return (
    <div className="msg-tool-use__header">
      <Icon size={12} />
      <span>{name}</span>
      {description && <span className="msg-tool-use__desc">{description}</span>}
      {onZoom && (
        <button className="zoomable__btn" onClick={onZoom} title="Maximize">
          <Maximize2 size={12} />
        </button>
      )}
    </div>
  );
}

function ZoomableBlock({ children }: { children: (onZoom: () => void) => React.ReactNode }) {
  const [zoomed, setZoomed] = useState(false);
  const onZoom = () => setZoomed(true);

  useEffect(() => {
    if (!zoomed) return;
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') setZoomed(false);
    }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [zoomed]);

  return (
    <div className="zoomable">
      {children(onZoom)}
      {zoomed && (
        <div className="zoomable__overlay" onClick={(e) => { if (e.target === e.currentTarget) setZoomed(false); }}>
          <div className="zoomable__pane">
            <button className="zoomable__close" onClick={() => setZoomed(false)}><X size={16} /></button>
            {children(onZoom)}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Collapsible system prompt block ──

function SystemPromptBlock({ text }: { text: string }) {
  const [collapsed, setCollapsed] = useState(true);

  return (
    <div className={`system-prompt-block ${collapsed ? 'system-prompt-block--collapsed' : ''}`}>
      <div className="system-prompt-block__header" onClick={() => setCollapsed(!collapsed)}>
        <span className="system-prompt-block__toggle">{collapsed ? '\u25b6' : '\u25bc'}</span>
        <span className="system-prompt-block__label">System prompt</span>
        {collapsed && (
          <span className="system-prompt-block__preview">
            {text.slice(0, 120).replace(/\n/g, ' ')}{text.length > 120 ? '...' : ''}
          </span>
        )}
      </div>
      {!collapsed && (
        <div className="system-prompt-block__content"><Markdown>{text}</Markdown></div>
      )}
    </div>
  );
}

// ── Collapsible compaction block ──

function CompactionBlock({ msg }: { msg: MessageRecord }) {
  const [collapsed, setCollapsed] = useState(true);

  const { tokensBefore, messagesCompacted } = msg.compaction ?? {};

  // Extract summary text from the wrapped content
  const raw = typeof msg.content === 'string' ? msg.content : '';
  const summaryMatch = raw.match(/<compaction_summary>([\s\S]*?)<\/compaction_summary>/);
  const summaryText = summaryMatch ? summaryMatch[1].trim() : raw;

  const statParts: string[] = [];
  if (tokensBefore) statParts.push(`${tokensBefore.toLocaleString()} tokens`);
  if (messagesCompacted) statParts.push(`${messagesCompacted} messages`);
  const statLine = statParts.length > 0 ? statParts.join(', ') : '';

  return (
    <div className={`compaction-block ${collapsed ? 'compaction-block--collapsed' : ''}`}>
      <div className="compaction-block__header" onClick={() => setCollapsed(!collapsed)}>
        <Minimize2 size={11} className="compaction-block__icon" />
        <span className="compaction-block__label">Context compacted</span>
        {statLine && <span className="compaction-block__stats">{statLine}</span>}
        <span className="compaction-block__toggle">{collapsed ? '\u25b6' : '\u25bc'}</span>
      </div>
      {!collapsed && (
        <div className="compaction-block__content"><Markdown>{summaryText}</Markdown></div>
      )}
    </div>
  );
}

// ── Collapsible thinking block ──

function ThinkingBlock({ text, defaultCollapsed = true, showTokens = false }: { text: string; defaultCollapsed?: boolean; showTokens?: boolean }) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const contentRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);

  // Auto-collapse when defaultCollapsed changes (e.g., thinking done → output starts)
  useEffect(() => {
    if (defaultCollapsed) setCollapsed(true);
  }, [defaultCollapsed]);

  // Auto-scroll content to bottom as thinking streams in (same pattern as tool output)
  useEffect(() => {
    const el = contentRef.current;
    if (el && nearBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [text]);

  function handleContentScroll() {
    const el = contentRef.current;
    if (!el) return;
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
  }

  const charCount = text.length;
  const label = showTokens && charCount > 1000
    ? `Thinking (${Math.round(charCount / 4).toLocaleString()} tokens)`
    : 'Thinking';

  return (
    <div className={`thinking-block ${collapsed ? 'thinking-block--collapsed' : ''}`}>
      <div className="thinking-block__header" onClick={() => setCollapsed(!collapsed)}>
        <span className="thinking-block__toggle">{collapsed ? '\u25b6' : '\u25bc'}</span>
        <span className="thinking-block__label">{label}</span>
        {collapsed && (
          <span className="thinking-block__preview">
            {text.slice(0, 120).replace(/\n/g, ' ')}{text.length > 120 ? '...' : ''}
          </span>
        )}
      </div>
      {!collapsed && (
        <div className="thinking-block__content" ref={contentRef} onScroll={handleContentScroll}>
          <Markdown>{text}</Markdown>
        </div>
      )}
    </div>
  );
}

// ── Content block rendering ──

function ContentBlockView({ block, showMetadata, toolMeta }: { block: any; showMetadata?: boolean; toolMeta?: Record<string, any> }) {
  if (block.type === 'thinking') {
    return <ThinkingBlock text={block.thinking} showTokens={showMetadata} />;
  }
  if (block.type === 'text') {
    return <Markdown>{block.text}</Markdown>;
  }
  if (block.type === 'image' && block.source?.type === 'base64') {
    return (
      <Lightbox
        src={`data:${block.source.media_type};base64,${block.source.data}`}
        alt="Uploaded image"
        className="msg-tool-result__image"
      />
    );
  }
  if (block.type === 'image_gen' && block.result) {
    return (
      <Lightbox
        src={`data:${block.media_type || 'image/png'};base64,${block.result}`}
        alt="Generated image"
        className="msg-tool-result__image"
      />
    );
  }
  if (block.type === 'tool_use') {
    const { description, ...inputRest } = block.input ?? {};
    if (block.name === 'Edit' && inputRest.old_string != null && inputRest.new_string != null) {
      return (
        <ZoomableBlock>
          {(onZoom) => (
            <div className="msg-tool-use">
              <ToolHeader name={block.name} description={description} onZoom={onZoom} />
              <div className="msg-tool-use__input msg-tool-use__input--diff">
                <DiffView
                  filePath={inputRest.file_path ?? ''}
                  oldString={inputRest.old_string}
                  newString={inputRest.new_string}
                  replaceAll={inputRest.replace_all}
                  startLine={toolMeta?.[block.id]?.start_line}
                />
              </div>
            </div>
          )}
        </ZoomableBlock>
      );
    }
    if (block.name === 'Bash' && inputRest.command) {
      const { command, ...bashRest } = inputRest;
      const hasExtra = Object.keys(bashRest).length > 0;
      return (
        <ZoomableBlock>
          {(onZoom) => (
            <div className="msg-tool-use">
              <ToolHeader name={block.name} description={description} onZoom={onZoom} />
              <div className="msg-tool-use__cmd">
                <code>{command}</code>
              </div>
              {hasExtra && (
                <div className="msg-tool-use__input">
                  <JsonKV data={bashRest} />
                </div>
              )}
            </div>
          )}
        </ZoomableBlock>
      );
    }
    return (
      <ZoomableBlock>
        {(onZoom) => (
          <div className="msg-tool-use">
            <ToolHeader name={block.name} description={description} onZoom={onZoom} />
            <div className="msg-tool-use__input">
              <JsonKV data={inputRest} />
            </div>
          </div>
        )}
      </ZoomableBlock>
    );
  }
  if (block.type === 'tool_result') {
    const isError = block.is_error;
    return (
      <ZoomableBlock>
        {(onZoom) => (
          <div className={`msg-tool-result ${isError ? 'error' : ''}`}>
            <div className="msg-tool-result__header">
              <span>Result</span>
              {isError && <span className="msg-tool-result__error"> ERROR</span>}
              <button className="zoomable__btn" onClick={onZoom} title="Maximize">
                <Maximize2 size={12} />
              </button>
            </div>
            {typeof block.content === 'string' ? (
              <pre className="msg-tool-result__content">{block.content}</pre>
            ) : Array.isArray(block.content) ? (
              <div className="msg-tool-result__content">
                {block.content.map((sub: any, i: number) => {
                  if (sub.type === 'text') return <pre key={i} style={{ margin: 0 }}>{sub.text}</pre>;
                  if (sub.type === 'image' && sub.source?.type === 'base64') {
                    return (
                      <Lightbox
                        key={i}
                        src={`data:${sub.source.media_type};base64,${sub.source.data}`}
                        alt="Screenshot"
                        className="msg-tool-result__image"
                      />
                    );
                  }
                  return <pre key={i} style={{ margin: 0 }}>{JSON.stringify(sub, null, 2)}</pre>;
                })}
              </div>
            ) : (
              <pre className="msg-tool-result__content">{JSON.stringify(block.content, null, 2)}</pre>
            )}
          </div>
        )}
      </ZoomableBlock>
    );
  }
  // Fallback for unknown block types
  return <pre className="msg-raw">{JSON.stringify(block, null, 2)}</pre>;
}

function MessageContent({ content, role, showMetadata, toolMeta }: { content: unknown; role?: string; showMetadata?: boolean; toolMeta?: Record<string, any> }) {
  if (typeof content === 'string') {
    if (role === 'user') return <div style={{ whiteSpace: 'pre-wrap' }}>{content}</div>;
    return <Markdown>{content}</Markdown>;
  }
  if (Array.isArray(content)) {
    return (
      <>
        {content.map((block, i) => (
          <ContentBlockView key={i} block={block} showMetadata={showMetadata} toolMeta={toolMeta} />
        ))}
      </>
    );
  }
  return <pre className="msg-raw">{JSON.stringify(content, null, 2)}</pre>;
}

// ── Main message view ──

interface MessageViewProps {
  runId?: string;
  messages: MessageRecord[];
  streamingText?: string;
  streamingThinking?: string;
  streamingToolOutput?: string;
  isCompacting?: boolean;
  runStatus?: string;
  runError?: string | null;
  showMetadata?: boolean;
  onInspect?: (message: MessageRecord) => void;
  onDelete?: (message: MessageRecord) => void;
  children?: React.ReactNode;
}

export function MessageView({ runId, messages, streamingText, streamingThinking, streamingToolOutput, isCompacting, runStatus, runError, showMetadata, onInspect, onDelete, children }: MessageViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const toolOutputRef = useRef<HTMLPreElement>(null);
  const wasNearBottom = useRef(true);
  const toolOutputNearBottom = useRef(true);
  const scrollFrameRef = useRef<number | null>(null);
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);

  const syncPinnedState = useCallback(() => {
    const el = containerRef.current;
    if (!el) return true;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    wasNearBottom.current = nearBottom;
    setIsPinnedToBottom(prev => prev === nearBottom ? prev : nearBottom);
    return nearBottom;
  }, []);

  const scrollToPresent = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  const scheduleScrollToPresent = useCallback((behavior: ScrollBehavior = 'auto') => {
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollToPresent(behavior);
      scrollFrameRef.current = null;
    });
  }, [scrollToPresent]);

  useEffect(() => {
    return () => {
      if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
    };
  }, []);

  useEffect(() => {
    wasNearBottom.current = true;
    setIsPinnedToBottom(true);
    scheduleScrollToPresent('auto');
  }, [runId, scheduleScrollToPresent]);

  // After new messages or streaming text render, scroll to bottom if we were already near it
  useEffect(() => {
    if (wasNearBottom.current) {
      scheduleScrollToPresent('auto');
    }
  }, [messages, streamingText, streamingThinking, streamingToolOutput, showMetadata, isCompacting, runError, scheduleScrollToPresent]);

  // Auto-scroll the tool output <pre> to its bottom as new content streams in
  useEffect(() => {
    const el = toolOutputRef.current;
    if (el && toolOutputNearBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [streamingToolOutput]);

  // Reset tool output scroll tracking when a new stream starts
  useEffect(() => {
    if (streamingToolOutput) toolOutputNearBottom.current = true;
  }, [!streamingToolOutput]);

  // When the container is resized (e.g. textarea grows/shrinks), keep scroll at bottom
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (wasNearBottom.current) {
        scheduleScrollToPresent('auto');
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [scheduleScrollToPresent]);

  // On scroll, record whether we're near the bottom
  function handleScroll() {
    syncPinnedState();
  }

  // Build tool_use_id → metadata lookup from all user messages with toolMeta
  const allToolMeta = useMemo(() => {
    const map: Record<string, any> = {};
    for (const msg of messages) {
      if (msg.toolMeta) Object.assign(map, msg.toolMeta);
    }
    return map;
  }, [messages]);

  if (messages.length === 0) {
    const label = runStatus === 'running' ? 'Starting...' : 'No messages in this run';
    return <div className="empty-state">{label}</div>;
  }

  const isStreaming = !!(streamingText || streamingThinking);

  // Auto-collapse thinking when output text starts arriving
  const thinkingDone = !!streamingText;

  return (
    <div className={`message-list-shell${isPinnedToBottom ? '' : ' message-list-shell--detached'}`}>
      <div className="message-list" ref={containerRef} onScroll={handleScroll}>
        {messages.map(msg => {
          if (msg.role === 'system') {
            const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
            return (
              <div key={msg.id} className="message message--system">
                <div className="message__header">
                  <span className="message__role">system</span>
                </div>
                <div className="message__body">
                  <SystemPromptBlock text={text} />
                </div>
              </div>
            );
          }
          if (msg.role === 'compaction') {
            return (
              <div key={msg.id} className="message message--compaction">
                <CompactionBlock msg={msg} />
                {showMetadata && msg.usage && (
                  <div className="message__footer">
                    <UsageSummary usage={msg.usage} cost={msg.cost} />
                    {msg.model && <span className="message__model">{msg.model}</span>}
                  </div>
                )}
              </div>
            );
          }
          const isOptimistic = msg.id.startsWith('_optimistic_');
          return (
          <div key={msg.id} className={`message message--${msg.role}${isOptimistic ? ' message--optimistic' : ''}`}>
            <div className="message__header">
              <span className="message__role">{msg.role}</span>
              <span className="message__meta">
                {isOptimistic
                  ? <span className="message__pill message__pill--sending">sending</span>
                  : msg.stop_reason && <span className="message__pill message__pill--stop">{msg.stop_reason}</span>}
                {!isOptimistic && fmtSmartTime(new Date(msg.created_at))}
              </span>
              {!isOptimistic && <MessageMenu message={msg} onInspect={onInspect} onDelete={onDelete} />}
            </div>
            <div className="message__body">
              <MessageContent content={msg.content} role={msg.role} showMetadata={showMetadata} toolMeta={allToolMeta} />
            </div>
            {showMetadata && msg.usage && (
              <div className="message__footer">
                <UsageSummary usage={msg.usage} cost={msg.cost} />
                    {msg.model && <span className="message__model">{msg.model}</span>}
              </div>
            )}
          </div>
          );
        })}
        {isCompacting && (
          <div className="message message--compaction">
            <div className="compaction-block">
              <div className="compaction-block__header compaction-block__header--live">
                <Minimize2 size={11} className="compaction-block__icon" />
                <span className="compaction-block__label">Compacting context...</span>
              </div>
            </div>
          </div>
        )}
        {streamingToolOutput && (
          <div className="message message--user">
            <div className="message__header">
              <span className="message__role">user</span>
            </div>
            <div className="message__body">
              <div className="msg-tool-result">
                <div className="msg-tool-result__header">Result</div>
                <pre ref={toolOutputRef} className="msg-tool-result__content" onScroll={() => {
                  const el = toolOutputRef.current;
                  if (el) toolOutputNearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
                }}>{streamingToolOutput}</pre>
              </div>
            </div>
          </div>
        )}
        {isStreaming && (
          <div className="message message--assistant message--streaming">
            <div className="message__header">
              <span className="message__role">assistant</span>
              <span className="message__meta">
                <span className="message__pill message__pill--streaming">
                  {thinkingDone ? 'streaming' : 'thinking'}
                </span>
              </span>
            </div>
            <div className="message__body">
              {streamingThinking && (
                <ThinkingBlock text={streamingThinking} defaultCollapsed={thinkingDone} showTokens={showMetadata} />
              )}
              {streamingText && <Markdown>{streamingText}</Markdown>}
            </div>
          </div>
        )}
        {runError && !isStreaming && (
          <div className="run-error-block">
            <span className="run-error-block__icon">⚠</span>
            <span className="run-error-block__text">{runError}</span>
          </div>
        )}
        {children}
      </div>
      <div className={`message-list__return${isPinnedToBottom ? '' : ' message-list__return--visible'}`}>
        <div className="message-list__return-fade" />
        <button
          type="button"
          className="message-list__return-btn"
          onClick={() => {
            wasNearBottom.current = true;
            setIsPinnedToBottom(true);
            scrollToPresent('smooth');
          }}
        >
          <ArrowDown size={14} />
          <span>Back to Present</span>
        </button>
      </div>
    </div>
  );
}
