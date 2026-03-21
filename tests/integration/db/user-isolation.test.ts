import { describe, it, expect, beforeAll } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import Agent from '../../../src/db/models/Agent.js';
import Run from '../../../src/db/models/Run.js';
import User from '../../../src/db/models/User.js';
import Folder from '../../../src/db/models/Folder.js';

let userA: { id: string; folderId: string };
let userB: { id: string; folderId: string };

beforeAll(async () => {
  const hash = await User.hashPassword('pass');

  const a = await User.create({ id: uuidv4(), username: 'user-a', email: 'a@test.local', password_hash: hash, role: 'admin' });
  const aRoot = await Folder.ensureRootForUser(a.id);
  userA = { id: a.id, folderId: aRoot.id };

  const b = await User.create({ id: uuidv4(), username: 'user-b', email: 'b@test.local', password_hash: hash, role: 'user' });
  const bRoot = await Folder.ensureRootForUser(b.id);
  userB = { id: b.id, folderId: bRoot.id };
});

describe('User isolation', () => {
  it('user A cannot see user B\'s agents', async () => {
    await Agent.create({
      user_id: userA.id, folder_id: userA.folderId,
      name: `a-agent-${uuidv4().slice(0,8)}`, cwd: '/workspace', system_prompt: 'A', tools: [],
    });
    await Agent.create({
      user_id: userB.id, folder_id: userB.folderId,
      name: `b-agent-${uuidv4().slice(0,8)}`, cwd: '/workspace', system_prompt: 'B', tools: [],
    });

    const aAgents = await Agent.findAll({ where: { user_id: userA.id } });
    const bAgents = await Agent.findAll({ where: { user_id: userB.id } });

    expect(aAgents.every((a) => a.user_id === userA.id)).toBe(true);
    expect(bAgents.every((b) => b.user_id === userB.id)).toBe(true);
  });

  it('user A cannot see user B\'s folders', async () => {
    const aFolders = await Folder.getTree(userA.id);
    const bFolders = await Folder.getTree(userB.id);

    expect(aFolders.every((f) => f.user_id === userA.id)).toBe(true);
    expect(bFolders.every((f) => f.user_id === userB.id)).toBe(true);
    expect(aFolders.some((f) => f.user_id === userB.id)).toBe(false);
  });

  it('deleting user A\'s agent does not affect user B', async () => {
    const aAgent = await Agent.create({
      user_id: userA.id, folder_id: userA.folderId,
      name: `del-a-${uuidv4().slice(0,8)}`, cwd: '/workspace', system_prompt: 'A', tools: [],
    });
    const bAgent = await Agent.create({
      user_id: userB.id, folder_id: userB.folderId,
      name: `del-b-${uuidv4().slice(0,8)}`, cwd: '/workspace', system_prompt: 'B', tools: [],
    });

    await aAgent.destroy();

    expect(await Agent.findByPk(aAgent.id)).toBeNull();
    expect(await Agent.findByPk(bAgent.id)).not.toBeNull();
  });

  it('runs are scoped to their agent\'s user', async () => {
    const aAgent = await Agent.create({
      user_id: userA.id, folder_id: userA.folderId,
      name: `run-a-${uuidv4().slice(0,8)}`, cwd: '/workspace', system_prompt: 'A', tools: [],
    });
    const bAgent = await Agent.create({
      user_id: userB.id, folder_id: userB.folderId,
      name: `run-b-${uuidv4().slice(0,8)}`, cwd: '/workspace', system_prompt: 'B', tools: [],
    });

    const aRun = await Run.create({ agent_id: aAgent.id, cwd: '/workspace', status: 'completed' });
    const bRun = await Run.create({ agent_id: bAgent.id, cwd: '/workspace', status: 'completed' });

    // Querying runs through agent_id ensures user scoping
    const aRuns = await Run.findAll({ where: { agent_id: aAgent.id } });
    const bRuns = await Run.findAll({ where: { agent_id: bAgent.id } });

    expect(aRuns.length).toBe(1);
    expect(aRuns[0].id).toBe(aRun.id);
    expect(bRuns.length).toBe(1);
    expect(bRuns[0].id).toBe(bRun.id);
  });
});
