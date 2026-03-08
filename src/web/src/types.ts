export type AgentStatus = 'idle' | 'running' | 'paused' | 'error' | 'disabled';

export interface Agent {
  id: string;
  folder_id: string;
  name: string;
  type: 'observer' | 'actor';
  status: AgentStatus;
  cwd: string;
  model: string;
  system_prompt: string;
  tools: string[];
  schedule: string | null;
  max_turns: number;
  timeout_ms: number;
  metadata: Record<string, unknown> | null;
  docker_image: string;
  created_at: string;
  updated_at: string;
}

export interface LogEntry {
  level: string;
  event: string;
  message: string;
  timestamp?: string;
  created_at?: string;
  data?: unknown;
}

export interface SSEEvent {
  type: string;
  [key: string]: unknown;
}
