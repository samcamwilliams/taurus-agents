import http from 'node:http';
import type { Ctx } from './context.js';

export function json(res: http.ServerResponse, data: any, status = 200): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Connection': 'close',
  });
  res.end(JSON.stringify(data));
}

export function error(res: http.ServerResponse, message: string, status = 400): void {
  json(res, { error: message }, status);
}

const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MB

export async function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

export type Route = {
  method: string;
  pattern: RegExp;
  handler: (ctx: Ctx) => Promise<void>;
};

export function route(method: string, path: string, handler: Route['handler']): Route {
  const pattern = new RegExp(
    '^' + path.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'
  );
  return { method, pattern, handler };
}
