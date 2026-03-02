import { DataTypes, Model } from 'sequelize';
import { v4 as uuidv4 } from 'uuid';
import { Database } from '../index.js';
import type { ChatMessage, ContentBlock } from '../../core/types.js';

const sequelize = Database.init();

class Message extends Model {
  declare id: string;
  declare session_id: string;
  declare role: string;
  declare content: string; // JSON-stringified content blocks
  declare stop_reason: string | null;
  declare input_tokens: number;
  declare output_tokens: number;
  declare created_at: Date;

  /**
   * Convert to Anthropic API message format for ChatML reconstruction.
   */
  toChatMLMessage(): ChatMessage {
    let content: string | ContentBlock[];
    try {
      content = JSON.parse(this.content);
    } catch {
      content = this.content; // plain string
    }
    return {
      role: this.role as 'user' | 'assistant',
      content,
    };
  }

  toApi() {
    return {
      id: this.id,
      sessionId: this.session_id,
      role: this.role,
      content: this.content,
      stopReason: this.stop_reason,
      inputTokens: this.input_tokens,
      outputTokens: this.output_tokens,
      createdAt: this.created_at,
    };
  }
}

Message.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
    },
    session_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    role: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    stop_reason: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    input_tokens: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    output_tokens: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
  },
  {
    sequelize,
    tableName: 'Messages',
    timestamps: true,
    underscored: true,
    updatedAt: false, // messages are immutable
  }
);

export default Message;
