import type { DirListing } from './types';
import { getCsrfToken } from '../../api';

async function request<T>(path: string, opts: Omit<RequestInit, 'body'> & { body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  const csrf = getCsrfToken();
  if (csrf && opts.method && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(opts.method)) {
    headers['X-CSRF-Token'] = csrf;
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

export const fileApi = {
  listDir(agentId: string, dirPath: string): Promise<DirListing> {
    return request(`/api/agents/${agentId}/files?path=${encodeURIComponent(dirPath)}`);
  },

  readFile(agentId: string, filePath: string): Promise<{ path: string; content: string; size: number }> {
    return request(`/api/agents/${agentId}/files/read`, {
      method: 'POST',
      body: { path: filePath },
    });
  },

  writeFile(agentId: string, filePath: string, content: string): Promise<{ ok: boolean }> {
    return request(`/api/agents/${agentId}/files/write`, {
      method: 'POST',
      body: { path: filePath, content },
    });
  },
};
