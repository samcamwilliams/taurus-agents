import { DataTypes, Model } from 'sequelize';
import { v4 as uuidv4 } from 'uuid';
import { Database } from '../index.js';

const sequelize = Database.init();

class Folder extends Model {
  declare id: string;
  declare user_id: string;
  declare name: string;
  declare parent_id: string | null;
  declare created_at: Date;
  declare updated_at: Date;

  /** Find or create the root folder for a user (parent_id IS NULL). */
  static async ensureRootForUser(userId: string): Promise<Folder> {
    const [root] = await Folder.findOrCreate({
      where: { user_id: userId, parent_id: null },
      defaults: { id: uuidv4(), user_id: userId, name: 'root', parent_id: null },
    });
    return root;
  }

  /** Get the folder tree for a specific user. */
  static async getTree(userId: string): Promise<Folder[]> {
    return Folder.findAll({
      where: { user_id: userId },
      order: [['name', 'ASC']],
    });
  }

  toApi() {
    return {
      id: this.id,
      name: this.name,
      parentId: this.parent_id,
      created_at: this.created_at,
      updated_at: this.updated_at,
    };
  }
}

Folder.init(
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
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    parent_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: 'Folders',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  }
);

export default Folder;
