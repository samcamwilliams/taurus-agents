/**
 * Auth routes — login, logout, status check, password change.
 */

import { route, json, error, parseBody, type Route } from '../helpers.js';
import {
  verifyUserCredentials,
  createSession,
  deleteSession,
  getSession,
  parseCookies,
  sessionCookieHeader,
  themeCookieHeader,
  clearSessionCookieHeader,
  checkLoginRateLimit,
  recordLoginFailure,
  clearLoginFailures,
} from '../auth/index.js';
import { DisplayableError, NotFoundError } from '../../core/errors.js';
import User from '../../db/models/User.js';
import UserSecret, { SECRET_KEYS } from '../../db/models/UserSecret.js';
import { getMonthlySpend } from '../../core/budget.js';
import { getExtensions } from '../../core/extensions.js';
import { capabilities } from '../../core/config/index.js';

const THEMES = new Set(['light', 'night', 'dark', 'vivid', 'catppuccin', 'vivid-catppuccin']);
const OUTPUT_STYLES = new Set(['compact', 'detailed']);
const CHANNEL_INDICATORS = new Set(['animated', 'static', 'muted']);
const DEFAULT_THEME = 'light';
const DEFAULT_OUTPUT_STYLE = 'compact';
const DEFAULT_CHANNEL_INDICATORS = 'animated';

function getUserTheme(meta: Record<string, any> | null | undefined): string {
  const theme = meta?.theme;
  return typeof theme === 'string' && THEMES.has(theme) ? theme : DEFAULT_THEME;
}

function getUserOutputStyle(meta: Record<string, any> | null | undefined): string {
  const outputStyle = meta?.output_style;
  return typeof outputStyle === 'string' && OUTPUT_STYLES.has(outputStyle) ? outputStyle : DEFAULT_OUTPUT_STYLE;
}

function getUserChannelIndicators(meta: Record<string, any> | null | undefined): string {
  const channelIndicators = meta?.channel_indicators;
  return typeof channelIndicators === 'string' && CHANNEL_INDICATORS.has(channelIndicators)
    ? channelIndicators
    : DEFAULT_CHANNEL_INDICATORS;
}

function getUserChannelIndicatorOverrides(
  meta: Record<string, any> | null | undefined,
  defaultMode = getUserChannelIndicators(meta),
): Record<string, 'animated' | 'static' | 'muted'> {
  const raw = meta?.channel_indicator_overrides;
  if (!raw || typeof raw !== 'object') return {};

  const normalized: Record<string, 'animated' | 'static' | 'muted'> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'string' || !CHANNEL_INDICATORS.has(value) || value === defaultMode) continue;
    normalized[key] = value as 'animated' | 'static' | 'muted';
  }
  return normalized;
}

function getUserPreferences(meta: Record<string, any> | null | undefined) {
  const output_style = getUserOutputStyle(meta);
  const channel_indicators = getUserChannelIndicators(meta);
  return {
    output_style,
    channel_indicators,
    channel_indicator_overrides: getUserChannelIndicatorOverrides(meta, channel_indicators),
  };
}

export function authRoutes(): Route[] {
  return [
    // Check auth status — always public
    route('GET', '/api/auth/check', async (ctx) => {
      const cookies = parseCookies(ctx.req);
      const sessionToken = cookies.taurus_session;
      if (!sessionToken) {
        return json(ctx.res, { authenticated: false, authEnabled: true });
      }

      const session = getSession(sessionToken);
      if (!session) {
        return json(ctx.res, { authenticated: false, authEnabled: true });
      }

      // Look up user for username/role
      const user = await User.findByPk(session.userId, { attributes: ['username', 'role', 'meta'] });
      const theme = getUserTheme(user?.meta);
      const preferences = getUserPreferences(user?.meta);
      ctx.res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': themeCookieHeader(theme),
      });
      ctx.res.end(JSON.stringify({
        authenticated: true,
        authEnabled: true,
        csrfToken: session.csrfToken,
        username: user?.username ?? null,
        role: user?.role ?? session.role,
        theme,
        preferences,
        // Cloud/enterprise feature flags — empty object in community edition.
        features: getExtensions().featureFlags(),
      }));
    }),

    // Login — accepts { username, password }
    route('POST', '/api/auth/login', async (ctx) => {
      // Rate limit by IP
      const ip = (ctx.req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
        || ctx.req.socket.remoteAddress
        || 'unknown';

      if (!checkLoginRateLimit(ip)) {
        return error(ctx.res, 'Too many login attempts — try again later', 429);
      }

      const body = await parseBody(ctx.req);
      const username = body.username;
      const password = body.password;

      if (!username || typeof username !== 'string') {
        return error(ctx.res, 'Username is required', 400);
      }
      if (!password || typeof password !== 'string') {
        return error(ctx.res, 'Password is required', 400);
      }

      const user = await verifyUserCredentials(username, password);
      if (!user) {
        recordLoginFailure(ip);
        return error(ctx.res, 'Invalid username or password', 401);
      }

      clearLoginFailures(ip);
      const session = createSession(user.id, user.role);
      const theme = getUserTheme(user.meta);
      const preferences = getUserPreferences(user.meta);

      ctx.res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': [sessionCookieHeader(session.token), themeCookieHeader(theme)],
      });
      ctx.res.end(JSON.stringify({
        ok: true,
        csrfToken: session.csrfToken,
        username: user.username,
        role: user.role,
        theme,
        preferences,
      }));
    }),

    // Logout
    route('POST', '/api/auth/logout', async (ctx) => {
      const cookies = parseCookies(ctx.req);
      const sessionToken = cookies.taurus_session;
      if (sessionToken) {
        deleteSession(sessionToken);
      }

      ctx.res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': clearSessionCookieHeader(),
      });
      ctx.res.end(JSON.stringify({ ok: true }));
    }),

    // Per-user preferences
    route('PUT', '/api/auth/preferences', async (ctx) => {
      const body = await parseBody(ctx.req);
      const { theme, output_style, channel_indicators, channel_indicator_overrides } = body ?? {};

      const user = await User.findByPk(ctx.user.id);
      if (!user) throw new NotFoundError('User not found');

      if (theme != null && (typeof theme !== 'string' || !THEMES.has(theme))) {
        throw new DisplayableError('A valid theme is required', 400);
      }
      if (output_style != null && (typeof output_style !== 'string' || !OUTPUT_STYLES.has(output_style))) {
        throw new DisplayableError('A valid output style is required', 400);
      }
      if (channel_indicators != null && (typeof channel_indicators !== 'string' || !CHANNEL_INDICATORS.has(channel_indicators))) {
        throw new DisplayableError('A valid channel indicator mode is required', 400);
      }
      if (channel_indicator_overrides != null && (!channel_indicator_overrides || typeof channel_indicator_overrides !== 'object' || Array.isArray(channel_indicator_overrides))) {
        throw new DisplayableError('channel_indicator_overrides must be an object', 400);
      }

      if (theme == null && output_style == null && channel_indicators == null && channel_indicator_overrides == null) {
        throw new DisplayableError('At least one preference is required', 400);
      }

      const nextMeta = { ...(user.meta ?? {}) } as Record<string, any>;
      if (theme != null) nextMeta.theme = theme;
      if (output_style != null) nextMeta.output_style = output_style;
      if (channel_indicators != null) nextMeta.channel_indicators = channel_indicators;

      const normalizedChannelIndicators = getUserChannelIndicators(nextMeta);
      if (channel_indicator_overrides != null) {
        const nextOverrides: Record<string, string> = {};
        for (const [key, value] of Object.entries(channel_indicator_overrides as Record<string, unknown>)) {
          if (typeof value !== 'string' || !CHANNEL_INDICATORS.has(value) || value === normalizedChannelIndicators) continue;
          nextOverrides[key] = value;
        }
        nextMeta.channel_indicator_overrides = nextOverrides;
      } else if (channel_indicators != null) {
        nextMeta.channel_indicator_overrides = getUserChannelIndicatorOverrides(nextMeta, normalizedChannelIndicators);
      }

      await user.update({
        meta: nextMeta,
      });

      const resolvedTheme = getUserTheme(nextMeta);
      const preferences = getUserPreferences(nextMeta);

      ctx.res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': themeCookieHeader(resolvedTheme),
      });
      ctx.res.end(JSON.stringify({ ok: true, theme: resolvedTheme, preferences }));
    }),

    // Self-service password change — rate-limited by user ID (unforgeable from session)
    route('PUT', '/api/auth/password', async (ctx) => {
      const rateLimitKey = `pw:${ctx.user.id}`;
      if (!checkLoginRateLimit(rateLimitKey)) {
        return error(ctx.res, 'Too many attempts — try again later', 429);
      }

      const body = await parseBody(ctx.req);
      const { current_password, new_password } = body;

      if (!current_password || !new_password) {
        throw new DisplayableError('current_password and new_password are required', 400);
      }
      if (typeof new_password !== 'string' || new_password.length < 6) {
        throw new DisplayableError('New password must be at least 6 characters', 400);
      }

      const user = await User.findByPk(ctx.user.id);
      if (!user) throw new NotFoundError('User not found');

      const valid = await user.verifyPassword(current_password);
      if (!valid) {
        recordLoginFailure(rateLimitKey);
        throw new DisplayableError('Current password is incorrect', 401);
      }

      clearLoginFailures(rateLimitKey);
      const hash = await User.hashPassword(new_password);
      await user.update({ password_hash: hash });

      json(ctx.res, { ok: true });
    }),

    // Get API keys (masked) — shows which keys are set
    route('GET', '/api/auth/keys', async (ctx) => {
      const secrets = await UserSecret.getForUser(ctx.user.id);
      const masked: Record<string, string | null> = {};
      for (const key of SECRET_KEYS) {
        const val = secrets[key];
        masked[key] = val ? `${val.slice(0, 4)}${'•'.repeat(Math.max(0, val.length - 4))}` : null;
      }
      json(ctx.res, { keys: masked });
    }),

    // Update API keys — { key: value, ... } (null/empty to clear)
    route('PUT', '/api/auth/keys', async (ctx) => {
      const body = await parseBody(ctx.req);
      if (!body || typeof body !== 'object') {
        throw new DisplayableError('Request body must be an object', 400);
      }
      await UserSecret.bulkSetForUser(ctx.user.id, body);
      json(ctx.res, { ok: true });
    }),

    // Usage / budget info for the current user
    route('GET', '/api/auth/usage', async (ctx) => {
      const user = await User.findByPk(ctx.user.id);
      const defaultBudget = parseFloat(process.env.TAURUS_DEFAULT_MONTHLY_BUDGET || '50');
      const monthlyLimit = user?.meta?.monthly_budget_usd ?? defaultBudget;
      const isExempt = ctx.user.role === 'admin' || !!user?.meta?.budget_exempt || !capabilities.budgetEnforcement;

      const monthlySpent = await getMonthlySpend(ctx.user.id);

      // Per-provider BYOK status
      const userSecrets = await UserSecret.getForUser(ctx.user.id);
      const hasOwnKeys: Record<string, boolean> = {};
      for (const provider of ['anthropic', 'openai', 'openrouter', 'xai', 'gemini', 'groq', 'together', 'fireworks']) {
        hasOwnKeys[provider] = !!userSecrets[`${provider.toUpperCase()}_API_KEY`];
      }

      json(ctx.res, {
        monthly_spent_usd: Math.round(monthlySpent * 100) / 100,
        monthly_limit_usd: monthlyLimit,
        is_exempt: isExempt,
        month: new Date().toISOString().slice(0, 7),
        has_own_keys: hasOwnKeys,
      });
    }),
  ];
}
