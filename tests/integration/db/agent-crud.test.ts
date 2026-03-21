import { describe, it, expect, beforeAll } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import Agent from '../../../src/db/models/Agent.js';
import User from '../../../src/db/models/User.js';
import Folder from '../../../src/db/models/Folder.js';

let userId: string;
let folderId: string;

beforeAll(async () => {
  const hash = await User.hashPassword('pass');
  const user = await User.create({ id: uuidv4(), username: 'crud-user', email: 'crud@test.local', password_hash: hash, role: 'admin' });
  userId = user.id;
  const root = await Folder.ensureRootForUser(userId);
  folderId = root.id;
});

describe('Agent CRUD', () => {
  it('creates an agent with defaults', async () => {
    const agent = await Agent.create({
      user_id: userId,
      folder_id: folderId,
      name: 'test-agent',
      cwd: '/workspace',
      system_prompt: 'You are helpful.',
      tools: ['Read', 'Glob'],
    });

    expect(agent.id).toBeDefined();
    expect(agent.name).toBe('test-agent');
    expect(agent.status).toBe('idle');
    expect(agent.tools).toEqual(['Read', 'Glob']);
    expect(agent.max_turns).toBeGreaterThanOrEqual(0);
    expect(agent.docker_image).toBe('taurus-base');
  });

  it('reads an agent by ID', async () => {
    const created = await Agent.create({
      user_id: userId, folder_id: folderId,
      name: 'read-test', cwd: '/workspace', system_prompt: 'test', tools: [],
    });

    const found = await Agent.findByPk(created.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe('read-test');
    expect(found!.user_id).toBe(userId);
  });

  it('updates agent fields', async () => {
    const agent = await Agent.create({
      user_id: userId, folder_id: folderId,
      name: 'update-test', cwd: '/workspace', system_prompt: 'old', tools: [],
    });

    await agent.update({ system_prompt: 'new prompt', tools: ['Bash'] });

    const refreshed = await Agent.findByPk(agent.id);
    expect(refreshed!.system_prompt).toBe('new prompt');
    expect(refreshed!.tools).toEqual(['Bash']);
  });

  it('soft-deletes an agent (paranoid)', async () => {
    const agent = await Agent.create({
      user_id: userId, folder_id: folderId,
      name: 'delete-test', cwd: '/workspace', system_prompt: 'test', tools: [],
    });

    await agent.destroy();

    // Normal findByPk should not find it
    const found = await Agent.findByPk(agent.id);
    expect(found).toBeNull();

    // paranoid:false should find the soft-deleted record
    const soft = await Agent.findByPk(agent.id, { paranoid: false });
    expect(soft).not.toBeNull();
    expect(soft!.getDataValue('deleted_at')).not.toBeNull();
  });

  it('lists agents for a user', async () => {
    const name = `list-${uuidv4().slice(0, 8)}`;
    await Agent.create({
      user_id: userId, folder_id: folderId,
      name, cwd: '/workspace', system_prompt: 'test', tools: [],
    });

    const agents = await Agent.findAll({ where: { user_id: userId, name } });
    expect(agents.length).toBe(1);
    expect(agents[0].name).toBe(name);
  });

  it('enforces unique (user_id, parent_agent_id, name) for non-null parent', async () => {
    // SQLite allows duplicate NULLs in unique indexes, so we test with a non-null parent_agent_id
    const parentId = uuidv4();
    const name = `unique-${uuidv4().slice(0, 8)}`;
    await Agent.create({
      user_id: userId, folder_id: folderId, parent_agent_id: parentId,
      name, cwd: '/workspace', system_prompt: 'first', tools: [],
    });

    await expect(
      Agent.create({
        user_id: userId, folder_id: folderId, parent_agent_id: parentId,
        name, cwd: '/workspace', system_prompt: 'second', tools: [],
      }),
    ).rejects.toThrow();
  });

  it('NULL parent_agent_id allows DB-level duplicates (app-level check in daemon.createAgent)', async () => {
    // SQLite treats NULL != NULL in unique indexes, so the DB constraint
    // does NOT prevent duplicate top-level agent names. The fix is an
    // app-level check in daemon.createAgent(). This test documents the
    // DB-level behavior so nobody is surprised.
    const name = `null-parent-dup-${uuidv4().slice(0, 8)}`;
    await Agent.create({
      user_id: userId, folder_id: folderId, parent_agent_id: null,
      name, cwd: '/workspace', system_prompt: 'first', tools: [],
    });

    // This succeeds at DB level — the app-level check is in daemon.createAgent()
    const dup = await Agent.create({
      user_id: userId, folder_id: folderId, parent_agent_id: null,
      name, cwd: '/workspace', system_prompt: 'second', tools: [],
    });
    expect(dup.id).toBeDefined();

    // Cleanup
    await Agent.destroy({ where: { id: dup.id }, force: true });
  });

  it('name can be reused after rename-and-soft-delete pattern', async () => {
    const name = `reuse-${uuidv4().slice(0, 8)}`;
    const agent = await Agent.create({
      user_id: userId, folder_id: folderId, parent_agent_id: null,
      name, cwd: '/workspace', system_prompt: 'test', tools: [],
    });

    // Simulate what daemon.deleteAgent() does: rename then soft-delete
    await agent.update({ name: `${name}__deleted_${Date.now()}` });
    await agent.destroy();

    // Creating a new agent with the original name should succeed
    const newAgent = await Agent.create({
      user_id: userId, folder_id: folderId, parent_agent_id: null,
      name, cwd: '/workspace', system_prompt: 'test reborn', tools: [],
    });
    expect(newAgent.name).toBe(name);
    expect(newAgent.id).not.toBe(agent.id);
  });

  it('toApi() returns expected shape', async () => {
    const agent = await Agent.create({
      user_id: userId, folder_id: folderId,
      name: `api-${uuidv4().slice(0, 8)}`, cwd: '/workspace', system_prompt: 'test',
      tools: ['Read'], metadata: { key: 'value' },
    });

    const api = agent.toApi();
    expect(api.id).toBe(agent.id);
    expect(api.name).toBe(agent.name);
    expect(api.metadata).toEqual({ key: 'value' });
    expect(api.resource_limits).toBeDefined();
    expect(api.mounts).toEqual([]);
    // Should not expose deleted_at or internal fields
    expect((api as any).deleted_at).toBeUndefined();
  });
});
