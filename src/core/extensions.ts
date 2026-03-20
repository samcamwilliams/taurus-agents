/**
 * Extension registry — the integration point for Taurus Cloud (or any overlay).
 *
 * In the open-source (community) edition, nothing registers — every hook is a no-op.
 * The cloud/enterprise edition calls registerExtensions() at startup to inject
 * billing, admin, registration, and other commercial features.
 *
 * The public repo NEVER imports from the private repo. The dependency is
 * one-directional: private → public.
 */

import type { Route } from '../server/helpers.js';
import type { Daemon } from '../daemon/daemon.js';
import type { TokenUsage } from './types.js';

// ── Extension interface ──

export interface TaurusExtensions {
  /** Additional API routes to mount (billing, admin, registration, etc.) */
  extraRoutes: (daemon: Daemon) => Route[];

  /** Lifecycle: called after daemon initializes (run cloud migrations, etc.) */
  onDaemonInit: (daemon: Daemon) => Promise<void>;

  /** Lifecycle: called after a run completes (usage metering, etc.) */
  onRunComplete: (agentId: string, runId: string, userId: string, model: string, usage: TokenUsage, costUsd: number) => Promise<void>;

  /** Feature flags exposed to the frontend via /api/auth/check */
  featureFlags: () => Record<string, boolean>;

  /**
   * Budget check — called before each inference call.
   * Return true to allow, false to block. Throwing an Error with a
   * user-facing message is also valid (it will surface in the run).
   *
   * Only called when the community edition's built-in budget check passes.
   * This is an ADDITIONAL gate, not a replacement.
   */
  checkBudget: (userId: string, model: string) => Promise<boolean>;
}

// ── Default no-op implementations (community edition) ──

const noop: TaurusExtensions = {
  extraRoutes: () => [],
  onDaemonInit: async () => {},
  onRunComplete: async () => {},
  featureFlags: () => ({}),
  checkBudget: async () => true,
};

let extensions: TaurusExtensions = { ...noop };

// ── Public API ──

/**
 * Register cloud/enterprise extensions. Called once at startup by the
 * overlay package (e.g. taurus-cloud). Merges with defaults so partial
 * registration is fine.
 */
export function registerExtensions(ext: Partial<TaurusExtensions>): void {
  extensions = { ...extensions, ...ext };
}

/** Get the current extensions. Used by hook points throughout the codebase. */
export function getExtensions(): Readonly<TaurusExtensions> {
  return extensions;
}
