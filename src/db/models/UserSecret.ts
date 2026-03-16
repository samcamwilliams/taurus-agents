import { DataTypes, Model, Op } from 'sequelize';
import { v4 as uuidv4 } from 'uuid';
import { Database } from '../index.js';

const sequelize = Database.init();

/** Allowed secret keys — stored as-is, same as the env var names. */
export const SECRET_KEYS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'XAI_API_KEY',
  'GEMINI_API_KEY',
  'GROQ_API_KEY',
  'TOGETHER_API_KEY',
  'FIREWORKS_API_KEY',
  'BRAVE_SEARCH_API_KEY',
  'JINA_API_KEY',
] as const;

const SECRET_KEYS_SET = new Set<string>(SECRET_KEYS);

export function isSecretKey(key: string): boolean { return SECRET_KEYS_SET.has(key); }

class UserSecret extends Model {
  declare id: string;
  declare user_id: string;
  declare key: string;
  declare value: string;
  declare created_at: Date;
  declare updated_at: Date;

  /**
   * Get all secrets for a user as a key→value map.
   */
  static async getForUser(userId: string): Promise<Record<string, string>> {
    const rows = await UserSecret.findAll({ where: { user_id: userId } });
    const map: Record<string, string> = {};
    for (const row of rows) map[row.key] = row.value;
    return map;
  }

  /**
   * Get secrets as env var overrides (e.g. { ANTHROPIC_API_KEY: '...' }).
   * Only includes known keys with a non-empty value.
   */
  static async getEnvOverrides(userId: string): Promise<Record<string, string>> {
    const secrets = await UserSecret.getForUser(userId);
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(secrets)) {
      if (!isSecretKey(key) || !value) continue;
      env[key] = value;
    }
    return env;
  }

  /**
   * Set a secret. Pass null/empty to delete it.
   */
  static async setForUser(userId: string, key: string, value: string | null): Promise<void> {
    if (!value) {
      await UserSecret.destroy({ where: { user_id: userId, key } });
      return;
    }
    const [row, created] = await UserSecret.findOrCreate({
      where: { user_id: userId, key },
      defaults: { id: uuidv4(), user_id: userId, key, value },
    });
    if (!created) {
      row.value = value;
      await row.save();
    }
  }

  /**
   * Bulk set secrets. Keys with null/empty values are deleted.
   */
  static async bulkSetForUser(userId: string, secrets: Record<string, string | null>): Promise<void> {
    for (const [key, value] of Object.entries(secrets)) {
      if (!isSecretKey(key)) continue; // ignore unknown keys
      await UserSecret.setForUser(userId, key, value || null);
    }
  }
}

UserSecret.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    key: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    value: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
  },
  {
    sequelize,
    tableName: 'UserSecrets',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
);

export default UserSecret;
