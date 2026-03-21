import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Agent, Dashboard, Run, MessageRecord } from '../types';
import { api } from '../api';
import { Sidebar } from '../components/Sidebar';
import { StatusDot } from '../components/StatusDot';
import { MessageView } from '../components/MessageView';
import { InputBar, type InputBarHandle } from '../components/InputBar';
import { CreateAgentModal } from '../components/CreateAgentModal';
import { AgentSettings } from '../components/AgentSettings';
import { FileBrowser, Terminal } from '../components/file-browser';
import { Countdown } from '../components/Countdown';
import { RunFooter, RunControls } from '../components/RunToolbar';
import { InspectModal } from '../components/InspectModal';
import { useToast, ToastContainer } from '../components/Toast';
import { TreeView, type TreeItem } from '../components/TreeView';
import { useTheme } from '../hooks/useTheme';
import { useConnectionStatus } from '../hooks/useConnectionStatus';
import { UserMenu } from '../components/UserMenu';
import { ThemePicker } from '../components/ThemePicker';
import { useIsMobile } from '../hooks/useIsMobile';
import { usePwaInstall } from '../hooks/usePwaInstall';
import { useAgentNotifications } from '../hooks/useAgentNotifications';
import { Play, RotateCw, Square, PlayCircle, RefreshCw, MessageSquare, FileCode, TerminalSquare, Settings, Clock, Menu, List, Bell, BellOff, ExternalLink, LayoutDashboard } from 'lucide-react';
import '../styles/components.scss';

type Tab = 'runs' | 'editor' | 'terminal' | 'settings';
const DASHBOARD_POLL_MS = 2_000;

function findRootAgentId(agents: Agent[], agentId: string | undefined): string | null {
  if (!agentId) return null;
  let currentId: string | null = agentId;
  const visited = new Set<string>();
  while (currentId) {
    const current = agents.find((agent) => agent.id === currentId);
    if (!current || !current.parent_agent_id || visited.has(current.id)) return currentId;
    visited.add(current.id);
    currentId = current.parent_agent_id;
  }
  return agentId;
}

function dashboardActivityKey(dashboard: Pick<Dashboard, 'root_agent_id' | 'slug'>): string {
  return `${dashboard.root_agent_id}:${dashboard.slug}`;
}

function formatRunDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();

  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  const isSameYear = date.getFullYear() === now.getFullYear();

  const timeStr = date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).replace(/\s?AM/g, 'am').replace(/\s?PM/g, 'pm');

  if (isToday) return timeStr;

  const SHOW_YESTERDAY = false;
  if (SHOW_YESTERDAY) {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday =
      date.getFullYear() === yesterday.getFullYear() &&
      date.getMonth() === yesterday.getMonth() &&
      date.getDate() === yesterday.getDate();
    if (isYesterday) return `yesterday, ${timeStr}`;
  }

  const monthDay = date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });

  if (isSameYear) return `${monthDay}, ${timeStr}`;

  return `${monthDay}, ${date.getFullYear()}, ${timeStr}`;
}

interface AgentsPageProps {
  authEnabled: boolean;
  username?: string | null;
  onLogout: () => void;
}

export function AgentsPage({ authEnabled, username, onLogout }: AgentsPageProps) {
  const { agentId, runId, dashboardName } = useParams();
  const navigate = useNavigate();

  const [agents, setAgents] = useState<Agent[]>([]);
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [dashboardsLoading, setDashboardsLoading] = useState(false);
  const [acknowledgedDashboardUpdates, setAcknowledgedDashboardUpdates] = useState<Record<string, number>>({});
  const [runs, setRuns] = useState<Run[]>([]);
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [streamingThinking, setStreamingThinking] = useState('');
  const [streamingToolOutput, setStreamingToolOutput] = useState('');
  const [isCompacting, setIsCompacting] = useState(false);
  const [runActivity, setRunActivity] = useState<Record<string, string>>({});
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showMetadata, setShowMetadata] = useState(false);
  const [inspectMessage, setInspectMessage] = useState<MessageRecord | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('runs');
  const [dashboardFrameKey, setDashboardFrameKey] = useState(0);
  // Lazy-mount: Terminal and FileBrowser trigger container startup on mount,
  // so only mount them once the user actually clicks their tab.
  const [mountedTabs, setMountedTabs] = useState<Set<Tab>>(new Set(['runs']));
  const [mobileAgentsOpen, setMobileAgentsOpen] = useState(false);
  const [mobileRunsOpen, setMobileRunsOpen] = useState(false);
  const [showThemePicker, setShowThemePicker] = useState(false);
  const [showResourceLimits, setShowResourceLimits] = useState(false);
  const mountedForAgent = useRef<string | null>(null);
  const { toasts, showToast, dismiss, pause, resume } = useToast();
  const { theme } = useTheme();
  const conn = useConnectionStatus();
  const isMobile = useIsMobile();
  const { canInstall, isInstalled, install, installLabel, installHelpText } = usePwaInstall();
  const notifications = useAgentNotifications(showToast);

  // Remember last selected run per agent so switching back restores it
  const lastRunByAgent = useRef<Record<string, string>>({});
  const inputBarRef = useRef<InputBarHandle>(null);

  // Refs so SSE callbacks see latest values without re-subscribing
  const agentIdRef = useRef(agentId);
  const runIdRef = useRef(runId);
  const messagesRef = useRef(messages);
  const streamingTextRef = useRef('');
  const streamingThinkingRef = useRef('');
  const streamingToolOutputRef = useRef('');
  const runStreamingRef = useRef<Record<string, string>>({});
  const dashboardNameRef = useRef(dashboardName);
  useEffect(() => { agentIdRef.current = agentId; }, [agentId]);
  useEffect(() => {
    runIdRef.current = runId;
    if (agentId && runId) lastRunByAgent.current[agentId] = runId;
  }, [agentId, runId]);
  useEffect(() => { dashboardNameRef.current = dashboardName; }, [dashboardName]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const setViewportHeight = () => {
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty('--app-height', `${Math.round(viewportHeight)}px`);
    };

    setViewportHeight();
    window.addEventListener('resize', setViewportHeight);
    window.addEventListener('orientationchange', setViewportHeight);
    window.visualViewport?.addEventListener('resize', setViewportHeight);

    return () => {
      window.removeEventListener('resize', setViewportHeight);
      window.removeEventListener('orientationchange', setViewportHeight);
      window.visualViewport?.removeEventListener('resize', setViewportHeight);
    };
  }, []);

  // ── Model context windows (fetched once) ──

  const modelContextRef = useRef<Record<string, number>>({});
  useEffect(() => {
    api.listModels().then(grouped => {
      const map: Record<string, number> = {};
      for (const models of Object.values(grouped)) {
        for (const m of models) map[m.id] = m.contextTokens;
      }
      modelContextRef.current = map;
    }).catch(() => {});
  }, []);

  // ── Load agents ──

  const loadAgents = useCallback(async () => {
    const list = await api.listAgents();
    setAgents(list);
  }, []);

  useEffect(() => {
    loadAgents();
    const interval = setInterval(loadAgents, 30_000);
    api.listTools().then(res => setShowResourceLimits(!!res.defaults?.resource_limits)).catch(() => {});
    return () => clearInterval(interval);
  }, [loadAgents]);

  // ── Poll dashboards from all root agents ──

  useEffect(() => {
    const rootAgents = agents.filter((agent) => !agent.parent_agent_id);
    if (rootAgents.length === 0) {
      setDashboards([]);
      setDashboardsLoading(false);
      return;
    }

    let stale = false;
    let refreshing = false;

    const refreshDashboards = async (showLoading = false) => {
      if (refreshing) return;
      refreshing = true;
      if (showLoading) setDashboardsLoading(true);
      try {
        const results = await Promise.all(
          rootAgents.map(async (rootAgent) => {
            try { return await api.listDashboards(rootAgent.id); } catch { return []; }
          }),
        );
        if (stale) return;
        setDashboards(results.flat().sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })));
      } finally {
        refreshing = false;
        if (showLoading && !stale) setDashboardsLoading(false);
      }
    };

    void refreshDashboards(true);
    const interval = window.setInterval(() => { void refreshDashboards(false); }, DASHBOARD_POLL_MS);
    return () => { stale = true; window.clearInterval(interval); };
  }, [agents]);

  // ── Load runs when agent changes + auto-select latest ──

  useEffect(() => {
    if (!agentId) {
      setRuns([]);
      setMessages([]);
      return;
    }
    const aid = agentId;
    api.listRuns(aid).then(loadedRuns => {
      if (agentIdRef.current !== aid) return; // stale response
      setRuns(loadedRuns);
      if (loadedRuns.length > 0 && !runIdRef.current && !dashboardNameRef.current) {
        const remembered = lastRunByAgent.current[aid];
        const targetId = remembered && loadedRuns.some(r => r.id === remembered) ? remembered : loadedRuns[0].id;
        navigate(`/agents/${aid}/runs/${targetId}`, { replace: true });
      }
    });
  }, [agentId, navigate]);

  // ── Load messages when run changes ──

  useEffect(() => {
    if (!agentId || !runId) {
      setMessages([]);
      return;
    }
    let stale = false;
    setMessages([]); // clear immediately so we don't show previous run's messages

    // Reset streaming state from previous run, restore accumulated text for the new run
    streamingThinkingRef.current = '';
    streamingToolOutputRef.current = '';
    setStreamingThinking('');
    setStreamingToolOutput('');
    setIsCompacting(false);
    if (runStreamingRef.current[runId]) {
      streamingTextRef.current = runStreamingRef.current[runId];
      setStreamingText(streamingTextRef.current);
    } else {
      streamingTextRef.current = '';
      setStreamingText('');
    }

    api.getRunMessages(agentId, runId).then(msgs => {
      if (!stale) setMessages(msgs);
    });
    return () => { stale = true; };
  }, [agentId, runId]);

  // ── Reset tab when agent changes ──

  // Reset mounted tabs synchronously when agent changes (ref updates before render)
  if (agentId !== mountedForAgent.current) {
    mountedForAgent.current = agentId ?? null;
    mountedTabs.clear();
    mountedTabs.add('runs');
  }

  useEffect(() => {
    setActiveTab('runs');
  }, [agentId]);

  useEffect(() => {
    if (!isMobile) {
      setMobileAgentsOpen(false);
      setMobileRunsOpen(false);
    }
  }, [isMobile]);

  useEffect(() => {
    setMobileAgentsOpen(false);
  }, [agentId]);

  useEffect(() => {
    setMobileRunsOpen(false);
  }, [runId, activeTab, agentId, dashboardName]);

  useEffect(() => {
    setDashboardFrameKey(0);
  }, [agentId, dashboardName]);

  function activateTab(tab: Tab) {
    setActiveTab(tab);
    setMountedTabs(prev => prev.has(tab) ? prev : new Set(prev).add(tab));
  }

  // ── Optimistic user message helper ──

  function appendOptimisticUserMessage(text: string, images?: import('../components/InputBar').ImageAttachment[]) {
    // If the assistant is streaming, clear it — the current turn will be interrupted by the inject,
    // so the streaming content will reappear as a saved message via fetchNewMessages.
    // This prevents the optimistic user message from rendering above the streaming block.
    if (streamingTextRef.current || streamingThinkingRef.current) {
      streamingTextRef.current = '';
      streamingThinkingRef.current = '';
      streamingToolOutputRef.current = '';
      setStreamingText('');
      setStreamingThinking('');
      setStreamingToolOutput('');
    }

    let content: string | any[] = text;
    if (images && images.length > 0) {
      content = [
        { type: 'text', text },
        ...images.map(img => ({
          type: 'image',
          source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
        })),
      ];
    }

    const optimistic: MessageRecord = {
      id: `_optimistic_${Date.now()}`,
      run_id: runIdRef.current ?? '',
      seq: Infinity,
      role: 'user',
      content,
      stop_reason: null,
      input_tokens: 0,
      output_tokens: 0,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimistic]);
  }

  // ── Incremental message fetch helper ──

  const fetchNewMessages = useCallback(async () => {
    const aid = agentIdRef.current;
    const rid = runIdRef.current;
    if (!aid || !rid) return;

    const currentMsgs = messagesRef.current;
    const realMsgs = currentMsgs.filter(m => !m.id.startsWith('_optimistic_'));
    const maxSeq = realMsgs.length > 0
      ? Math.max(...realMsgs.map(m => m.seq))
      : undefined;

    const newMsgs = await api.getRunMessages(aid, rid, maxSeq);
    if (newMsgs.length > 0) {
      setMessages(prev => {
        const settled = prev.filter(m => !m.id.startsWith('_optimistic_'));
        const existingIds = new Set(settled.map(m => m.id));
        const unique = newMsgs.filter(m => !existingIds.has(m.id));
        return unique.length > 0 ? [...settled, ...unique] : settled;
      });
    }
  }, []);

  // ── SSE: live updates when an agent is selected ──

  useEffect(() => {
    if (!agentId) return;

    streamingTextRef.current = '';
    streamingThinkingRef.current = '';
    streamingToolOutputRef.current = '';
    runStreamingRef.current = {};
    setStreamingText('');
    setStreamingThinking('');
    setStreamingToolOutput('');
    setIsCompacting(false);
    setRunActivity({});

    const es = new EventSource(`/api/agents/${agentId}/stream`);

    es.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        switch (data.type) {
          case 'streaming':
            // Restore in-progress streaming text from server buffer (late-joining client)
            if (data.text) runStreamingRef.current[data.runId] = data.text;
            if (data.runId === runIdRef.current) {
              if (data.text) {
                streamingTextRef.current = data.text;
                setStreamingText(data.text);
              }
              if (data.thinking) {
                streamingThinkingRef.current = data.thinking;
                setStreamingThinking(data.thinking);
              }
            }
            break;

          case 'agent_status':
            setAgents(prev => prev.map(a =>
              a.id === data.agentId ? { ...a, status: data.status } : a,
            ));
            break;

          case 'run_status':
            setRuns(prev => {
              const exists = prev.some(r => r.id === data.runId);
              if (!exists) {
                api.listRuns(agentIdRef.current!).then(setRuns);
                return prev;
              }
              return prev.map(r =>
                r.id === data.runId ? { ...r, status: data.status } : r,
              );
            });
            break;

          case 'run_complete':
            streamingTextRef.current = '';
            streamingThinkingRef.current = '';
            streamingToolOutputRef.current = '';
            setStreamingText('');
            setStreamingThinking('');
            setStreamingToolOutput('');
            setIsCompacting(false);
            fetchNewMessages();
            api.listRuns(agentIdRef.current!).then(setRuns);
            loadAgents();
            if (data.error) showToast(data.error);
            break;

          case 'agent_paused':
            setAgents(prev => prev.map(a =>
              a.id === data.agentId ? { ...a, status: 'paused' as const } : a,
            ));
            break;

          case 'agent_error':
            setAgents(prev => prev.map(a =>
              a.id === data.agentId ? { ...a, status: 'error' as const } : a,
            ));
            if (data.error) showToast(data.error);
            break;

          case 'tool_output':
            if (typeof data.text === 'string' && data.runId === runIdRef.current) {
              streamingToolOutputRef.current += (streamingToolOutputRef.current ? '\n' : '') + data.text;
              setStreamingToolOutput(streamingToolOutputRef.current);
            }
            break;

          case 'llm_thinking':
            if (typeof data.text === 'string' && data.runId === runIdRef.current) {
              streamingThinkingRef.current += data.text;
              setStreamingThinking(streamingThinkingRef.current);
            }
            break;

          case 'llm_text':
            if (typeof data.text === 'string') {
              // Accumulate per-run activity for tree secondary text
              runStreamingRef.current[data.runId] = (runStreamingRef.current[data.runId] ?? '') + data.text;
              // Selected run: feed message view
              if (data.runId === runIdRef.current) {
                streamingTextRef.current += data.text;
                setStreamingText(streamingTextRef.current);
              }
            }
            break;

          case 'log':
            if (data.event === 'context.compacting' && data.runId === runIdRef.current) {
              setIsCompacting(true);
            }
            if ((data.event === 'context.compacted' || data.event === 'context.compaction_failed') && data.runId === runIdRef.current) {
              setIsCompacting(false);
              if (data.event === 'context.compacted') fetchNewMessages();
            }
            if (data.event === 'message.saved') {
              // Snapshot accumulated text as run activity
              if (data.message === 'assistant' && runStreamingRef.current[data.runId]) {
                const text = runStreamingRef.current[data.runId];
                const firstLine = text.split('\n').find(l => l.trim()) ?? text.slice(0, 120);
                setRunActivity(prev => ({ ...prev, [data.runId]: firstLine.slice(0, 120) }));
              }
              delete runStreamingRef.current[data.runId];
              // Selected run: clear streaming and fetch persisted messages
              if (data.runId === runIdRef.current) {
                setIsCompacting(false);
                streamingTextRef.current = '';
                streamingThinkingRef.current = '';
                streamingToolOutputRef.current = '';
                setStreamingText('');
                setStreamingThinking('');
                setStreamingToolOutput('');
                fetchNewMessages();
              }
            }
            break;
        }
      } catch { /* ignore parse errors */ }
    };

    return () => es.close();
  }, [agentId, loadAgents, fetchNewMessages]);

  // ── Derived state ──

  const selectedAgent = agents.find(a => a.id === agentId) ?? null;
  const selectedRootAgentId = findRootAgentId(agents, agentId);
  const selectedRootAgent = agents.find((a) => a.id === selectedRootAgentId) ?? selectedAgent;
  const selectedDashboard = dashboardName
    ? dashboards.find((d) =>
      d.slug === dashboardName &&
      d.root_agent_id === (selectedRootAgentId ?? agentId),
    ) ?? null
    : null;
  const selectedRun = runs.find(r => r.id === runId) ?? null;
  const selectedTreeId = dashboardName
    ? `dashboard:${selectedDashboard?.root_agent_id ?? selectedRootAgentId ?? agentId}:${dashboardName}`
    : agentId
      ? `agent:${agentId}`
      : null;

  useEffect(() => {
    if (!selectedDashboard) return;
    const key = dashboardActivityKey(selectedDashboard);
    const acknowledgedAt = Math.max(
      Date.now(),
      selectedDashboard.updated_at ? Date.parse(selectedDashboard.updated_at) || 0 : 0,
    );
    setAcknowledgedDashboardUpdates((prev) => {
      if ((prev[key] ?? 0) >= acknowledgedAt) return prev;
      return { ...prev, [key]: acknowledgedAt };
    });
  }, [selectedDashboard?.root_agent_id, selectedDashboard?.slug]);

  // Adapt runs for TreeView
  const treeRuns: (Run & TreeItem)[] = runs.map(r => ({
    ...r,
    parentId: r.parent_run_id,
  }));

  // ── Actions ──

  function handleStartRun() {
    if (!agentId) return;
    navigate(`/agents/${agentId}/runs/new`);
    setActiveTab('runs');
  }

  async function handleContinueRun() {
    if (!agentId || runs.length === 0) return;
    try {
      const latestRunId = runs[0].id;
      await api.startRun(agentId, { run_id: latestRunId });
      await loadAgents();
      const updatedRuns = await api.listRuns(agentId);
      setRuns(updatedRuns);
      setActiveTab('runs');
      navigate(`/agents/${agentId}/runs/${latestRunId}`);
    } catch (err: any) {
      showToast(err.message);
    }
  }

  async function handleStopRun() {
    if (!agentId) return;
    try {
      await api.stopRun(agentId);
      await loadAgents();
      if (runId) {
        const msgs = await api.getRunMessages(agentId, runId);
        setMessages(msgs);
      }
    } catch (err: any) {
      showToast(err.message);
    }
  }

  async function handleStopSelectedRun() {
    if (!agentId || !runId) return;
    try {
      await api.stopSpecificRun(agentId, runId);
      await loadAgents();
      const msgs = await api.getRunMessages(agentId, runId);
      setMessages(msgs);
      const updatedRuns = await api.listRuns(agentId);
      setRuns(updatedRuns);
    } catch (err: any) {
      showToast(err.message);
    }
  }

  async function handleResume() {
    if (!agentId) return;
    const targetRunId = runId || runs[0]?.id;
    if (!targetRunId) return;
    try {
      await api.startRun(agentId, { run_id: targetRunId });
      await loadAgents();
    } catch (err: any) {
      showToast(err.message);
    }
  }

  async function handleDeleteMessage(msg: MessageRecord) {
    if (!agentId || !runId) return;
    if (!confirm('Delete this message?')) return;
    try {
      await api.deleteMessage(agentId, runId, msg.id);
      setMessages(prev => prev.filter(m => m.id !== msg.id));
    } catch (err: any) {
      showToast(err.message);
    }
  }

  async function handleTriggerSchedule(targetAgentId?: string) {
    const id = targetAgentId || agentId;
    if (!id) return;
    if (!confirm('Trigger scheduled run now?')) return;
    try {
      const { runId: newRunId } = await api.startRun(id, { trigger: 'schedule' });
      await loadAgents();
      const updatedRuns = await api.listRuns(id);
      setRuns(updatedRuns);
      setActiveTab('runs');
      navigate(`/agents/${id}/runs/${newRunId}`);
    } catch (err: any) {
      showToast(err.message);
    }
  }

  async function handleSend(message: string, images?: import('../components/InputBar').ImageAttachment[]) {
    if (!agentId || (!message.trim() && (!images || images.length === 0))) return;
    appendOptimisticUserMessage(message, images);
    const apiImages = images?.map(({ base64, mediaType }) => ({ base64, mediaType }));

    try {
      const targetRunId = runId === 'new' ? undefined : runId;
      const result = await api.sendMessage(agentId, message, apiImages, targetRunId);
      await loadAgents();
      const updatedRuns = await api.listRuns(agentId);
      setRuns(updatedRuns);
      setActiveTab('runs');
      navigate(`/agents/${agentId}/runs/${result.runId}`);
    } catch (err: any) {
      showToast(err.message);
    }
  }

  async function handleDelete() {
    if (!agentId || !confirm('Delete this agent?')) return;
    try {
      await api.deleteAgent(agentId);
      navigate('/');
      await loadAgents();
    } catch (err: any) {
      showToast(err.message);
    }
  }

  async function handleCreated(newId: string) {
    setShowCreateModal(false);
    setMobileAgentsOpen(false);
    await loadAgents();
    navigate(`/agents/${newId}`);
  }

  function handleSelectRun(id: string) {
    if (agentId) {
      setActiveTab('runs');
      setMobileRunsOpen(false);
      navigate(`/agents/${agentId}/runs/${id}`);
    }
  }

  // ── Helpers ──

  const isRunning = selectedAgent?.status === 'running';
  const isPaused = selectedAgent?.status === 'paused';
  const isStopped = !isRunning && !isPaused;
  const hasRuns = runs.length > 0;
  const drawerOpen = mobileAgentsOpen || mobileRunsOpen;
  const notificationTitle = !notifications.supported
    ? 'Notifications unavailable'
    : notifications.permission === 'denied'
      ? 'Notifications blocked in browser settings'
      : notifications.enabled
        ? 'Pause Taurus notifications'
        : 'Enable Taurus notifications';

  async function handleInstall() {
    const outcome = await install();
    if (outcome === 'accepted') {
      showToast('Taurus installed on this device.', 'info');
      return;
    }
    if (outcome === 'manual') {
      showToast('In Safari, tap Share and then Add to Home Screen.', 'info');
      return;
    }
    if (outcome === 'unavailable') {
      showToast(installHelpText, 'info');
    }
  }

  async function handleNotificationClick() {
    if (!notifications.supported) {
      showToast('This browser does not support notifications.', 'error');
      return;
    }
    if (notifications.enabled) {
      notifications.disable();
      return;
    }
    await notifications.enable();
  }

  const runsTree = (
    <TreeView
      items={treeRuns}
      selectedId={runId}
      onSelect={handleSelectRun}
      emptyMessage="No runs yet"
      renderIcon={(run) => {
        if (run.trigger !== 'schedule') {
          return <StatusDot status={run.status} />;
        }
        const color = run.status === 'running' ? 'var(--c-amber)'
          : run.status === 'error' ? 'var(--c-red)'
          : run.status === 'completed' ? 'var(--c-green)'
          : run.status === 'paused' ? 'var(--c-yellow)'
          : 'var(--c-muted)';
        return (
          <span className={`run-trigger-icon${run.status === 'running' ? ' run-trigger-icon--running' : ''}`} title="scheduled">
            <Clock size={11} color={color} />
          </span>
        );
      }}
      renderLabel={(run) => (
        <span style={{ fontSize: 12 }}>
          {formatRunDate(run.created_at)}
        </span>
      )}
      renderSecondary={(run) => {
        if (run.run_error) return <span style={{ color: 'var(--c-red)' }}>{run.run_error}</span>;
        if (run.run_summary) return <span>{run.run_summary.slice(0, 80)}</span>;
        const activity = runActivity[run.id];
        if (activity) return <span>{activity.slice(0, 80)}</span>;
        if (run.status === 'running') return <span style={{ color: 'var(--c-accent)' }}>Running...</span>;
        if (run.last_message) return <span>{run.last_message.text.slice(0, 80)}</span>;
        return null;
      }}
    />
  );

  // ── Render ──

  return (
    <div className={`app${isMobile ? ' app--mobile' : ''}`}>
      {isMobile ? (
        <>
          <div
            className={`app__backdrop${drawerOpen ? ' app__backdrop--open' : ''}`}
            onClick={() => {
              setMobileAgentsOpen(false);
              setMobileRunsOpen(false);
            }}
          />

          <aside className={`app-drawer app-drawer--agents${mobileAgentsOpen ? ' app-drawer--open' : ''}`}>
            <Sidebar
              agents={agents}
              dashboards={dashboards}
              acknowledgedDashboardUpdates={acknowledgedDashboardUpdates}
              selectedId={selectedTreeId}
              onCreateClick={() => {
                setShowCreateModal(true);
                setMobileAgentsOpen(false);
              }}
              onTriggerSchedule={handleTriggerSchedule}
              onSelect={() => setMobileAgentsOpen(false)}
            />
          </aside>

          <aside className={`app-drawer app-drawer--runs${mobileRunsOpen ? ' app-drawer--open' : ''}`}>
            <div className="runs-panel runs-panel--drawer">
              <div className="runs-panel__header">
                <span>Runs ({runs.filter(r => !r.parent_run_id).length})</span>
                <button className="btn btn--sm" onClick={() => setMobileRunsOpen(false)}>Close</button>
              </div>
              {runsTree}
            </div>
          </aside>
        </>
      ) : (
        <Sidebar
          agents={agents}
          dashboards={dashboards}
          acknowledgedDashboardUpdates={acknowledgedDashboardUpdates}
          selectedId={selectedTreeId}
          onCreateClick={() => setShowCreateModal(true)}
          onTriggerSchedule={handleTriggerSchedule}
        />
      )}

      <div className="main">
        {!selectedAgent ? (
          <>
            {authEnabled && (
              <div className="panel-header">
                <div className="panel-header__info" />
                <div className="panel-header__actions">
                  <UserMenu username={username} onLogout={onLogout} canInstall={canInstall && !isInstalled} onInstall={handleInstall} installLabel={installLabel} onChangeTheme={() => setShowThemePicker(true)} />
                </div>
              </div>
            )}
            <div className={`empty-state${isMobile ? ' empty-state--stacked' : ''}`}>
              {isMobile ? (
                <>
                  <p>Select or create an agent</p>
                  <div className="empty-state__actions">
                    <button className="btn" onClick={() => setMobileAgentsOpen(true)}><Menu size={13} /> Agents</button>
                    <button className="btn primary" onClick={() => setShowCreateModal(true)}>New Agent</button>
                  </div>
                </>
              ) : (
                'Select or create an agent'
              )}
            </div>
          </>
        ) : dashboardName ? (
          <>
            <div className="panel-header">
              <div className="panel-header__info">
                {isMobile && (
                  <button
                    className={`btn icon-btn${mobileAgentsOpen ? ' btn--active' : ''}`}
                    onClick={() => {
                      setMobileAgentsOpen(v => !v);
                      setMobileRunsOpen(false);
                    }}
                    title="Agents"
                  >
                    <Menu size={13} />
                  </button>
                )}
                <div className="panel-header__title">
                  <div className="panel-header__title-main">
                    <span className="dashboard-item__icon dashboard-item__icon--header">
                      <LayoutDashboard size={14} />
                    </span>
                    <h2>{selectedDashboard?.name ?? dashboardName}</h2>
                  </div>
                  <div className="panel-header__details">
                    <span className="panel-header__meta">{selectedRootAgent?.name ?? selectedAgent?.name}</span>
                    {selectedDashboard && <span className="panel-header__meta">{selectedDashboard.path}</span>}
                  </div>
                </div>
              </div>
              <div className="panel-header__actions">
                <div className="panel-header__action-row panel-header__action-row--utility">
                  {conn === 'disconnected' && <span className="conn-label">Reconnecting...</span>}
                  <button className="btn icon-btn" onClick={() => setDashboardFrameKey(key => key + 1)} title="Refresh dashboard">
                    <RefreshCw size={13} />
                  </button>
                  {selectedDashboard && (
                    <a className="btn icon-btn" href={selectedDashboard.url} target="_blank" rel="noreferrer" title="Open dashboard">
                      <ExternalLink size={13} />
                    </a>
                  )}
                  {authEnabled && <UserMenu username={username} onLogout={onLogout} canInstall={canInstall && !isInstalled} onInstall={handleInstall} installLabel={installLabel} onChangeTheme={() => setShowThemePicker(true)} />}
                </div>
              </div>
            </div>

            <div className="dashboard-view">
              {/* Sandboxed: scripts run but no access to parent, cookies, or APIs */}
              {selectedDashboard ? (
                <iframe
                  key={`${selectedDashboard.url}:${dashboardFrameKey}`}
                  className="dashboard-view__frame"
                  sandbox="allow-scripts"
                  src={selectedDashboard.url}
                  title={`Dashboard ${selectedDashboard.name}`}
                />
              ) : (
                <div className="empty-state">
                  {dashboardsLoading ? 'Loading dashboard...' : 'Dashboard not found'}
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            {/* Agent header */}
            <div className="panel-header">
              <div className="panel-header__info">
                {isMobile && (
                  <button
                    className={`btn icon-btn${mobileAgentsOpen ? ' btn--active' : ''}`}
                    onClick={() => {
                      setMobileAgentsOpen(v => !v);
                      setMobileRunsOpen(false);
                    }}
                    title="Agents"
                  >
                    <Menu size={13} />
                  </button>
                )}
                <div className="panel-header__title">
                  <div className="panel-header__title-main">
                    <StatusDot status={selectedAgent.status} />
                    <h2>{selectedAgent.name}</h2>
                  </div>
                  <div className="panel-header__details">
                    <span className="panel-header__meta">{selectedAgent.model}</span>
                    {selectedAgent.schedule && selectedAgent.next_run && !isRunning && (
                      <Countdown targetDate={selectedAgent.next_run} schedule={selectedAgent.schedule} onClick={isStopped ? () => handleTriggerSchedule() : undefined} />
                    )}
                  </div>
                </div>
              </div>
              <div className="panel-header__actions">
                <div className="panel-header__action-row panel-header__action-row--primary">
                  {isStopped && <button className="btn primary" onClick={handleStartRun}><Play size={13} /> {isMobile ? 'New' : 'New Run'}</button>}
                  {isStopped && runs.length > 0 && <button className="btn" onClick={handleContinueRun}><RotateCw size={13} /> Continue</button>}
                  {isRunning && <button className="btn" onClick={handleStopRun}><Square size={13} /> {isMobile ? 'Stop' : 'Stop All'}</button>}
                  {isPaused && <button className="btn" onClick={handleResume}><PlayCircle size={13} /> Resume</button>}
                  {isPaused && <button className="btn primary" onClick={handleStartRun}><Play size={13} /> {isMobile ? 'New' : 'New Run'}</button>}
                </div>
                <div className="panel-header__action-row panel-header__action-row--utility">
                  {conn === 'disconnected' && <span className="conn-label">Reconnecting...</span>}
                  {isMobile && activeTab === 'runs' && (
                    <button
                      className={`btn icon-btn${mobileRunsOpen ? ' btn--active' : ''}`}
                      onClick={() => {
                        setMobileRunsOpen(v => !v);
                        setMobileAgentsOpen(false);
                      }}
                      title={hasRuns ? 'Runs' : 'No runs yet'}
                      disabled={!hasRuns}
                    >
                      <List size={13} />
                    </button>
                  )}
                  {notifications.supported && (
                    <button
                      className={`btn icon-btn${notifications.enabled ? ' btn--active' : ''}`}
                      onClick={handleNotificationClick}
                      title={notificationTitle}
                    >
                      {notifications.enabled ? <Bell size={13} /> : <BellOff size={13} />}
                    </button>
                  )}
                  {authEnabled && <UserMenu username={username} onLogout={onLogout} canInstall={canInstall && !isInstalled} onInstall={handleInstall} installLabel={installLabel} onChangeTheme={() => setShowThemePicker(true)} />}
                </div>
              </div>
            </div>

            {/* Tab bar */}
            <div className="tab-bar">
              <button className={`tab-bar__tab ${activeTab === 'runs' ? 'tab-bar__tab--active' : ''}`} onClick={() => activateTab('runs')}>
                <MessageSquare size={13} /> Runs
              </button>
              <button className={`tab-bar__tab ${activeTab === 'editor' ? 'tab-bar__tab--active' : ''}`} onClick={() => activateTab('editor')}>
                <FileCode size={13} /> Editor
              </button>
              <button className={`tab-bar__tab ${activeTab === 'terminal' ? 'tab-bar__tab--active' : ''}`} onClick={() => activateTab('terminal')}>
                <TerminalSquare size={13} /> Terminal
              </button>
              <button className={`tab-bar__tab ${activeTab === 'settings' ? 'tab-bar__tab--active' : ''}`} onClick={() => activateTab('settings')}>
                <Settings size={13} /> Settings
              </button>
            </div>

            {/* Content — terminal and editor stay mounted (CSS hidden) to preserve state */}
            {activeTab === 'settings' && (
              <AgentSettings agent={selectedAgent} agents={agents} onUpdated={loadAgents} onDelete={handleDelete} showResourceLimits={showResourceLimits} />
            )}

            <div className="content-split" style={{ display: activeTab === 'runs' ? undefined : 'none' }}>
              {/* Runs tree */}
              <div className="runs-panel">
                <div className="runs-panel__header">
                  <span>Runs ({runs.filter(r => !r.parent_run_id).length})</span>
                </div>
                {runsTree}
              </div>

              {/* Messages */}
              <div className="messages-area">
                {selectedRun && (
                  <RunControls run={selectedRun} onResume={handleResume} onStop={handleStopSelectedRun} />
                )}
                {selectedRun ? (
                  <MessageView runId={selectedRun.id} messages={messages} streamingText={streamingText} streamingThinking={streamingThinking} streamingToolOutput={streamingToolOutput} isCompacting={isCompacting} runStatus={selectedRun.status} runError={selectedRun.run_error} showMetadata={showMetadata} onInspect={setInspectMessage} onDelete={handleDeleteMessage}>
                    <RunFooter
                      run={selectedRun}
                      messages={messages}
                      contextLimit={modelContextRef.current[selectedRun.model] ?? 0}
                      showMetadata={showMetadata}
                      onToggleMetadata={() => setShowMetadata(v => !v)}
                    />
                  </MessageView>
                ) : (
                  <div className="empty-state">Select a run or type a message to start a new one</div>
                )}
                <InputBar
                  ref={inputBarRef}
                  runId={runId}
                  defaultValue={runId === 'new' ? 'You have been manually triggered. Execute your task.' : undefined}
                  onSend={handleSend}
                />
              </div>
            </div>

            {mountedTabs.has('editor') && (
              <div style={{ display: activeTab === 'editor' ? 'flex' : 'none', flex: 1, overflow: 'hidden', minHeight: 0 }}>
                <FileBrowser agentId={selectedAgent.id} theme={theme} />
              </div>
            )}

            {mountedTabs.has('terminal') && (
              <div className="terminal-fullpane" style={{ display: activeTab === 'terminal' ? undefined : 'none' }}>
                <Terminal agentId={selectedAgent.id} focused={activeTab === 'terminal'} theme={theme} />
              </div>
            )}
          </>
        )}
      </div>

      <ToastContainer toasts={toasts} onDismiss={dismiss} onPause={pause} onResume={resume} />
      {showThemePicker && <ThemePicker onClose={() => setShowThemePicker(false)} />}

      {showCreateModal && (
        <CreateAgentModal
          agents={agents}
          onClose={() => setShowCreateModal(false)}
          onCreated={handleCreated}
        />
      )}

      {inspectMessage && (
        <InspectModal
          message={inspectMessage}
          onClose={() => setInspectMessage(null)}
        />
      )}
    </div>
  );
}
