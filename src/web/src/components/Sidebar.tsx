import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, LayoutDashboard, Plus } from 'lucide-react';
import type { Agent, Dashboard } from '../types';
import type { ChannelIndicatorMode } from '../hooks/usePreferences';
import { Logo } from './Logo';
import { StatusDot } from './StatusDot';
import { Countdown } from './Countdown';
import { TreeView, type TreeItem } from './TreeView';

interface SidebarProps {
  agents: Agent[];
  dashboards?: Dashboard[];
  selectedId: string | null;
  onCreateClick: () => void;
  onTriggerSchedule?: (agentId: string) => void;
  getIndicatorMode?: (channelKey: string) => ChannelIndicatorMode;
  getDashboardActivityState?: (dashboard: Dashboard, indicatorMode: ChannelIndicatorMode) => 'pulse' | 'static' | 'fade' | null;
  onToggleIndicator?: (channelKey: string) => void;
  onSelect?: () => void;
}

type SidebarTreeItem =
  | (TreeItem & { kind: 'agent'; agent: Agent })
  | (TreeItem & { kind: 'dashboard'; dashboard: Dashboard });

export function Sidebar({
  agents,
  dashboards = [],
  selectedId,
  onCreateClick,
  onTriggerSchedule,
  getIndicatorMode,
  getDashboardActivityState,
  onToggleIndicator,
  onSelect,
}: SidebarProps) {
  const navigate = useNavigate();

  const treeItems = useMemo<SidebarTreeItem[]>(() => [
    ...agents.map((agent) => ({
      id: `agent:${agent.id}`,
      parentId: agent.parent_agent_id ? `agent:${agent.parent_agent_id}` : null,
      kind: 'agent' as const,
      agent,
    })),
    ...dashboards.map((dashboard) => ({
      id: `dashboard:${dashboard.root_agent_id}:${dashboard.slug}`,
      parentId: `agent:${dashboard.root_agent_id}`,
      kind: 'dashboard' as const,
      dashboard,
    })),
  ], [agents, dashboards]);

  return (
    <div className="sidebar">
      <div className="sidebar__header">
        <Logo />
        <button className="btn primary" onClick={onCreateClick}><Plus size={14} /> New</button>
      </div>
      <TreeView
        items={treeItems}
        selectedId={selectedId}
        onSelect={(id) => {
          const item = treeItems.find((entry) => entry.id === id);
          if (!item) return;

          if (item.kind === 'dashboard') {
            navigate(`/agents/${item.dashboard.root_agent_id}/dashboards/${encodeURIComponent(item.dashboard.slug)}`);
          } else {
            navigate(`/agents/${item.agent.id}`);
          }
          onSelect?.();
        }}
        emptyMessage="No agents yet"
        renderIcon={(item) => {
          if (item.kind !== 'dashboard') {
            const indicatorMode = getIndicatorMode?.(`agent:${item.agent.id}`) ?? 'animated';
            return <StatusDot status={item.agent.status} indicatorMode={indicatorMode} />;
          }

          const indicatorMode = getIndicatorMode?.(`dashboard:${item.dashboard.root_agent_id}:${item.dashboard.slug}`) ?? 'animated';
          const activityState = getDashboardActivityState?.(item.dashboard, indicatorMode) ?? null;
          return (
            <span className="dashboard-item__icon-wrap">
              <span className="dashboard-item__icon" title="dashboard">
                <LayoutDashboard size={12} />
              </span>
              {activityState && (
                <span className={`dashboard-item__activity dashboard-item__activity--${activityState}`} />
              )}
            </span>
          );
        }}
        renderActions={(item) => {
          if (!getIndicatorMode || !onToggleIndicator) return null;
          const channelKey = item.kind === 'dashboard'
            ? `dashboard:${item.dashboard.root_agent_id}:${item.dashboard.slug}`
            : `agent:${item.agent.id}`;
          const isMuted = getIndicatorMode(channelKey) === 'muted';
          const IndicatorIcon = isMuted ? EyeOff : Eye;
          return (
            <button
              type="button"
              className="tree-indicator-btn"
              onClick={() => onToggleIndicator(channelKey)}
              title={isMuted ? 'Indicators muted for this channel. Click to follow the profile setting.' : 'Indicators follow the profile setting. Click to mute this channel.'}
            >
              <IndicatorIcon size={12} />
            </button>
          );
        }}
        renderLabel={(item) => item.kind === 'dashboard'
          ? <span className="dashboard-item__name">{item.dashboard.name}</span>
          : <span className="agent-item__name">{item.agent.name}</span>}
        renderSecondary={(item) => {
          if (item.kind === 'dashboard') {
            return <span className="dashboard-item__path">{item.dashboard.path}</span>;
          }

          const agent = item.agent;
          if (agent.schedule && agent.next_run && agent.status !== 'running') {
            const canTrigger = onTriggerSchedule && agent.status !== 'paused';
            return <Countdown targetDate={agent.next_run} schedule={agent.schedule} onClick={canTrigger ? (e) => { e?.stopPropagation(); onTriggerSchedule(agent.id); } : undefined} />;
          }
          return null;
        }}
      />
    </div>
  );
}
