import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import type { Agent } from '../types';
import { StatusDot } from './StatusDot';
import { Countdown } from './Countdown';
import { TreeView, type TreeItem } from './TreeView';

interface SidebarProps {
  agents: Agent[];
  selectedId: string | null;
  onCreateClick: () => void;
}

type AgentTreeItem = Agent & TreeItem;

export function Sidebar({ agents, selectedId, onCreateClick }: SidebarProps) {
  const navigate = useNavigate();

  const treeAgents: AgentTreeItem[] = agents.map(a => ({
    ...a,
    parentId: a.parent_agent_id,
  }));

  return (
    <div className="sidebar">
      <div className="sidebar__header">
        <h1>Taurus</h1>
        <button className="btn primary" onClick={onCreateClick}><Plus size={14} /> New</button>
      </div>
      <TreeView
        items={treeAgents}
        selectedId={selectedId}
        onSelect={(id) => navigate(`/agents/${id}`)}
        emptyMessage="No agents yet"
        renderIcon={(agent) => <StatusDot status={agent.status} />}
        renderLabel={(agent) => (
          <span className="agent-item__name">{agent.name}</span>
        )}
        renderSecondary={(agent) => {
          if (agent.schedule && agent.next_run && agent.status !== 'running') {
            return <Countdown targetDate={agent.next_run} schedule={agent.schedule} />;
          }
          return null;
        }}
      />
    </div>
  );
}
