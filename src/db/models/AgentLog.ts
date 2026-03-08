import { DataTypes, Model } from 'sequelize';
import { v4 as uuidv4 } from 'uuid';
import { Database } from '../index.js';
import type { LogLevel } from '../../daemon/types.js';

const sequelize = Database.init();

class AgentLog extends Model {
  declare id: string;
  declare thread_id: string;
  declare session_id: string | null;
  declare level: LogLevel;
  declare event: string;
  declare message: string;
  declare data: string | null; // JSON blob
  declare created_at: Date;

  toApi() {
    return {
      id: this.id,
      agentId: this.thread_id,
      runId: this.session_id,
      level: this.level,
      event: this.event,
      message: this.message,
      data: this.data ? JSON.parse(this.data) : null,
      createdAt: this.created_at,
    };
  }
}

AgentLog.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
    },
    thread_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    session_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    level: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'info',
    },
    event: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    data: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: 'ThreadLogs', // keep existing table name
    timestamps: true,
    underscored: true,
    updatedAt: false,
  }
);

export default AgentLog;
