import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Daemon } from '../daemon/daemon.js';
import type { Ctx } from './context.js';
import { error, type Route } from './helpers.js';
import { authenticate } from './auth/index.js';
import { DisplayableError } from '../core/errors.js';
import { authRoutes } from './routes/auth.js';
import { agentRoutes } from './routes/agents.js';
import { folderRoutes } from './routes/folders.js';
import { healthRoutes } from './routes/health.js';
import { toolRoutes } from './routes/tools.js';
import { fileRoutes } from './routes/files.js';
import { notificationRoutes } from './routes/notifications.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}

export function createServer(daemon: Daemon, port: number): http.Server {
  const routes: Route[] = [
    ...authRoutes(),
    ...folderRoutes(),
    ...agentRoutes(daemon),
    ...healthRoutes(),
    ...toolRoutes(),
    ...fileRoutes(daemon),
    ...notificationRoutes(daemon),
  ];

  const server = http.createServer(async (req, res) => {
    // CORS preflight — only allow same origin or configured CORS_ORIGIN
    if (req.method === 'OPTIONS') {
      const allowedOrigin = process.env.CORS_ORIGIN;
      if (allowedOrigin) {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': allowedOrigin,
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token',
          'Access-Control-Allow-Credentials': 'true',
        });
      } else {
        res.writeHead(204);
      }
      return res.end();
    }

    const url = new URL(req.url!, `http://localhost:${port}`);

    // Normalize trailing slash on API routes (e.g. /api/agents/ → /api/agents)
    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.slice(0, -1);
    }

    // Auth gate — check before routing (now async)
    const auth = await authenticate(req);
    if (!auth.ok) {
      error(res, auth.error, auth.status);
      return;
    }

    // Match API routes
    for (const r of routes) {
      if (req.method !== r.method) continue;
      const match = url.pathname.match(r.pattern);
      if (match) {
        const ctx: Ctx = { req, res, url, params: match.groups ?? {}, user: auth.user };
        try {
          await r.handler(ctx);
        } catch (err: any) {
          if (err instanceof DisplayableError) {
            console.error(`[${err.status}] ${err.message}`);
            if (!res.headersSent) error(res, err.message, err.status);
          } else {
            console.error('Internal error:', err);
            if (!res.headersSent) {
              const isDev = process.env.NODE_ENV !== 'production';
              error(res, isDev ? `Internal error: ${err.message}` : 'Internal error', 500);
            }
          }
        }
        return;
      }
    }

    // Serve static files from Vite build output
    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
      const webDist = path.join(__dirname, '..', 'web', 'dist');
      const filePath = path.join(webDist, url.pathname === '/' ? 'index.html' : url.pathname);

      // Prevent directory traversal
      if (!filePath.startsWith(webDist)) {
        error(res, 'Forbidden', 403);
        return;
      }

      try {
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          const content = fs.readFileSync(filePath);
          const headers: Record<string, string> = {
            'Content-Type': getMimeType(filePath),
          };
          if (url.pathname === '/sw.js' || url.pathname === '/manifest.webmanifest') {
            headers['Cache-Control'] = 'no-cache';
          }
          res.writeHead(200, headers);
          res.end(content);
          return;
        }
      } catch {}

      // SPA fallback — serve index.html for all unmatched routes
      try {
        const indexPath = path.join(webDist, 'index.html');
        const html = fs.readFileSync(indexPath, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
        return;
      } catch {
        error(res, 'Not found — run `npm run build:web` first', 404);
        return;
      }
    }

    error(res, 'Not found', 404);
  });

  return server;
}
