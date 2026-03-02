import { EventEmitter } from 'node:events';

/**
 * Typed event bus for inter-agent communication.
 * Thin wrapper for now — will grow as we add multi-agent features.
 */

export interface TaurusEvents {
  'agent:started': { agentId: string };
  'agent:stopped': { agentId: string };
  'agent:message': { agentId: string; message: string };
  'tool:executed': { agentId: string; toolName: string; durationMs: number };
}

class TaurusEventBus {
  private emitter = new EventEmitter();

  on<K extends keyof TaurusEvents>(event: K, listener: (data: TaurusEvents[K]) => void): void {
    this.emitter.on(event, listener);
  }

  off<K extends keyof TaurusEvents>(event: K, listener: (data: TaurusEvents[K]) => void): void {
    this.emitter.off(event, listener);
  }

  emit<K extends keyof TaurusEvents>(event: K, data: TaurusEvents[K]): void {
    this.emitter.emit(event, data);
  }
}

export const eventBus = new TaurusEventBus();
