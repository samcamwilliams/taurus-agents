/**
 * Per-worker secret management.
 *
 * Worker processes receive per-user secrets via IPC and call setSecrets()
 * to populate a local override map. getSecret() checks overrides first,
 * then falls back to process.env filtered by an allowlist.
 *
 * This avoids spreading user secrets into process.env where they could
 * collide with system vars like AUTH_PASSWORD or NODE_ENV.
 */

const secretOverrides = new Map<string, string>();

/** Set per-user secret overrides (called by worker on IPC start). */
export function setSecrets(secrets: Record<string, string>): void {
  secretOverrides.clear();
  for (const [key, value] of Object.entries(secrets)) {
    if (value) secretOverrides.set(key, value);
  }
}

/** Check if the user has their own override for a key (via UserSecret, not env). */
export function hasSecretOverride(key: string): boolean {
  return secretOverrides.has(key);
}

/**
 * Env fallback allowlist — controls which process.env keys are accessible
 * to non-admin workers. null = allow all (admin / local mode).
 */
let allowedEnvFallback: Set<string> | null = null;

/** Set the env fallback allowlist. null = allow all (admin/local). */
export function setAllowedEnvFallback(keys: string[] | null): void {
  allowedEnvFallback = keys ? new Set(keys) : null;
}

/**
 * Read a secret — checks worker-local overrides (user's own keys) first,
 * then process.env filtered by the allowlist.
 *
 * In local mode or for admin users, allowedEnvFallback is null (allow all).
 * In production for non-admin users, only keys in the allowlist fall through.
 */
export function getSecret(key: string): string | undefined {
  const override = secretOverrides.get(key);
  if (override) return override;

  if (allowedEnvFallback === null || allowedEnvFallback.has(key)) {
    return process.env[key];
  }
  return undefined;
}
