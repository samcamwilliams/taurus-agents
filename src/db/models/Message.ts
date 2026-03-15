import { DataTypes, Model } from 'sequelize';
import { v4 as uuidv4 } from 'uuid';
import { Database } from '../index.js';
import type { ChatMessage } from '../../core/types.js';
import { computeCost } from '../../core/models.js';

const sequelize = Database.init();

class Message extends Model {
  declare id: string;
  declare run_id: string;
  declare seq: number;
  declare role: string;
  declare content: any;
  declare meta: Record<string, any> | null;
  declare stop_reason: string | null;
  declare input_tokens: number;
  declare output_tokens: number;
  declare created_at: Date;

  toChatMLMessage(): ChatMessage {
    if (this.role !== 'user' && this.role !== 'assistant') {
      throw new Error(`Cannot convert message with role "${this.role}" to ChatML — filter before calling toChatMLMessage()`);
    }
    return { role: this.role, content: this.content };
  }

  toApi() {
    const { id, run_id, seq, role, content, meta, stop_reason, input_tokens, output_tokens, created_at } = this;
    // Compute cost on the fly from persisted meta.usage + meta.model.
    // meta.usage follows the normalized TokenUsage convention (see types.ts):
    //   input = total tokens, cacheRead/cacheWrite are subsets, nativeCost is authoritative (OpenRouter).
    let cost: number | undefined;
    let usage: Record<string, number> | undefined;
    if ((role === 'assistant' || role === 'compaction') && meta?.usage && meta?.model) {
      usage = meta.usage;
      cost = computeCost(meta.model, meta.usage);
    }
    // Include compaction stats for UI rendering (tokensBefore, messagesCompacted, compactedAt)
    const compaction = role === 'compaction' && meta
      ? { tokensBefore: meta.tokensBefore, messagesCompacted: meta.messagesCompacted, compactedAt: meta.compactedAt }
      : undefined;
    const model = meta?.model as string | undefined;
    return { id, run_id, seq, role, content, stop_reason, input_tokens, output_tokens, usage, cost, model, compaction, created_at };
  }
}

Message.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
    },
    run_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    role: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    seq: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    content: {
      type: DataTypes.JSON,
      allowNull: false,
    },
    meta: {
      type: DataTypes.JSON,
      allowNull: true,
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
    createdAt: 'created_at',
    updatedAt: false,
    indexes: [
      { fields: ['run_id', 'seq'] },
    ],
  }
);

export default Message;
