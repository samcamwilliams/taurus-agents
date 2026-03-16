/**
 * Ownership and cross-entity assertion helpers.
 *
 * Pure DB lookups — no daemon dependency. Every function either returns
 * the validated resource or throws DisplayableError(403).
 * Routes call these as one-liners before proceeding to daemon methods.
 */

import type { AuthUser } from '../context.js';
import { NotFoundError } from '../../core/errors.js';
import Agent from '../../db/models/Agent.js';
import Run from '../../db/models/Run.js';
import Message from '../../db/models/Message.js';
import Folder from '../../db/models/Folder.js';

/** Assert the user owns this agent. */
export async function assertAccessToAgent(agentId: string, user: AuthUser): Promise<Agent> {
  const agent = await Agent.findByPk(agentId, { attributes: ['id', 'user_id'] });
  if (!agent || agent.user_id !== user.id)
    throw new NotFoundError('Agent not found');
  return agent;
}

/** Assert the run belongs to the specified agent. Prevents cross-entity attacks. */
export async function assertRunBelongsToAgent(runId: string, agentId: string): Promise<Run> {
  const run = await Run.findByPk(runId, { attributes: ['id', 'agent_id'] });
  if (!run || run.agent_id !== agentId)
    throw new NotFoundError('Run not found');
  return run;
}

/** Assert the message belongs to the specified run. */
export async function assertMessageBelongsToRun(messageId: string, runId: string): Promise<Message> {
  const msg = await Message.findByPk(messageId, { attributes: ['id', 'run_id'] });
  if (!msg || msg.run_id !== runId)
    throw new NotFoundError('Message not found');
  return msg;
}

/** Assert the user owns this folder. */
export async function assertAccessToFolder(folderId: string, user: AuthUser): Promise<Folder> {
  const folder = await Folder.findByPk(folderId);
  if (!folder || folder.user_id !== user.id)
    throw new NotFoundError('Folder not found');
  return folder;
}
