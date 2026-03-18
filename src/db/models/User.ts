import { DataTypes, Model } from 'sequelize';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { Database } from '../index.js';
import { deriveDefaultPassword } from '../../server/auth/crypto.js';

const sequelize = Database.init();

const BCRYPT_COST = 12;

class User extends Model {
  declare id: string;
  declare username: string;
  declare email: string;
  declare password_hash: string;
  declare role: 'admin' | 'user';
  declare meta: Record<string, any> | null;
  declare deleted_at: Date | null;
  declare created_at: Date;
  declare updated_at: Date;

  async verifyPassword(plain: string): Promise<boolean> {
    return bcrypt.compare(plain, this.password_hash);
  }

  static async hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, BCRYPT_COST);
  }

  /**
   * Ensure the default admin user exists on first boot.
   *
   * - If no users exist: create `taurus` / `taurus@local` / admin.
   *   Uses AUTH_PASSWORD env if set, otherwise the deterministic HKDF password.
   * - If `taurus` exists: check if the deterministic password still matches.
   *   If yes, return the password (for CLI banner). If changed, return null.
   */
  static async ensureDefaultUser(): Promise<{ user: User; password: string | null }> {
    const deterministicPassword = deriveDefaultPassword();
    const envPassword = process.env.AUTH_PASSWORD;

    // Check if any users exist
    const count = await User.count();
    if (count === 0) {
      const password = envPassword || deterministicPassword;
      const hash = await User.hashPassword(password);
      const user = await User.create({
        id: uuidv4(),
        username: 'taurus',
        email: 'taurus@local',
        password_hash: hash,
        role: 'admin',
      });

      return { user, password };
    }

    // Users exist — find the default user
    const taurus = await User.findOne({ where: { username: 'taurus' } });
    if (!taurus) {
      return { user: (await User.findOne())!, password: null };
    }

    // Check if either known password matches (AUTH_PASSWORD takes priority)
    if (envPassword) {
      const envMatches = await bcrypt.compare(envPassword, taurus.password_hash);
      if (envMatches) return { user: taurus, password: envPassword };
    }
    const detMatches = await bcrypt.compare(deterministicPassword, taurus.password_hash);
    if (detMatches) return { user: taurus, password: deterministicPassword };

    // Neither matches — user changed their password via UI.
    return { user: taurus, password: null };
  }
}

User.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
    },
    username: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    password_hash: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    role: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'user',
    },
    meta: {
      type: DataTypes.JSON,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: 'Users',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    paranoid: true,
    deletedAt: 'deleted_at',
  },
);

export default User;
