import { DataTypes, Model } from 'sequelize';
import { v4 as uuidv4 } from 'uuid';
import { Database } from '../index.js';

const sequelize = Database.init();

class ToolCall extends Model {
  declare id: string;
  declare message_id: string;
  declare tool_name: string;
  declare tool_input: string; // JSON
  declare tool_output: string;
  declare is_error: boolean;
  declare duration_ms: number;
  declare created_at: Date;

  toApi() {
    return {
      id: this.id,
      messageId: this.message_id,
      toolName: this.tool_name,
      toolInput: this.tool_input,
      toolOutput: this.tool_output,
      isError: this.is_error,
      durationMs: this.duration_ms,
      createdAt: this.created_at,
    };
  }
}

ToolCall.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
    },
    message_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    tool_name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    tool_input: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    tool_output: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    is_error: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    duration_ms: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
  },
  {
    sequelize,
    tableName: 'ToolCalls',
    timestamps: true,
    underscored: true,
    updatedAt: false,
  }
);

export default ToolCall;
