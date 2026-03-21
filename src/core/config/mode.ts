/**
 * Environment modes and capability flags.
 *
 * TAURUS_ENV selects a deployment profile:
 *   - development  — local dev machine, everything loose
 *   - selfhosted   — your own server, like dev minus security risks
 *   - production   — managed multi-tenant, maximum lockdown
 *
 * Each capability has a 3-tier resolution:
 *   1. Explicit TAURUS_* env var  (highest priority)
 *   2. TAURUS_ENV profile default
 *   3. Hardcoded fallback         (lowest)
 *
 * Backwards compat: if TAURUS_ENV is unset, derived from NODE_ENV
 * (production → production, anything else → development).
 */

// ── Types ──

export type TaurusEnv = 'development' | 'selfhosted' | 'production';

type ProfileDefaults = Record<TaurusEnv, boolean>;

export interface Capabilities {
  budgetEnforcement: boolean;
  arbitraryBindMounts: boolean;
  resourceLimitsApi: boolean;
  verboseErrors: boolean;
  showDefaultPassword: boolean;
  shareAllSecrets: boolean;
}

// ── Pure resolver functions (exported for testing) ──

const VALID_ENVS = new Set<string>(['development', 'selfhosted', 'production']);

/** Resolve TAURUS_ENV from an env record. Throws on invalid value. */
export function resolveTaurusEnv(env: Record<string, string | undefined>): TaurusEnv {
  const explicit = env.TAURUS_ENV;
  if (explicit) {
    if (!VALID_ENVS.has(explicit)) {
      throw new Error(
        `TAURUS_ENV must be "development", "selfhosted", or "production", got "${explicit}"`,
      );
    }
    return explicit as TaurusEnv;
  }
  // Backwards compat: derive from NODE_ENV
  return env.NODE_ENV === 'production' ? 'production' : 'development';
}

/** Parse a string as a boolean. Returns undefined if not set. */
export function parseBoolEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  return !['0', 'false', 'no', 'off'].includes(value.toLowerCase());
}

/** Resolve a capability: explicit env var → profile default. */
function resolveCapability(envValue: string | undefined, mode: TaurusEnv, defaults: ProfileDefaults): boolean {
  const explicit = parseBoolEnv(envValue);
  if (explicit !== undefined) return explicit;
  return defaults[mode];
}

/** Build the full capabilities object from an env record. */
export function buildCapabilities(env: Record<string, string | undefined>): { mode: TaurusEnv; capabilities: Capabilities } {
  const mode = resolveTaurusEnv(env);
  return {
    mode,
    capabilities: {
      budgetEnforcement: resolveCapability(env.TAURUS_BUDGET_ENFORCEMENT, mode, {
        development: false, selfhosted: false, production: true,
      }),
      arbitraryBindMounts: resolveCapability(env.TAURUS_ALLOW_ARBITRARY_BIND_MOUNTS, mode, {
        development: true, selfhosted: true, production: false,
      }),
      resourceLimitsApi: resolveCapability(env.TAURUS_ALLOW_RESOURCE_LIMITS_API, mode, {
        development: true, selfhosted: true, production: false,
      }),
      verboseErrors: resolveCapability(env.TAURUS_VERBOSE_ERRORS, mode, {
        development: true, selfhosted: false, production: false,
      }),
      showDefaultPassword: mode === 'development',
      shareAllSecrets: resolveCapability(env.TAURUS_SHARE_ALL_SECRETS, mode, {
        development: true, selfhosted: true, production: false,
      }),
    },
  };
}

// ── Module-level singleton (resolved once at startup from process.env) ──

function initFromProcessEnv(): { mode: TaurusEnv; capabilities: Capabilities } {
  try {
    return buildCapabilities(process.env);
  } catch (err: any) {
    console.error(`Fatal: ${err.message}`);
    process.exit(1);
  }
}

const _resolved = initFromProcessEnv();

export const TAURUS_ENV: TaurusEnv = _resolved.mode;
export const capabilities: Capabilities = _resolved.capabilities;
