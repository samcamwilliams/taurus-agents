import { describe, it, expect, beforeAll } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import Agent from '../../../src/db/models/Agent.js';
import Run from '../../../src/db/models/Run.js';
import Message from '../../../src/db/models/Message.js';
import User from '../../../src/db/models/User.js';
import Folder from '../../../src/db/models/Folder.js';

let userId: string;
let folderId: string;

beforeAll(async () => {
  const hash = await User.hashPassword('pass');
  const user = await User.create({ id: uuidv4(), username: 'cascade-user', email: 'cascade@test.local', password_hash: hash, role: 'admin' });
  userId = user.id;
  const root = await Folder.ensureRootForUser(userId);
  folderId = root.id;
});

async function createAgentWithRunAndMessages() {
  const agent = await Agent.create({
    user_id: userId, folder_id: folderId,
    name: `cascade-${uuidv4().slice(0, 8)}`, cwd: '/workspace', system_prompt: 'test', tools: [],
  });

  const run = await Run.create({
    agent_id: agent.id, cwd: '/workspace', status: 'completed',
  });

  const msg1 = await run.persistMessage('user', 'hello');
  const msg2 = await run.persistMessage('assistant', [{ type: 'text', text: 'hi' }], {
    stopReason: 'end_turn', inputTokens: 100, outputTokens: 50,
  });

  return { agent, run, messages: [msg1, msg2] };
}

describe('Cascade delete', () => {
  it('deleting an agent cascades to runs', async () => {
    const { agent, run } = await createAgentWithRunAndMessages();

    await agent.destroy();

    const foundRun = await Run.findByPk(run.id);
    expect(foundRun).toBeNull();
  });

  it('deleting an agent cascades to messages via runs', async () => {
    const { agent, messages } = await createAgentWithRunAndMessages();

    await agent.destroy();

    for (const msg of messages) {
      const found = await Message.findByPk(msg.id);
      expect(found).toBeNull();
    }
  });

  it('deleting a run cascades to its messages', async () => {
    const { run, messages } = await createAgentWithRunAndMessages();

    await run.destroy();

    for (const msg of messages) {
      const found = await Message.findByPk(msg.id);
      expect(found).toBeNull();
    }
  });

  it('deleting one run does not affect another run\'s messages', async () => {
    const agent = await Agent.create({
      user_id: userId, folder_id: folderId,
      name: `iso-${uuidv4().slice(0, 8)}`, cwd: '/workspace', system_prompt: 'test', tools: [],
    });

    const run1 = await Run.create({ agent_id: agent.id, cwd: '/workspace', status: 'completed' });
    const run2 = await Run.create({ agent_id: agent.id, cwd: '/workspace', status: 'completed' });

    const msg1 = await run1.persistMessage('user', 'run1 msg');
    const msg2 = await run2.persistMessage('user', 'run2 msg');

    await run1.destroy();

    expect(await Message.findByPk(msg1.id)).toBeNull();
    expect(await Message.findByPk(msg2.id)).not.toBeNull();
  });

  it('multiple runs cascade when parent agent is deleted', async () => {
    const agent = await Agent.create({
      user_id: userId, folder_id: folderId,
      name: `multi-${uuidv4().slice(0, 8)}`, cwd: '/workspace', system_prompt: 'test', tools: [],
    });

    const run1 = await Run.create({ agent_id: agent.id, cwd: '/workspace', status: 'completed' });
    const run2 = await Run.create({ agent_id: agent.id, cwd: '/workspace', status: 'completed' });
    await run1.persistMessage('user', 'msg1');
    await run2.persistMessage('user', 'msg2');

    await agent.destroy();

    expect(await Run.findByPk(run1.id)).toBeNull();
    expect(await Run.findByPk(run2.id)).toBeNull();
  });
});
