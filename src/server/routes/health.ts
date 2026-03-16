import { json, route, type Route } from '../helpers.js';

export function healthRoutes(): Route[] {
  return [
    route('GET', '/api/health', async (ctx) => {
      json(ctx.res, { status: 'ok', uptime: process.uptime() });
    }),
  ];
}
