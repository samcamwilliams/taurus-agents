import fs from 'node:fs';
import path from 'node:path';
import type { Daemon } from '../../daemon/daemon.js';
import { drivePath } from '../../core/config/index.js';
import { assertAccessToAgent } from '../auth/index.js';
import { error, json, route, type Route } from '../helpers.js';

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
  updated_at: string | null;
};

function getMimeType(filePath: string): string {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

function getLatestMtimeMs(rootPath: string): number | null {
  if (!fs.existsSync(rootPath)) return null;

  let latest: number | null = null;
  const stack = [rootPath];

  while (stack.length > 0) {
    const currentPath = stack.pop()!;

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

function listDashboardsFromDir(publicDir: string, rootAgentId: string): DashboardDescriptor[] {
  if (!fs.existsSync(publicDir)) return [];

  return fs.readdirSync(publicDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    .map((entry) => {
      const dashboardDir = path.join(publicDir, entry.name);
      const updatedAtMs = getLatestMtimeMs(dashboardDir);
      return {
        slug: entry.name,
        name: entry.name,
        path: `/shared/public/${entry.name}`,
        root_agent_id: rootAgentId,
        url: `/dashboards/${rootAgentId}/${encodeURIComponent(entry.name)}/`,
        updated_at: updatedAtMs != null ? new Date(updatedAtMs).toISOString() : null,
      };
    });
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

    {
      method: 'GET',
      pattern: /^\/dashboards\/(?<id>[^/]+)\/(?<name>[^/]+)(?<rest>\/.*)?$/,
      handler: async (ctx) => {
        // Public — agent UUID in URL is the unguessable secret.
        // Auth is not required; iframe sandbox blocks cookie/API access.
        const dashboardName = decodeSegment(ctx.params.name);
        if (!dashboardName) return error(ctx.res, 'Invalid dashboard name', 400);

        try {
          const { publicDir } = await getDashboardPublicDir(daemon, ctx.params.id);
          const dashboardDir = path.resolve(publicDir, dashboardName);
          if (!dashboardDir.startsWith(publicDir + path.sep) && dashboardDir !== publicDir) {
            return error(ctx.res, 'Forbidden', 403);
          }
          if (!fs.existsSync(dashboardDir) || !fs.statSync(dashboardDir).isDirectory()) {
            return error(ctx.res, 'Dashboard not found', 404);
          }

          const requestPath = ctx.params.rest && ctx.params.rest !== '/' ? ctx.params.rest.slice(1) : 'index.html';
          let targetPath = path.resolve(dashboardDir, requestPath);
          if (!targetPath.startsWith(dashboardDir + path.sep) && targetPath !== dashboardDir) {
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
          });
          ctx.res.end(fs.readFileSync(targetPath));
        } catch (err: any) {
          error(ctx.res, err.message, 500);
        }
      },
    },
  ];
}
