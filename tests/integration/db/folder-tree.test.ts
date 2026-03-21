import { describe, it, expect, beforeAll } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import Folder from '../../../src/db/models/Folder.js';
import User from '../../../src/db/models/User.js';

let userId: string;

beforeAll(async () => {
  const hash = await User.hashPassword('pass');
  const user = await User.create({ id: uuidv4(), username: 'folder-user', email: 'folder@test.local', password_hash: hash, role: 'admin' });
  userId = user.id;
});

describe('Folder tree', () => {
  it('ensureRootForUser creates a root folder', async () => {
    const root = await Folder.ensureRootForUser(userId);
    expect(root).toBeDefined();
    expect(root.name).toBe('root');
    expect(root.parent_id).toBeNull();
    expect(root.user_id).toBe(userId);
  });

  it('ensureRootForUser is idempotent', async () => {
    const root1 = await Folder.ensureRootForUser(userId);
    const root2 = await Folder.ensureRootForUser(userId);
    expect(root1.id).toBe(root2.id);
  });

  it('creates a child folder', async () => {
    const root = await Folder.ensureRootForUser(userId);
    const child = await Folder.create({
      id: uuidv4(), user_id: userId, name: 'projects', parent_id: root.id,
    });
    expect(child.parent_id).toBe(root.id);
    expect(child.name).toBe('projects');
  });

  it('creates nested folders', async () => {
    const root = await Folder.ensureRootForUser(userId);
    const level1 = await Folder.create({ id: uuidv4(), user_id: userId, name: 'l1', parent_id: root.id });
    const level2 = await Folder.create({ id: uuidv4(), user_id: userId, name: 'l2', parent_id: level1.id });

    expect(level2.parent_id).toBe(level1.id);
    const found = await Folder.findByPk(level2.id);
    expect(found!.parent_id).toBe(level1.id);
  });

  it('getTree returns all folders for a user', async () => {
    const tree = await Folder.getTree(userId);
    expect(tree.length).toBeGreaterThanOrEqual(1); // at least root
    expect(tree.every((f) => f.user_id === userId)).toBe(true);
  });

  it('deleting a folder works', async () => {
    const root = await Folder.ensureRootForUser(userId);
    const temp = await Folder.create({ id: uuidv4(), user_id: userId, name: 'temp-folder', parent_id: root.id });
    await temp.destroy();

    const found = await Folder.findByPk(temp.id);
    expect(found).toBeNull();
  });

  it('toApi() returns expected shape', async () => {
    const root = await Folder.ensureRootForUser(userId);
    const api = root.toApi();
    expect(api.id).toBe(root.id);
    expect(api.name).toBe('root');
    expect(api.parentId).toBeNull();
    expect(api.created_at).toBeDefined();
  });

  it('different users get different roots', async () => {
    const hash = await User.hashPassword('pass');
    const other = await User.create({ id: uuidv4(), username: `other-${uuidv4().slice(0,8)}`, email: `other-${uuidv4().slice(0,8)}@test.local`, password_hash: hash, role: 'user' });
    const otherRoot = await Folder.ensureRootForUser(other.id);
    const myRoot = await Folder.ensureRootForUser(userId);

    expect(otherRoot.id).not.toBe(myRoot.id);
    expect(otherRoot.user_id).toBe(other.id);
  });
});
