/**
 * File browser routes — list, read, write files inside agent containers.
 *
 * All paths are validated to prevent directory traversal.
 * Runs ad-hoc `docker exec` commands (not the agent's PersistentShell).
 */

import path from 'node:path';
import type { Daemon } from '../../daemon/daemon.js';
import { route, json, error, parseBody, type Route } from '../helpers.js';
import { assertAccessToAgent } from '../auth/index.js';

const MAX_FILE_SIZE = 1_000_000; // 1MB read limit

/** Resolve and validate path — must be absolute, no traversal. */
function safePath(userPath: string): string | null {
  if (!userPath.startsWith('/')) return null;
  const resolved = path.posix.normalize(userPath);
  return resolved;
}

export function fileRoutes(daemon: Daemon): Route[] {
  return [
    // List directory
    route('GET', '/api/agents/:id/files', async (ctx) => {
      await assertAccessToAgent(ctx.params.id, ctx.user);
      const url = new URL(ctx.req.url!, `http://localhost`);
      const rawPath = url.searchParams.get('path') || '/workspace';
      const dirPath = safePath(rawPath);
      if (!dirPath) return error(ctx.res, 'Invalid path', 400);

      try {
        const containerId = await daemon.ensureContainerForBrowsing(ctx.params.id);
        const output = await daemon.docker.execCommand(containerId, [
          'ls', '-1aF', '--group-directories-first', dirPath,
        ]);

        const entries = output.split('\n')
          .filter(line => line && line !== './' && line !== '../')
          .map(line => {
            if (line.endsWith('/')) return { name: line.slice(0, -1), type: 'dir' as const };
            if (line.endsWith('@')) return { name: line.slice(0, -1), type: 'symlink' as const };
            if (line.endsWith('*')) return { name: line.slice(0, -1), type: 'file' as const };
            return { name: line, type: 'file' as const };
          });

        json(ctx.res, { path: dirPath, entries });
      } catch (err: any) {
        error(ctx.res, err.message, 500);
      }
    }),

    // Read file
    route('POST', '/api/agents/:id/files/read', async (ctx) => {
      await assertAccessToAgent(ctx.params.id, ctx.user);
      const body = await parseBody(ctx.req);
      if (!body.path) return error(ctx.res, 'path is required');

      const filePath = safePath(body.path);
      if (!filePath) return error(ctx.res, 'Invalid path', 400);

      try {
        const containerId = await daemon.ensureContainerForBrowsing(ctx.params.id);

        // Check file size first
        const sizeStr = await daemon.docker.execCommand(containerId, [
          'stat', '-c', '%s', filePath,
        ]);
        const size = parseInt(sizeStr.trim(), 10);
        if (size > MAX_FILE_SIZE) {
          return error(ctx.res, `File too large (${(size / 1024).toFixed(0)}KB). Max ${MAX_FILE_SIZE / 1024}KB. Use the terminal instead.`, 400);
        }

        const content = await daemon.docker.execCommand(containerId, ['cat', filePath]);
        json(ctx.res, { path: filePath, content, size });
      } catch (err: any) {
        error(ctx.res, err.message, 500);
      }
    }),

    // Write file
    route('POST', '/api/agents/:id/files/write', async (ctx) => {
      await assertAccessToAgent(ctx.params.id, ctx.user);
      const body = await parseBody(ctx.req);
      if (!body.path) return error(ctx.res, 'path is required');
      if (body.content == null) return error(ctx.res, 'content is required');

      const filePath = safePath(body.path);
      if (!filePath) return error(ctx.res, 'Invalid path', 400);

      try {
        const containerId = await daemon.ensureContainerForBrowsing(ctx.params.id);

        // mkdir -p with path as argument (not interpolated into shell string)
        await daemon.docker.execCommand(containerId, [
          'mkdir', '-p', path.posix.dirname(filePath),
        ]);

        // Write via base64 piped to stdin — $1 avoids shell injection
        const b64 = Buffer.from(body.content).toString('base64');
        await daemon.docker.execWithStdin(containerId, [
          'bash', '-c', 'base64 -d > "$1"', '--', filePath,
        ], b64);

        json(ctx.res, { ok: true });
      } catch (err: any) {
        error(ctx.res, err.message, 500);
      }
    }),
  ];
}
