import type { Agent, Dashboard, Run, MessageRecord } from './types';
import type { Theme } from './hooks/useTheme';

// ── CSRF token management ──

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export function getCsrfToken(): string | null {
  return csrfToken;
}

// ── Request helper ──

async function request<T>(path: string, opts: Omit<RequestInit, 'body'> & { body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  // Attach CSRF token on mutation requests
  if (csrfToken && opts.method && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(opts.method)) {
    headers['X-CSRF-Token'] = csrfToken;
  }

  const res = await fetch(path, {
    headers,
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  listAgents(folder_id?: string): Promise<Agent[]> {
    const qs = folder_id ? `?folder_id=${folder_id}` : '';
    return request(`/api/agents${qs}`);
  },

  listDashboards(agentId: string): Promise<Dashboard[]> {
    return request(`/api/agents/${agentId}/dashboards`);
  },

  createAgent(data: {
    name: string;
    system_prompt: string;
    tools: string[];
    cwd?: string;
    model?: string;
    docker_image?: string;
    schedule?: string;
    schedule_overlap?: string;
    max_turns?: number;
    timeout_ms?: number;
    mounts?: { host: string; container: string; readonly?: boolean }[];
    resource_limits?: { cpus: number; memory_gb: number; pids_limit: number };
    parent_agent_id?: string;
  }): Promise<Agent & { error?: string }> {
    return request('/api/agents', { method: 'POST', body: data });
  },

  updateAgent(id: string, data: Partial<{
    name: string;
    system_prompt: string;
    tools: string[];
    cwd: string;
    model: string;
    docker_image: string;
    schedule: string | null;
    schedule_overlap: string;
    max_turns: number;
    timeout_ms: number;
    mounts: { host: string; container: string; readonly?: boolean }[];
    resource_limits: { cpus: number; memory_gb: number; pids_limit: number };
    propagate_children: boolean;
  }>): Promise<Agent> {
    return request(`/api/agents/${id}`, { method: 'PUT', body: data });
  },

  deleteAgent(id: string): Promise<{ ok: boolean }> {
    return request(`/api/agents/${id}`, { method: 'DELETE' });
  },

  startRun(agentId: string, opts?: { trigger?: string; input?: string; run_id?: string; images?: { base64: string; mediaType: string }[] }): Promise<{ runId: string }> {
    return request(`/api/agents/${agentId}/run`, {
      method: 'POST',
      body: { trigger: 'manual', ...opts },
    });
  },

  stopRun(agentId: string): Promise<{ ok: boolean }> {
    return request(`/api/agents/${agentId}/run`, { method: 'DELETE' });
  },

  stopSpecificRun(agentId: string, runId: string): Promise<{ ok: boolean }> {
    return request(`/api/agents/${agentId}/runs/${runId}`, { method: 'DELETE' });
  },

  sendMessage(agentId: string, message: string, images?: { base64: string; mediaType: string }[], runId?: string): Promise<{ runId: string }> {
    return request(`/api/agents/${agentId}/message`, {
      method: 'POST',
      body: { message, images, run_id: runId },
    });
  },

  listRuns(agentId: string): Promise<Run[]> {
    return request(`/api/agents/${agentId}/runs`);
  },

  getRunMessages(agentId: string, runId: string, afterSeq?: number): Promise<MessageRecord[]> {
    const qs = afterSeq != null ? `?after=${afterSeq}` : '';
    return request(`/api/agents/${agentId}/runs/${runId}/messages${qs}`);
  },

  deleteMessage(agentId: string, runId: string, messageId: string): Promise<{ ok: boolean }> {
    return request(`/api/agents/${agentId}/runs/${runId}/messages/${messageId}`, { method: 'DELETE' });
  },

  listTools(): Promise<{
    tools: { name: string; group: string; description: string }[];
    defaults: {
      model: string;
      docker_image: string;
      tools: string[];
      readonly_tools: string[];
      supervisor_tools: string[];
      max_turns: number;
      timeout_ms: number;
      allow_bind_mounts: boolean;
      resource_limits: { cpus: number; memory_gb: number; pids_limit: number };
    };
  }> {
    return request('/api/tools');
  },

  listModels(): Promise<Record<string, { id: string; title: string; description: string; contextTokens: number; maxOutputTokens: number; pricing?: { input: number; output: number } }[]>> {
    return request('/api/models');
  },

  getApiKeys(): Promise<{ keys: Record<string, string | null> }> {
    return request('/api/auth/keys');
  },

  updateApiKeys(keys: Record<string, string | null>): Promise<{ ok: boolean }> {
    return request('/api/auth/keys', { method: 'PUT', body: keys });
  },

  changePassword(current_password: string, new_password: string): Promise<{ ok: boolean }> {
    return request('/api/auth/password', { method: 'PUT', body: { current_password, new_password } });
  },

  updatePreferences(preferences: { theme: Theme }): Promise<{ ok: boolean; theme: Theme }> {
    return request('/api/auth/preferences', { method: 'PUT', body: preferences });
  },

  getUsage(): Promise<{
    monthly_spent_usd: number;
    monthly_limit_usd: number;
    is_exempt: boolean;
    month: string;
    has_own_keys: Record<string, boolean>;
  }> {
    return request('/api/auth/usage');
  },
};
