/**
 * Budget enforcement for multi-tenant deployments.
 *
 * checkBudget() is called before each inference call via the agent loop's
 * beforeInference hook. It reads monthly spend fresh from DB every time
 * (not cached), so it catches resumes, concurrent runs, and mid-run exhaustion.
 *
 * Only enforced in production (NODE_ENV !== 'local'), for non-admin users
 * who are using shared server API keys (not BYOK).
 */

import { QueryTypes } from 'sequelize';
import { sequelize } from '../db/index.js';
import { hasSecretOverride } from './config/index.js';

export interface BudgetContext {
  userId: string;
  userRole: string;
  userMeta: Record<string, any> | null;
  /** Model string (e.g. 'anthropic/claude-sonnet-4-...') — provider extracted at check time. */
  model: string;
}

export class BudgetExceededError extends Error {
  constructor(public limit: number, public spent: number) {
    super(
      `Monthly budget of $${limit.toFixed(2)} exceeded ` +
      `($${spent.toFixed(2)} used this month). ` +
      `Add your own API key in Account Settings → API Keys to continue.`,
    );
    this.name = 'BudgetExceededError';
  }
}

/**
 * Check if the user has exceeded their monthly spending budget.
 * Throws BudgetExceededError if exceeded. No-ops if exempt.
 *
 * BYOK is checked dynamically: all providers follow the PROVIDER_API_KEY
 * convention, so we derive the env key from the model string and check
 * if the user has their own override set.
 */
export async function checkBudget(ctx: BudgetContext): Promise<void> {
  if (process.env.NODE_ENV === 'local') return;
  if (ctx.userRole === 'admin') return;
  if (ctx.userMeta?.budget_exempt) return;

  // BYOK check — derive env key from provider name convention
  const provider = ctx.model.split('/')[0];
  if (hasSecretOverride(`${provider.toUpperCase()}_API_KEY`)) return;

  const defaultBudget = parseFloat(process.env.TAURUS_DEFAULT_MONTHLY_BUDGET || '50');
  const monthlyLimit = ctx.userMeta?.monthly_budget_usd ?? defaultBudget;
  if (monthlyLimit <= 0) return;

  const monthlySpent = await getMonthlySpend(ctx.userId);
  if (monthlySpent >= monthlyLimit) {
    throw new BudgetExceededError(monthlyLimit, monthlySpent);
  }
}

/**
 * SUM of total_cost_usd for all runs by this user in the current calendar month (UTC).
 * Uses the composite index on Runs(agent_id, created_at) for performance.
 */
export async function getMonthlySpend(userId: string): Promise<number> {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [row] = await sequelize.query<{ total: number }>(
    `SELECT COALESCE(SUM(r.total_cost_usd), 0) AS total
     FROM "Runs" r
     JOIN "Agents" a ON a.id = r.agent_id
     WHERE a.user_id = :userId AND r.created_at >= :monthStart`,
    { replacements: { userId, monthStart: monthStart.toISOString() }, type: QueryTypes.SELECT },
  );

  return row?.total ?? 0;
}

/**
 * Parse TAURUS_SHARED_SECRETS env var into a list of key names.
 * Default: empty (share nothing). Used by daemon to determine which
 * server-side env keys are shared with non-admin users.
 */
export function parseSharedSecrets(): string[] {
  const env = process.env.TAURUS_SHARED_SECRETS;
  if (!env) return [];
  return env.split(',').map(s => s.trim()).filter(Boolean);
}
