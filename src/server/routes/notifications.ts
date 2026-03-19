import type { Daemon } from '../../daemon/daemon.js';
import { route, type Route } from '../helpers.js';

export function notificationRoutes(daemon: Daemon): Route[] {
  return [
    route('GET', '/api/notifications/stream', async (ctx) => {
      daemon.addNotificationClient(ctx.res, ctx.user.id);
    }),
  ];
}
