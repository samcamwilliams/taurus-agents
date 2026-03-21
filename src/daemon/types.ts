// ─── Agent Enums ───

export type AgentStatus = 'idle' | 'running' | 'paused' | 'error' | 'disabled';
export type TriggerType = 'schedule' | 'manual' | 'subrun' | 'delegate' | `signal:${string}`;
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type MessageAuthorMeta = {
  kind: 'agent';
  agentId: string;
  runId?: string;
  shortId: string;
  label: string;
};

export type MessageMeta = {
  author?: MessageAuthorMeta;
};

// ─── IPC: Parent → Child ───

export type IpcImage = { base64: string; mediaType: string };

export type ParentMessage =
  | { type: 'start'; agentId: string; runId: string; trigger: TriggerType; input?: string; resume?: boolean; images?: IpcImage[]; messageMeta?: MessageMeta; tools?: string[]; secrets?: Record<string, string>; sharedSecrets?: string[] | null; schedule?: string }
  | { type: 'stop'; reason: string }
  | { type: 'resume'; message?: string; messageMeta?: MessageMeta }
  | { type: 'inject'; message: string; images?: IpcImage[]; messageMeta?: MessageMeta }
  | { type: 'signal'; name: string; payload: unknown }
  | { type: 'subrun_result'; requestId: string; runId: string; summary: string; error?: string; hitMaxTurns?: boolean }
  | { type: 'message_result'; requestId: string; summary: string; runId?: string; error?: string }
  | { type: 'delegate_result'; requestId: string; summary: string; runId: string; error?: string; tokens?: { input: number; output: number; cost: number }; images?: IpcImage[]; hitMaxTurns?: boolean }
  | { type: 'supervisor_result'; requestId: string; result: unknown; error?: string }
  | { type: 'inspect_result'; requestId: string; result: unknown; error?: string }
  | { type: 'wait_result'; requestId: string; completed: Record<string, { summary: string; error?: string; hitMaxTurns?: boolean }>; pending: string[] };

// ─── IPC: Child → Parent (coordination only — no DB writes) ───

export type ChildMessage =
  | { type: 'ready' }
  | { type: 'log'; level: LogLevel; event: string; message: string; data?: unknown }
  | { type: 'status'; status: AgentStatus }
  | { type: 'paused'; reason: string }
  | { type: 'run_complete'; summary: string; error?: string;
      tokens: { input: number; output: number; cost: number };
      images?: IpcImage[]; hitMaxTurns?: boolean }
  | { type: 'signal_emit'; name: string; payload: unknown }
  | { type: 'subrun_request'; requestId: string; input: string; tools?: string[]; max_turns?: number; timeout_ms?: number; run_id?: string; background?: boolean }
  | { type: 'message_request'; requestId: string; message: string }
  | { type: 'delegate_request'; requestId: string; targetAgent: string; input: string; context?: string; run_id?: string; background?: boolean }
  | { type: 'supervisor_request'; requestId: string; action: string; params: Record<string, unknown> }
  | { type: 'inspect_request'; requestId: string; agent?: string; run_id?: string; brief?: boolean; limit?: number }
  | { type: 'wait_request'; requestId: string; run_ids?: string[]; timeout_ms?: number }
  | { type: 'error'; error: string; stack?: string };
