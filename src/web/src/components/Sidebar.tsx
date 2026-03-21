import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutDashboard, Plus } from 'lucide-react';
import type { Agent, Dashboard } from '../types';
import { Logo } from './Logo';
import { StatusDot } from './StatusDot';
import { Countdown } from './Countdown';
import { TreeView, type TreeItem } from './TreeView';

interface SidebarProps {
  agents: Agent[];
  dashboards?: Dashboard[];
  acknowledgedDashboardUpdates?: Record<string, number>;
  selectedId: string | null;
  onCreateClick: () => void;
  onTriggerSchedule?: (agentId: string) => void;
  onSelect?: () => void;
}

type SidebarTreeItem =
  | (TreeItem & { kind: 'agent'; agent: Agent })
  | (TreeItem & { kind: 'dashboard'; dashboard: Dashboard });

const DASHBOARD_PING_MS = 3_000;
const DASHBOARD_RECENT_MS = 30_000;

function dashboardActivityKey(dashboard: Pick<Dashboard, 'root_agent_id' | 'slug'>): string {
  return `${dashboard.root_agent_id}:${dashboard.slug}`;
}

function getDashboardActivityState(
  dashboard: Dashboard,
  now: number,
  acknowledgedDashboardUpdates: Record<string, number>,
): 'fresh' | 'recent' | 'stale' | null {
  if (!dashboard.updated_at) return null;

  const updatedAtMs = Date.parse(dashboard.updated_at);
  if (!Number.isFinite(updatedAtMs)) return null;

  const acknowledgedAt = acknowledgedDashboardUpdates[dashboardActivityKey(dashboard)] ?? 0;
  if (updatedAtMs <= acknowledgedAt) return null;

  const ageMs = now - updatedAtMs;
  if (ageMs <= DASHBOARD_PING_MS) return 'fresh';
  if (ageMs <= DASHBOARD_RECENT_MS) return 'recent';
  return 'stale';
}

export function Sidebar({
  agents,
  dashboards = [],
  acknowledgedDashboardUpdates = {},
  selectedId,
  onCreateClick,
  onTriggerSchedule,
  onSelect,
}: SidebarProps) {
  const navigate = useNavigate();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (dashboards.length === 0) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [dashboards.length]);

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
            return <StatusDot status={item.agent.status} />;
          }

          const activityState = getDashboardActivityState(item.dashboard, now, acknowledgedDashboardUpdates);

          return (
            <span className="dashboard-item__icon-wrap" title="dashboard">
              <span className="dashboard-item__icon">
                <LayoutDashboard size={12} />
              </span>
              <span className={`dashboard-item__activity${activityState ? ` dashboard-item__activity--${activityState}` : ' dashboard-item__activity--off'}`} />
            </span>
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
