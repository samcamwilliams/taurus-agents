import fs from 'node:fs';
import type http from 'node:http';
import path from 'node:path';
import type { Daemon } from '../../daemon/daemon.js';
import { drivePath } from '../../core/config/index.js';
import User from '../../db/models/User.js';
import { assertAccessToAgent, getSession, parseCookies, verifyApiKey } from '../auth/index.js';
import type { AuthUser } from '../context.js';
import { error, json, parseBody, route, type Route } from '../helpers.js';

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css',
  '.gif': 'image/gif',
  '.html': 'text/html',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.map': 'application/json',
  '.mjs': 'application/javascript',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

type DashboardDescriptor = {
  slug: string;
  name: string;
  path: string;
  root_agent_id: string;
  url: string;
  public: DashboardVisibility;
  updated_at: string | null;
};

type DashboardVisibility = true | false | 'unlisted';

const DASHBOARD_META_FILE = '.taurus-dashboard.json';

function getMimeType(filePath: string): string {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

function getLatestMtimeMs(rootPath: string): number | null {
  if (!fs.existsSync(rootPath)) return null;

  let latest: number | null = null;
  const stack = [rootPath];

  while (stack.length > 0) {
    const currentPath = stack.pop()!;

    const name = path.basename(currentPath);
    if (name === DASHBOARD_META_FILE) continue;

    let stats: fs.Stats;
    try {
      stats = fs.statSync(currentPath);
    } catch {
      continue;
    }

    latest = latest == null ? stats.mtimeMs : Math.max(latest, stats.mtimeMs);

    if (!stats.isDirectory()) continue;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      stack.push(path.join(currentPath, entry.name));
    }
  }

  return latest;
}

function decodeSegment(segment: string | undefined): string | null {
  if (!segment) return null;

  let value: string;
  try {
    value = decodeURIComponent(segment);
  } catch {
    return null;
  }

  if (!value || value === '.' || value === '..') return null;
  if (value.includes('/') || value.includes('\\') || value.includes('\0')) return null;
  return value;
}

async function getDashboardPublicDir(daemon: Daemon, agentId: string): Promise<{
  publicDir: string;
  rootAgentId: string;
}> {
  const agent = await daemon.getAgent(agentId);
  if (!agent) throw new Error('Agent not found');

  const rootAgentId = daemon.findRootAgentId(agentId);
  const sharedDir = drivePath(agent.user_id, rootAgentId, 'shared');
  const publicDir = path.join(sharedDir, 'public');
  fs.mkdirSync(publicDir, { recursive: true });
  return { publicDir, rootAgentId };
}

function normalizeDashboardVisibility(value: unknown): DashboardVisibility {
  if (value === true || value === false || value === 'unlisted') return value;
  if (value === 'public') return true;
  if (value === 'private') return false;
  return 'unlisted';
}

function getDashboardMetaPath(dashboardDir: string): string {
  return path.join(dashboardDir, DASHBOARD_META_FILE);
}

function readDashboardVisibility(dashboardDir: string): DashboardVisibility {
  const metaPath = getDashboardMetaPath(dashboardDir);
  if (!fs.existsSync(metaPath)) return 'unlisted';

  try {
    const raw = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    if (raw && typeof raw === 'object') {
      if ('public' in raw) return normalizeDashboardVisibility((raw as any).public);
      if ('visibility' in raw) return normalizeDashboardVisibility((raw as any).visibility);
    }
  } catch {
    return 'unlisted';
  }

  return 'unlisted';
}

function writeDashboardVisibility(dashboardDir: string, visibility: DashboardVisibility): void {
  const metaPath = getDashboardMetaPath(dashboardDir);

  if (visibility === 'unlisted') {
    try { fs.unlinkSync(metaPath); } catch {}
    return;
  }

  fs.writeFileSync(metaPath, `${JSON.stringify({ public: visibility }, null, 2)}\n`, 'utf8');
}

function createDashboardDescriptor(dashboardDir: string, slug: string, rootAgentId: string): DashboardDescriptor {
  const updatedAtMs = getLatestMtimeMs(dashboardDir);
  return {
    slug,
    name: slug,
    path: `/shared/public/${slug}`,
    root_agent_id: rootAgentId,
    url: `/dashboards/${rootAgentId}/${encodeURIComponent(slug)}/`,
    public: readDashboardVisibility(dashboardDir),
    updated_at: updatedAtMs != null ? new Date(updatedAtMs).toISOString() : null,
  };
}

function listDashboardsFromDir(publicDir: string, rootAgentId: string): DashboardDescriptor[] {
  if (!fs.existsSync(publicDir)) return [];

  return fs.readdirSync(publicDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    .map((entry) => createDashboardDescriptor(path.join(publicDir, entry.name), entry.name, rootAgentId));
}

function isPathWithin(rootPath: string, targetPath: string): boolean {
  return targetPath === rootPath || targetPath.startsWith(rootPath + path.sep);
}

function isHiddenDashboardPath(requestPath: string): boolean {
  return requestPath.split('/').some((segment) => segment.startsWith('.'));
}

async function getDashboardViewer(req: http.IncomingMessage): Promise<AuthUser | null> {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);

    if (verifyApiKey(token)) {
      const admin = await User.findOne({ where: { role: 'admin' }, attributes: ['id', 'role'] });
      if (admin) return { id: admin.id, role: admin.role, isLoggedIn: true };
      return null;
    }

    const session = getSession(token);
    if (session) {
      return { id: session.userId, role: session.role, isLoggedIn: true };
    }
  }

  const sessionToken = parseCookies(req).taurus_session;
  if (!sessionToken) return null;

  const session = getSession(sessionToken);
  if (!session) return null;

  return { id: session.userId, role: session.role, isLoggedIn: true };
}

export function dashboardRoutes(daemon: Daemon): Route[] {
  return [
    route('GET', '/api/agents/:id/dashboards', async (ctx) => {
      await assertAccessToAgent(ctx.params.id, ctx.user);

      try {
        const { publicDir, rootAgentId } = await getDashboardPublicDir(daemon, ctx.params.id);
        json(ctx.res, listDashboardsFromDir(publicDir, rootAgentId));
      } catch (err: any) {
        error(ctx.res, err.message, 500);
      }
    }),

    route('PUT', '/api/agents/:id/dashboards/:name', async (ctx) => {
      await assertAccessToAgent(ctx.params.id, ctx.user);

      const dashboardName = decodeSegment(ctx.params.name);
      if (!dashboardName) return error(ctx.res, 'Invalid dashboard name', 400);

      try {
        const body = await parseBody(ctx.req);
        const visibility = normalizeDashboardVisibility(body?.public);
        const { publicDir, rootAgentId } = await getDashboardPublicDir(daemon, ctx.params.id);
        const dashboardDir = path.resolve(publicDir, dashboardName);
        if (!isPathWithin(publicDir, dashboardDir)) return error(ctx.res, 'Forbidden', 403);
        if (!fs.existsSync(dashboardDir) || !fs.statSync(dashboardDir).isDirectory()) {
          return error(ctx.res, 'Dashboard not found', 404);
        }

        writeDashboardVisibility(dashboardDir, visibility);
        json(ctx.res, createDashboardDescriptor(dashboardDir, dashboardName, rootAgentId));
      } catch (err: any) {
        error(ctx.res, err.message, 500);
      }
    }),

    {
      method: 'GET',
      pattern: /^\/dashboards\/(?<id>[^/]+)\/(?<name>[^/]+)(?<rest>\/.*)?$/,
      handler: async (ctx) => {
        const dashboardName = decodeSegment(ctx.params.name);
        if (!dashboardName) return error(ctx.res, 'Invalid dashboard name', 400);

        try {
          const { publicDir } = await getDashboardPublicDir(daemon, ctx.params.id);
          const dashboardDir = path.resolve(publicDir, dashboardName);
          if (!isPathWithin(publicDir, dashboardDir)) {
            return error(ctx.res, 'Forbidden', 403);
          }
          if (!fs.existsSync(dashboardDir) || !fs.statSync(dashboardDir).isDirectory()) {
            return error(ctx.res, 'Dashboard not found', 404);
          }

          const visibility = readDashboardVisibility(dashboardDir);
          if (visibility === false) {
            const viewer = await getDashboardViewer(ctx.req);
            if (!viewer) return error(ctx.res, 'Dashboard not found', 404);
            await assertAccessToAgent(ctx.params.id, viewer);
          }

          const requestPath = ctx.params.rest && ctx.params.rest !== '/' ? ctx.params.rest.slice(1) : 'index.html';
          if (isHiddenDashboardPath(requestPath)) {
            return error(ctx.res, 'Not found', 404);
          }
          let targetPath = path.resolve(dashboardDir, requestPath);
          if (!isPathWithin(dashboardDir, targetPath)) {
            return error(ctx.res, 'Forbidden', 403);
          }

          if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
            targetPath = path.join(targetPath, 'index.html');
          }

          if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
            if (!path.extname(requestPath)) {
              targetPath = path.join(dashboardDir, 'index.html');
            }
          }

          if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
            return error(ctx.res, 'Not found', 404);
          }

          ctx.res.writeHead(200, {
            'Content-Type': getMimeType(targetPath),
            'Cache-Control': 'no-cache',
            'X-Robots-Tag': visibility === true ? 'index, follow' : 'noindex, nofollow, noarchive',
          });
          ctx.res.end(fs.readFileSync(targetPath));
        } catch (err: any) {
          error(ctx.res, err.message, 500);
        }
      },
    },
  ];
}
