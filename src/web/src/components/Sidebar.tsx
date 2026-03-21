import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutDashboard, Plus } from 'lucide-react';
import type { Agent, Dashboard } from '../types';
import { StatusDot } from './StatusDot';
import { Countdown } from './Countdown';
import { TreeView, type TreeItem } from './TreeView';

interface SidebarProps {
  agents: Agent[];
  dashboards?: Dashboard[];
  selectedId: string | null;
  onCreateClick: () => void;
  onTriggerSchedule?: (agentId: string) => void;
  onSelect?: () => void;
}

type SidebarTreeItem =
  | (TreeItem & { kind: 'agent'; agent: Agent })
  | (TreeItem & { kind: 'dashboard'; dashboard: Dashboard });

export function Sidebar({ agents, dashboards = [], selectedId, onCreateClick, onTriggerSchedule, onSelect }: SidebarProps) {
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
        <h1>Taurus</h1>
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
        renderIcon={(item) => item.kind === 'dashboard'
          ? (
            <span className="dashboard-item__icon" title="dashboard">
              <LayoutDashboard size={12} />
            </span>
          )
          : <StatusDot status={item.agent.status} />}
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
