import { Sequelize } from 'sequelize';
import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { TAURUS_DATA_PATH } from '../core/config.js';

export class Database {
  static client: Sequelize;

  static init(dbPath?: string) {
    if (!Database.client) {
      const storage = dbPath ?? path.join(TAURUS_DATA_PATH, 'taurus.sqlite');

      const dir = path.dirname(storage);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      Database.client = new Sequelize({
        dialect: 'sqlite',
        storage,
        logging: false,
      });
    }

    return Database.client;
  }

  static async sync() {
    const sequelize = Database.init();
    await sequelize.query('PRAGMA journal_mode=WAL');
    execSync('npx sequelize-cli db:migrate', { stdio: 'inherit' });
  }

  static async close() {
    if (Database.client) {
      await Database.client.close();
    }
  }
}

// Auto-init on import
Database.init();

export const sequelize = Database.client;

/**
 * Register model associations and paranoid cascade hooks.
 * Must be called once after all models are loaded (e.g., during daemon boot).
 *
 * Sequelize's onDelete:'CASCADE' only works for real DELETEs, not paranoid
 * soft-deletes (which are UPDATEs). So we cascade via afterDestroy hooks.
 */
let _setup = false;
export async function setupAssociations(): Promise<void> {
  if (_setup) return;
  _setup = true;

  const { default: User } = await import('./models/User.js');
  const { default: Agent } = await import('./models/Agent.js');
  const { default: Run } = await import('./models/Run.js');
  const { default: Message } = await import('./models/Message.js');
  const { default: Folder } = await import('./models/Folder.js');

  // Associations (for eager loading / queries, not for cascade)
  User.hasMany(Agent, { foreignKey: 'user_id' });
  Agent.belongsTo(User, { foreignKey: 'user_id' });
  User.hasMany(Folder, { foreignKey: 'user_id' });
  Folder.belongsTo(User, { foreignKey: 'user_id' });
  Agent.hasMany(Run, { foreignKey: 'agent_id' });
  Run.belongsTo(Agent, { foreignKey: 'agent_id' });
  Run.hasMany(Message, { foreignKey: 'run_id', as: 'messages' });
  Message.belongsTo(Run, { foreignKey: 'run_id' });

  // Paranoid cascade: Agent → Runs → Messages
  Agent.afterDestroy(async (agent) => {
    const runs = await Run.findAll({ where: { agent_id: agent.id }, attributes: ['id'] });
    if (runs.length > 0) {
      // Destroy runs individually so their own afterDestroy hooks fire
      await Promise.all(runs.map(r => r.destroy()));
    }
  });

  Run.afterDestroy(async (run) => {
    await Message.destroy({ where: { run_id: run.id } });
  });
}
