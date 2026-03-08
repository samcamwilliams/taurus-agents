import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Agent, LogEntry as LogEntryType } from '../types';
import { api } from '../api';
import { Sidebar } from '../components/Sidebar';
import { StatusBadge } from '../components/StatusBadge';
import { LogEntry } from '../components/LogEntry';
import { StreamingText } from '../components/StreamingText';
import { InputBar } from '../components/InputBar';
import { CreateAgentModal } from '../components/CreateAgentModal';
import '../styles/components.scss';

type FeedItem =
  | { kind: 'log'; entry: LogEntryType }
  | { kind: 'stream'; text: string; done: boolean };

export function AgentsPage() {
  const { agentId } = useParams();
  const navigate = useNavigate();

  const [agents, setAgents] = useState<Agent[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const logAreaRef = useRef<HTMLDivElement>(null);
  const sseRef = useRef<EventSource | null>(null);
  const streamBufferRef = useRef('');

  // ── Load agents ──

  const loadAgents = useCallback(async () => {
    const list = await api.listAgents();
    setAgents(list);
  }, []);

  useEffect(() => {
    loadAgents();
    const interval = setInterval(loadAgents, 10_000);
    return () => clearInterval(interval);
  }, [loadAgents]);

  // ── SSE connection ──

  useEffect(() => {
    if (!agentId) return;

    setFeed([]);
    streamBufferRef.current = '';

    const sse = new EventSource(`/api/agents/${agentId}/stream`);
    sseRef.current = sse;

    sse.onmessage = (e) => {
      const data = JSON.parse(e.data);

      switch (data.type) {
        case 'init':
          if (data.agent) {
            setAgents(prev => prev.map(a => a.id === data.agent.id ? { ...a, ...data.agent } : a));
          }
          break;

        case 'history':
          if (data.logs) {
            const logs: FeedItem[] = [...data.logs]
              .reverse()
              .filter((l: LogEntryType) => l.level !== 'debug')
              .map((l: LogEntryType) => ({ kind: 'log' as const, entry: l }));
            setFeed(prev => [...logs, ...prev]);
          }
          break;

        case 'messages':
          if (data.messages) {
            const items: FeedItem[] = [];
            for (const m of data.messages) {
              if (m.role === 'assistant') {
                const text = extractAssistantText(m.content);
                if (text) items.push({ kind: 'stream', text, done: true });
              }
            }
            setFeed(prev => [...prev, ...items]);
          }
          break;

        case 'llm_text':
          streamBufferRef.current += data.text;
          setFeed(prev => {
            const last = prev[prev.length - 1];
            if (last?.kind === 'stream' && !last.done) {
              return [...prev.slice(0, -1), { kind: 'stream', text: streamBufferRef.current, done: false }];
            }
            return [...prev, { kind: 'stream', text: streamBufferRef.current, done: false }];
          });
          break;

        case 'log':
          if (data.level !== 'debug') {
            // Finalize any open stream
            finalizeStream();
            setFeed(prev => [...prev, { kind: 'log', entry: data }]);
          }
          break;

        case 'agent_status':
          setAgents(prev => prev.map(a => a.id === agentId ? { ...a, status: data.status } : a));
          break;

        case 'agent_paused':
          finalizeStream();
          setFeed(prev => [...prev, {
            kind: 'log',
            entry: { level: 'warn', event: 'paused', message: data.reason, timestamp: data.timestamp },
          }]);
          setAgents(prev => prev.map(a => a.id === agentId ? { ...a, status: 'paused' } : a));
          break;

        case 'run_complete':
          finalizeStream();
          setFeed(prev => [...prev, {
            kind: 'log',
            entry: { level: 'info', event: 'run.complete', message: data.summary || 'Run finished', timestamp: data.timestamp },
          }]);
          loadAgents();
          break;

        case 'agent_error':
          setFeed(prev => [...prev, {
            kind: 'log',
            entry: { level: 'error', event: 'error', message: data.error, timestamp: data.timestamp },
          }]);
          setAgents(prev => prev.map(a => a.id === agentId ? { ...a, status: 'error' } : a));
          break;
      }
    };

    sse.onerror = () => {
      console.warn('SSE connection error, will retry...');
    };

    return () => {
      sse.close();
      sseRef.current = null;
    };
  }, [agentId, loadAgents]);

  // ── Auto-scroll ──

  useEffect(() => {
    if (logAreaRef.current) {
      logAreaRef.current.scrollTop = logAreaRef.current.scrollHeight;
    }
  }, [feed]);

  // ── Helpers ──

  function finalizeStream() {
    streamBufferRef.current = '';
    setFeed(prev => {
      const last = prev[prev.length - 1];
      if (last?.kind === 'stream' && !last.done) {
        return [...prev.slice(0, -1), { ...last, done: true }];
      }
      return prev;
    });
  }

  function extractAssistantText(content: unknown): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .filter((b: { type: string }) => b.type === 'text')
        .map((b: { text: string }) => b.text)
        .join('\n');
    }
    return '';
  }

  // ── Actions ──

  const selectedAgent = agents.find(a => a.id === agentId) ?? null;

  async function handleStartRun() {
    if (!agentId) return;
    await api.startRun(agentId);
    await loadAgents();
  }

  async function handleContinueRun() {
    if (!agentId) return;
    await api.startRun(agentId, { continue_run: true });
    await loadAgents();
  }

  async function handleStopRun() {
    if (!agentId) return;
    await api.stopRun(agentId);
    await loadAgents();
  }

  async function handleResume(message?: string) {
    if (!agentId) return;
    await api.resumeAgent(agentId, message || undefined);
    await loadAgents();
  }

  async function handleInject(message: string) {
    if (!agentId) return;

    if (selectedAgent?.status === 'paused') {
      await handleResume(message);
      return;
    }

    await api.injectMessage(agentId, message);
    setFeed(prev => [...prev, {
      kind: 'log',
      entry: { level: 'info', event: 'user.inject', message, timestamp: new Date().toISOString() },
    }]);
  }

  async function handleDelete() {
    if (!agentId || !confirm('Delete this agent?')) return;
    await api.deleteAgent(agentId);
    navigate('/');
    await loadAgents();
  }

  async function handleCreated(newId: string) {
    setShowCreateModal(false);
    await loadAgents();
    navigate(`/agents/${newId}`);
  }

  // ── Render ──

  const isRunning = selectedAgent?.status === 'running';
  const isPaused = selectedAgent?.status === 'paused';
  const isStopped = !isRunning && !isPaused;
  const hasHistory = feed.length > 0;

  return (
    <div className="app">
      <Sidebar
        agents={agents}
        selectedId={agentId ?? null}
        onCreateClick={() => setShowCreateModal(true)}
      />

      <div className="main">
        {!selectedAgent ? (
          <div className="empty-state">Select or create an agent</div>
        ) : (
          <>
            <div className="panel-header">
              <div className="panel-header__info">
                <h2>{selectedAgent.name}</h2>
                <StatusBadge status={selectedAgent.status} />
                <span className="panel-header__meta">{selectedAgent.type} | {selectedAgent.model}</span>
              </div>
              <div className="panel-header__actions">
                {isStopped && <button className="btn primary" onClick={handleStartRun}>Start Run</button>}
                {isStopped && hasHistory && <button className="btn" onClick={handleContinueRun}>Continue</button>}
                {isRunning && <button className="btn" onClick={handleStopRun}>Stop</button>}
                {isPaused && <button className="btn" onClick={() => handleResume()}>Resume</button>}
                <button className="btn danger" onClick={handleDelete}>Delete</button>
              </div>
            </div>

            <div className="log-area" ref={logAreaRef}>
              {feed.map((item, i) => {
                if (item.kind === 'log') {
                  return <LogEntry key={i} entry={item.entry} />;
                }
                return <StreamingText key={i} text={item.text} done={item.done} />;
              })}
            </div>

            <InputBar onSend={handleInject} />
          </>
        )}
      </div>

      {showCreateModal && (
        <CreateAgentModal
          onClose={() => setShowCreateModal(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
