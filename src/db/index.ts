import { Sequelize } from 'sequelize';
import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { TAURUS_DATA_PATH, DEFAULT_AGENT_RESOURCE_LIMITS, resourceLimitsToDockerMemoryMb } from '../core/config/index.js';

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

    // Fix migration tracking after filenames were zero-padded (1-foo.cjs → 001-foo.cjs).
    // Without this, existing DBs would try to re-run all migrations.
    try {
      const [rows] = await sequelize.query(
        `SELECT name FROM SequelizeMeta WHERE name GLOB '[0-9]-*' OR name GLOB '[0-9][0-9]-*'`
      ) as [Array<{ name: string }>, unknown];
      for (const row of rows) {
        const num = parseInt(row.name, 10);
        const suffix = row.name.slice(row.name.indexOf('-'));
        const padded = String(num).padStart(3, '0') + suffix;
        await sequelize.query(
          `UPDATE SequelizeMeta SET name = ? WHERE name = ?`,
          { replacements: [padded, row.name] }
        );
      }
    } catch {
      // Table may not exist yet on first run — that's fine
    }

    execSync('npx sequelize-cli db:migrate', { stdio: 'inherit', env: { ...process.env, DOTENV_CONFIG_QUIET: 'true' } });

    await Database.ensureAgentResourceLimitColumns(sequelize);
  }

  private static async ensureAgentResourceLimitColumns(sequelize: Sequelize): Promise<void> {
    type TableInfoRow = { name: string };

    let rows: TableInfoRow[];
    try {
      const result = await sequelize.query(`PRAGMA table_info("Agents")`) as [TableInfoRow[], unknown];
      rows = result[0];
    } catch {
      return;
    }

    if (!Array.isArray(rows) || rows.length === 0) return;

    const existing = new Set(rows.map((row) => row.name));
    const missingStatements: string[] = [];
    const defaultMemoryMb = resourceLimitsToDockerMemoryMb(DEFAULT_AGENT_RESOURCE_LIMITS);

    if (!existing.has('container_cpus')) {
      missingStatements.push(
        `ALTER TABLE "Agents" ADD COLUMN "container_cpus" FLOAT NOT NULL DEFAULT ${DEFAULT_AGENT_RESOURCE_LIMITS.cpus};`,
      );
    }

    if (!existing.has('container_memory_mb')) {
      missingStatements.push(
        `ALTER TABLE "Agents" ADD COLUMN "container_memory_mb" INTEGER NOT NULL DEFAULT ${defaultMemoryMb};`,
      );
    }

    if (!existing.has('container_pids_limit')) {
      missingStatements.push(
        `ALTER TABLE "Agents" ADD COLUMN "container_pids_limit" INTEGER NOT NULL DEFAULT ${DEFAULT_AGENT_RESOURCE_LIMITS.pids_limit};`,
      );
    }

    for (const statement of missingStatements) {
      console.warn(`[db] Backfilling missing Agents column: ${statement.match(/"([^"]+)"(?= [A-Z])/g)?.at(-1)?.replace(/"/g, '') ?? 'unknown'}`);
      await sequelize.query(statement);
    }
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
