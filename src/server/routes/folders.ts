import { v4 as uuidv4 } from 'uuid';
import { json, error, parseBody, route, type Route } from '../helpers.js';
import { assertAccessToFolder } from '../auth/index.js';
import { DisplayableError } from '../../core/errors.js';
import Folder from '../../db/models/Folder.js';
import Agent from '../../db/models/Agent.js';

export function folderRoutes(): Route[] {
  return [
    route('GET', '/api/folders', async (ctx) => {
      const folders = await Folder.getTree(ctx.user.id);
      json(ctx.res, folders.map(f => f.toApi()));
    }),

    route('POST', '/api/folders', async (ctx) => {
      const body = await parseBody(ctx.req);
      if (!body.name) return error(ctx.res, 'name is required');

      // If parent_id provided, verify it belongs to this user
      let parentId: string | null = null;
      if (body.parentId) {
        await assertAccessToFolder(body.parentId, ctx.user);
        parentId = body.parentId;
      } else {
        // Default to user's root folder
        const root = await Folder.ensureRootForUser(ctx.user.id);
        parentId = root.id;
      }

      const folder = await Folder.create({
        id: uuidv4(),
        user_id: ctx.user.id,
        name: body.name,
        parent_id: parentId,
      });
      json(ctx.res, folder.toApi(), 201);
    }),

    route('DELETE', '/api/folders/:id', async (ctx) => {
      try {
        const folder = await assertAccessToFolder(ctx.params.id, ctx.user);

        // Cannot delete root (parent_id IS NULL)
        if (!folder.parent_id) throw new DisplayableError('Cannot delete root folder', 400);

        // Move children and agents to the parent folder (scoped to this user)
        const parentId = folder.parent_id;
        await Agent.update({ folder_id: parentId }, { where: { folder_id: ctx.params.id, user_id: ctx.user.id } });
        await Folder.update({ parent_id: parentId }, { where: { parent_id: ctx.params.id, user_id: ctx.user.id } });
        await folder.destroy();

        json(ctx.res, { ok: true });
      } catch (err: any) {
        if (err instanceof DisplayableError) throw err;
        error(ctx.res, err.message);
      }
    }),
  ];
}
