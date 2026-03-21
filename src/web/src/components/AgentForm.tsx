import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { api } from '../api';
import { ToolPicker } from './ToolPicker';
import { ModelPicker } from './ModelPicker';
import type { Agent } from '../types';

export type MountEntry = { host: string; container: string; readonly?: boolean };

export interface AgentFormData {
  name: string;
  system_prompt: string;
  tools: string[];
  cwd: string;
  model: string;
  docker_image: string;
  schedule: string;
  schedule_overlap: 'skip' | 'queue' | 'kill';
  schedule_mode: 'new' | 'continue';
  max_turns: number;
  timeout_ms: number;
  mounts: MountEntry[];
  resource_limits: {
    cpus: number;
    memory_gb: number;
    pids_limit: number;
  };
  parent_agent_id: string;
  propagate_children: boolean;
}

export interface AgentFormDraft {
  name: string;
  system_prompt: string;
  tools: string[];
  cwd: string;
  model: string;
  docker_image: string;
  schedule: string;
  schedule_overlap: 'skip' | 'queue' | 'kill';
  schedule_mode: 'new' | 'continue';
  max_turns: string;
  timeout_ms: string;
  mounts: MountEntry[];
  resource_limits: {
    cpus: string;
    memory_gb: string;
    pids_limit: string;
  };
  parent_agent_id: string;
  propagate_children: boolean;
}

interface AgentFormProps {
  /** Pre-fill from existing agent (edit mode) */
  initial?: Agent;
  /** In-memory draft for create mode */
  draft?: AgentFormDraft | null;
  /** All agents for the parent selector (create mode) */
  agents?: Agent[];
  onSubmit: (data: AgentFormData) => void;
  onCancel: () => void;
  onDraftChange?: (draft: AgentFormDraft) => void;
  submitLabel?: string;
}

/** Build breadcrumb path for an agent: "grandparent / parent / name" */
function agentPath(agent: Agent, all: Agent[]): string {
  const parts: string[] = [];
  let cur: Agent | undefined = agent;
  while (cur) {
    parts.unshift(cur.name);
    cur = cur.parent_agent_id ? all.find(a => a.id === cur!.parent_agent_id) : undefined;
  }
  return parts.join(' \u25B8 ');
}

/** Count all descendants of an agent recursively. */
function countDescendants(agentId: string, all: Agent[]): number {
  let count = 0;
  const stack = [agentId];
  while (stack.length > 0) {
    const parentId = stack.pop()!;
    for (const a of all) {
      if (a.parent_agent_id === parentId) {
        count++;
        stack.push(a.id);
      }
    }
  }
  return count;
}

export function AgentForm({ initial, draft, agents, onSubmit, onCancel, onDraftChange, submitLabel = 'Create' }: AgentFormProps) {
  const [name, setName] = useState(initial?.name ?? draft?.name ?? '');
  const [systemPrompt, setSystemPrompt] = useState(initial?.system_prompt ?? draft?.system_prompt ?? 'You are a helpful agent. Today\'s date is {{date}}.');
  const [selectedTools, setSelectedTools] = useState<Set<string>>(new Set(initial?.tools ?? draft?.tools ?? []));
  const [cwd, setCwd] = useState(initial?.cwd ?? draft?.cwd ?? '');
  const [model, setModel] = useState(initial?.model ?? draft?.model ?? '');
  const [dockerImage, setDockerImage] = useState(initial?.docker_image ?? draft?.docker_image ?? '');
  const [schedule, setSchedule] = useState(initial?.schedule ?? draft?.schedule ?? '');
  const [scheduleOverlap, setScheduleOverlap] = useState<'skip' | 'queue' | 'kill'>(initial?.schedule_overlap ?? draft?.schedule_overlap ?? 'skip');
  const [scheduleMode, setScheduleMode] = useState<'new' | 'continue'>(initial?.schedule_mode ?? draft?.schedule_mode ?? 'new');
  const [maxTurns, setMaxTurns] = useState<string>(initial ? String(initial.max_turns) : (draft?.max_turns ?? ''));
  const [timeoutMs, setTimeoutMs] = useState<string>(initial ? String(initial.timeout_ms / 1000) : (draft?.timeout_ms ?? ''));
  const [mounts, setMounts] = useState<MountEntry[]>(initial?.mounts ?? draft?.mounts ?? []);
  const [cpuLimit, setCpuLimit] = useState<string>(initial ? String(initial.resource_limits.cpus) : (draft?.resource_limits.cpus ?? ''));
  const [memoryGb, setMemoryGb] = useState<string>(initial ? String(initial.resource_limits.memory_gb) : (draft?.resource_limits.memory_gb ?? ''));
  const [pidsLimit, setPidsLimit] = useState<string>(initial ? String(initial.resource_limits.pids_limit) : (draft?.resource_limits.pids_limit ?? ''));
  const [parentAgentId, setParentAgentId] = useState(initial?.parent_agent_id ?? draft?.parent_agent_id ?? '');
  const [propagateChildren, setPropagateChildren] = useState(draft?.propagate_children ?? false);
  const [modelTouched, setModelTouched] = useState(false);
  const [defaults, setDefaults] = useState<{
    model: string;
    docker_image: string;
    max_turns: number;
    timeout_ms: number;
    allow_bind_mounts: boolean;
    resource_limits: { cpus: number; memory_gb: number; pids_limit: number };
  } | null>(null);
  const [allToolNames, setAllToolNames] = useState<string[]>([]);
  const [readonlyTools, setReadonlyTools] = useState<string[]>([]);

  useEffect(() => {
    api.listTools().then(res => {
      if (!initial && draft?.tools === undefined) {
        setSelectedTools(new Set(res.defaults.tools));
      }
      setDefaults({
        model: res.defaults.model,
        docker_image: res.defaults.docker_image,
        max_turns: res.defaults.max_turns,
        timeout_ms: res.defaults.timeout_ms,
        allow_bind_mounts: res.defaults.allow_bind_mounts,
        resource_limits: res.defaults.resource_limits ?? { cpus: 0, memory_gb: 0, pids_limit: 0 },
      });
      setAllToolNames(res.tools.map((t: { name: string }) => t.name));
      setReadonlyTools(res.defaults.readonly_tools);
    }).catch(() => {});
  }, [draft?.tools, initial]);

  useEffect(() => {
    if (!onDraftChange || initial) return;
    onDraftChange({
      name,
      system_prompt: systemPrompt,
      tools: [...selectedTools],
      cwd,
      model,
      docker_image: dockerImage,
      schedule,
      schedule_overlap: scheduleOverlap,
      schedule_mode: scheduleMode,
      max_turns: maxTurns,
      timeout_ms: timeoutMs,
      mounts,
      resource_limits: {
        cpus: cpuLimit,
        memory_gb: memoryGb,
        pids_limit: pidsLimit,
      },
      parent_agent_id: parentAgentId,
      propagate_children: propagateChildren,
    });
  }, [
    cpuLimit,
    cwd,
    dockerImage,
    initial,
    maxTurns,
    memoryGb,
    mounts,
    name,
    onDraftChange,
    parentAgentId,
    pidsLimit,
    propagateChildren,
    schedule,
    scheduleOverlap,
    selectedTools,
    systemPrompt,
    timeoutMs,
    model,
  ]);

  function validateMounts(): string | null {
    for (let i = 0; i < mounts.length; i++) {
      const m = mounts[i];
      if (!m.host && !m.container) continue; // empty row — will be stripped
      if (!m.host || !m.container) return `Bind mount row ${i + 1}: both host and container paths are required`;
      if (!m.host.startsWith('/')) return `Bind mount row ${i + 1}: host path must start with /`;
      if (!m.container.startsWith('/')) return `Bind mount row ${i + 1}: container path must start with /`;
    }
    return null;
  }

  function validateResourceLimits(): string | null {
    if (cpuLimit !== '') {
      const parsed = parseFloat(cpuLimit);
      if (!Number.isFinite(parsed) || parsed <= 0) return 'CPU limit must be a positive number';
    }
    if (memoryGb !== '') {
      const parsed = parseFloat(memoryGb);
      if (!Number.isFinite(parsed) || parsed <= 0) return 'Memory limit must be a positive number of GB';
    }
    if (pidsLimit !== '') {
      const parsed = parseInt(pidsLimit, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) return 'Process limit must be a positive number';
    }
    return null;
  }

  function handleSubmit() {
    if (!name || !systemPrompt) {
      alert('Name and system prompt are required');
      return;
    }

    const mountError = validateMounts();
    if (mountError) {
      alert(mountError);
      return;
    }

    if (defaults?.resource_limits) {
      const resourceError = validateResourceLimits();
      if (resourceError) {
        alert(resourceError);
        return;
      }
    }

    const resolvedMaxTurns = maxTurns !== '' ? parseInt(maxTurns, 10) : (defaults?.max_turns ?? 0);
    const resolvedTimeoutS = timeoutMs !== '' ? parseFloat(timeoutMs) : ((defaults?.timeout_ms ?? 300_000) / 1000);
    const resolvedResourceLimits = defaults?.resource_limits ? {
      cpus: cpuLimit !== '' ? parseFloat(cpuLimit) : defaults.resource_limits.cpus,
      memory_gb: memoryGb !== '' ? parseFloat(memoryGb) : defaults.resource_limits.memory_gb,
      pids_limit: pidsLimit !== '' ? parseInt(pidsLimit, 10) : defaults.resource_limits.pids_limit,
    } : undefined;

    onSubmit({
      name,
      system_prompt: systemPrompt,
      tools: [...selectedTools],
      cwd: cwd || '',
      model: model || '',
      docker_image: dockerImage || '',
      schedule: schedule || '',
      schedule_overlap: scheduleOverlap,
      schedule_mode: scheduleMode,
      max_turns: resolvedMaxTurns,
      timeout_ms: resolvedTimeoutS * 1000,
      mounts: mounts.filter(m => m.host && m.container),
      resource_limits: resolvedResourceLimits!,
      parent_agent_id: parentAgentId || '',
      propagate_children: propagateChildren,
    });
  }

  return (
    <>
      <label>Name</label>
      <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. code-reviewer" />

      {agents && agents.length > 0 && (
        <>
          <label>Parent Agent (optional)</label>
          <select value={parentAgentId} onChange={e => setParentAgentId(e.target.value)}>
            <option value="">None (top-level)</option>
            {agents
              .filter(a => a.id !== initial?.id)
              .map(a => (
                <option key={a.id} value={a.id}>{agentPath(a, agents)}</option>
              ))
            }
          </select>
        </>
      )}

      <label>System Prompt</label>
      <textarea value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} placeholder="You are a..." />

      <div className="label-with-actions">
        <label>Tools</label>
        <span className="label-actions">
          <button type="button" className="label-action-btn" onClick={() => setSelectedTools(new Set(allToolNames))}>All</button>
          <button type="button" className="label-action-btn" onClick={() => setSelectedTools(new Set(readonlyTools))}>Read-only</button>
          <button type="button" className="label-action-btn" onClick={() => setSelectedTools(new Set())}>None</button>
        </span>
      </div>
      <ToolPicker selected={selectedTools} onChange={setSelectedTools} />

      {/* cwd is always /workspace inside the container — no need to expose */}

      <label>Model (optional)</label>
      <ModelPicker value={model} onChange={v => { setModel(v); if (v !== (initial?.model ?? '')) setModelTouched(true); }} placeholder={defaults?.model} clearable={!initial} />
      {initial && agents && (() => {
        const n = countDescendants(initial.id, agents);
        return n > 0 && modelTouched ? (
          <label className="field-checkbox">
            <input type="checkbox" checked={propagateChildren} onChange={e => setPropagateChildren(e.target.checked)} />
            Apply to all {n} {n === 1 ? 'child' : 'children'} recursively
          </label>
        ) : null;
      })()}

      <label>Docker Image (optional)</label>
      <input type="text" value={dockerImage} onChange={e => setDockerImage(e.target.value)} placeholder={defaults?.docker_image ?? ''} />

      {defaults?.resource_limits && (
        <fieldset className="field-group">
          <legend>Resource Limits</legend>
          <div className="field-group__row">
            <div className="field-group__field">
              <label>CPU</label>
              <div className="input-with-unit">
                <input type="number" min="0.25" step="0.25" value={cpuLimit} onChange={e => setCpuLimit(e.target.value)} placeholder={String(defaults.resource_limits.cpus)} />
                <span>cores</span>
              </div>
            </div>
            <div className="field-group__field">
              <label>Memory</label>
              <div className="input-with-unit">
                <input type="number" min="1" step="1" value={memoryGb} onChange={e => setMemoryGb(e.target.value)} placeholder={String(defaults.resource_limits.memory_gb)} />
                <span>GB</span>
              </div>
            </div>
            <div className="field-group__field">
              <label>PIDs</label>
              <div className="input-with-unit">
                <input type="number" min="32" step="32" value={pidsLimit} onChange={e => setPidsLimit(e.target.value)} placeholder={String(defaults.resource_limits.pids_limit)} />
                <span>max</span>
              </div>
            </div>
          </div>
        </fieldset>
      )}

      {defaults?.allow_bind_mounts !== false && (
        <>
          <div className="label-with-actions">
            <label>Bind Mounts</label>
            <span className="label-actions">
              <button type="button" className="label-action-btn" onClick={() => setMounts([...mounts, { host: '', container: '', readonly: false }])}>+ Add</button>
            </span>
          </div>
          <div className="mounts-group">
            {mounts.length === 0 ? (
              <div className="field-hint">No host directories mounted</div>
            ) : (
              <table className="mounts-table">
                <thead className="mounts-table__head">
                  <tr>
                    <th>Host path</th>
                    <th>Container path</th>
                    <th>RO</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {mounts.map((m, i) => {
                    const hasContent = m.host || m.container;
                    const hostBad = hasContent && (!m.host || !m.host.startsWith('/'));
                    const containerBad = hasContent && (!m.container || !m.container.startsWith('/'));
                    return (
                    <tr key={i}>
                      <td>
                        <input
                          type="text"
                          className={hostBad ? 'mount-invalid' : ''}
                          value={m.host}
                          onChange={e => { const next = [...mounts]; next[i] = { ...m, host: e.target.value }; setMounts(next); }}
                          placeholder="/host/path"
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          className={containerBad ? 'mount-invalid' : ''}
                          value={m.container}
                          onChange={e => { const next = [...mounts]; next[i] = { ...m, container: e.target.value }; setMounts(next); }}
                          placeholder="/container/path"
                        />
                      </td>
                      <td>
                        <label className="mount-ro">
                          <input
                            type="checkbox"
                            checked={m.readonly ?? false}
                            onChange={e => { const next = [...mounts]; next[i] = { ...m, readonly: e.target.checked }; setMounts(next); }}
                          />
                        </label>
                      </td>
                      <td>
                        <button type="button" className="mount-delete" onClick={() => setMounts(mounts.filter((_, j) => j !== i))}>
                          <Trash2 />
                        </button>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      <fieldset className="field-group">
        <legend>Schedule</legend>
        <label>Cron Expression</label>
        <input
          type="text"
          value={schedule}
          onChange={e => setSchedule(e.target.value)}
          placeholder="e.g. every 5 minutes, daily at 9:00, */10 * * * *"
        />
        {schedule && (
          <div className="field-group__row">
            <div className="field-group__field">
              <label>If Already Running</label>
              <select value={scheduleOverlap} onChange={e => setScheduleOverlap(e.target.value as 'skip' | 'queue' | 'kill')}>
                <option value="skip">Skip (don't start new run)</option>
                <option value="queue">Queue (run after current finishes)</option>
                <option value="kill">Kill &amp; Restart (stop current, start new)</option>
              </select>
            </div>
            <div className="field-group__field">
              <label>Run Mode</label>
              <select value={scheduleMode} onChange={e => setScheduleMode(e.target.value as 'new' | 'continue')}>
                <option value="new">Start a new run each time</option>
                <option value="continue">Continue the last run</option>
              </select>
            </div>
          </div>
        )}
      </fieldset>

      <label>Max Turns</label>
      <input
        type="number"
        min="0"
        value={maxTurns}
        onChange={e => setMaxTurns(e.target.value)}
        placeholder={defaults ? String(defaults.max_turns) : '0'}
      />
      <div className="field-hint">0 = unlimited</div>

      <label>Timeout (seconds)</label>
      <input
        type="number"
        min="0"
        value={timeoutMs}
        onChange={e => setTimeoutMs(e.target.value)}
        placeholder={defaults ? String(defaults.timeout_ms / 1000) : '300'}
      />

      <div className="modal__actions">
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn primary" onClick={handleSubmit}>{submitLabel}</button>
      </div>
    </>
  );
}
