import { useState } from 'react';
import { api } from '../api';
import { AgentForm, type AgentFormData } from './AgentForm';
import { Countdown } from './Countdown';
import { Pencil, Trash2 } from 'lucide-react';
import type { Agent } from '../types';

interface AgentSettingsProps {
  agent: Agent;
  agents?: Agent[];
  onUpdated: () => void;
  onDelete?: () => void;
  showResourceLimits?: boolean;
}

export function AgentSettings({ agent, agents, onUpdated, onDelete, showResourceLimits = true }: AgentSettingsProps) {
  const [editing, setEditing] = useState(false);

  function formatMemoryGb(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
  }

  async function handleSubmit(data: AgentFormData) {
    try {
      await api.updateAgent(agent.id, {
        name: data.name,
        system_prompt: data.system_prompt,
        tools: data.tools,
        cwd: data.cwd,
        model: data.model || agent.model,
        docker_image: data.docker_image,
        schedule: data.schedule || null,
        schedule_overlap: data.schedule_overlap,
        schedule_mode: data.schedule_mode,
        max_turns: data.max_turns,
        timeout_ms: data.timeout_ms,
        mounts: data.mounts,
        resource_limits: data.resource_limits,
        ...(data.propagate_children ? { propagate_children: true } : {}),
      });
      setEditing(false);
      onUpdated();
    } catch (err: any) {
      alert(err.message);
    }
  }

  if (editing) {
    return (
      <div className="agent-settings">
        <div className="agent-settings__form">
          <AgentForm
            initial={agent}
            agents={agents}
            onSubmit={handleSubmit}
            onCancel={() => setEditing(false)}
            submitLabel="Save"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="agent-settings">
      <div className="agent-settings__header">
        <button className="btn" onClick={() => setEditing(true)}><Pencil size={13} /> Edit</button>
        {onDelete && <button className="btn btn--danger-subtle" onClick={onDelete}><Trash2 size={13} /> Delete</button>}
      </div>
      <div className="agent-settings__grid">
        <Row label="Name" value={agent.name} />
        {agent.parent_agent_id && (
          <Row label="Parent" value={agents?.find(a => a.id === agent.parent_agent_id)?.name ?? agent.parent_agent_id} />
        )}
        <Row label="Model" value={agent.model} />
        <Row label="Working Directory" value={agent.cwd} mono />
        <Row label="Docker Image" value={agent.docker_image} mono />
        {showResourceLimits && (
        <div className="agent-settings__row agent-settings__row--stack">
          <div className="agent-settings__label">Resource Limits</div>
          <div className="agent-settings__value">
            <div className="resource-grid resource-grid--summary">
              <div className="resource-card resource-card--summary">
                <div className="resource-card__eyebrow">CPU</div>
                <div className="resource-card__value">{agent.resource_limits.cpus} cores</div>
                <div className="resource-card__hint">Docker <code>--cpus</code></div>
              </div>
              <div className="resource-card resource-card--summary">
                <div className="resource-card__eyebrow">Memory</div>
                <div className="resource-card__value">{formatMemoryGb(agent.resource_limits.memory_gb)} GB</div>
                <div className="resource-card__hint">Docker <code>--memory</code></div>
              </div>
              <div className="resource-card resource-card--summary">
                <div className="resource-card__eyebrow">Processes</div>
                <div className="resource-card__value">{agent.resource_limits.pids_limit} PIDs</div>
                <div className="resource-card__hint">Docker <code>--pids-limit</code></div>
              </div>
            </div>
            <div className="agent-settings__note">Containers include an init process to reap orphaned children cleanly.</div>
          </div>
        </div>
        )}
        <Row label="Bind Mounts" value={
          agent.mounts?.length > 0
            ? agent.mounts.map(m => `${m.host} -> ${m.container}${m.readonly ? ' (ro)' : ''}`).join('\n')
            : 'None'
        } pre={agent.mounts?.length > 0} />
        <Row label="Tools" value={agent.tools.join(', ')} />
        <Row label="Schedule" value={agent.schedule ?? 'None'} />
        {agent.schedule && (
          <>
            <Row label="Overlap Policy" value={agent.schedule_overlap} />
            <Row label="Run Mode" value={agent.schedule_mode === 'continue' ? 'Continue last run' : 'Start new run'} />
            <Row label="Next Run" value={agent.next_run ? new Date(agent.next_run).toLocaleString() : 'N/A'}>
              {agent.next_run && agent.status !== 'running' && (
                <> <Countdown targetDate={agent.next_run} schedule={agent.schedule ?? undefined} /></>
              )}
            </Row>
          </>
        )}
        <Row label="Max Turns" value={String(agent.max_turns)} />
        <Row label="Timeout" value={`${agent.timeout_ms / 1000}s`} />
        <Row label="System Prompt" value={agent.system_prompt} pre />
      </div>
    </div>
  );
}

function Row({ label, value, mono, pre, children }: { label: string; value: string; mono?: boolean; pre?: boolean; children?: React.ReactNode }) {
  return (
    <div className="agent-settings__row">
      <div className="agent-settings__label">{label}</div>
      <div className={`agent-settings__value${mono ? ' mono' : ''}${pre ? ' pre' : ''}`}>{value}{children}</div>
    </div>
  );
}
