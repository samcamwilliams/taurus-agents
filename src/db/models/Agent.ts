import { DataTypes, Model } from 'sequelize';
import { v4 as uuidv4 } from 'uuid';
import { Database } from '../index.js';
import type { AgentStatus } from '../../daemon/types.js';
import { DEFAULT_MODEL, DEFAULT_DOCKER_IMAGE, DEFAULT_MAX_TURNS, DEFAULT_TIMEOUT_MS } from '../../core/defaults.js';
import {
  DEFAULT_AGENT_RESOURCE_LIMITS,
  agentResourceLimitsFromValues,
  resourceLimitsToDockerMemoryMb,
  type AgentResourceLimits,
} from '../../core/config/index.js';

const sequelize = Database.init();

class Agent extends Model {
  declare id: string;
  declare user_id: string;
  declare parent_agent_id: string | null;
  declare folder_id: string;
  declare name: string;
  declare status: AgentStatus;
  declare cwd: string;
  declare model: string;
  declare system_prompt: string;
  declare tools: string[];
  declare schedule: string | null;
  declare schedule_overlap: 'skip' | 'queue' | 'kill';
  declare max_turns: number;
  declare timeout_ms: number;
  declare metadata: Record<string, unknown> | null;
  declare docker_image: string;
  declare mounts: { host: string; container: string; readonly?: boolean }[];
  declare container_cpus: number;
  declare container_memory_mb: number;
  declare container_pids_limit: number;
  declare created_at: Date;
  declare updated_at: Date;

  get container_id(): string {
    return `taurus-agent-${this.id}`;
  }

  toApi() {
    const { id, user_id, parent_agent_id, folder_id, name, status, cwd, model, system_prompt, tools, schedule, schedule_overlap, max_turns, timeout_ms, metadata, docker_image, created_at, updated_at } = this;
    // SQLite may store JSON default as a raw string — ensure mounts is always an array
    const mounts = typeof this.mounts === 'string' ? JSON.parse(this.mounts) : (this.mounts ?? []);
    const resource_limits: AgentResourceLimits = agentResourceLimitsFromValues(this);
    return { id, user_id, parent_agent_id, folder_id, name, status, cwd, model, system_prompt, tools, schedule, schedule_overlap, max_turns, timeout_ms, metadata, docker_image, mounts, resource_limits, created_at, updated_at };
  }
}

Agent.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: uuidv4,
      primaryKey: true,
    },
    parent_agent_id: {
      type: DataTypes.UUID,
      allowNull: true,
      defaultValue: null,
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    folder_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      // Uniqueness enforced by composite index (parent_agent_id, name) in migration
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'idle',
    },
    cwd: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    model: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: DEFAULT_MODEL,
    },
    system_prompt: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    tools: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
    schedule: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    schedule_overlap: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'skip',
    },
    max_turns: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: DEFAULT_MAX_TURNS,
    },
    timeout_ms: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: DEFAULT_TIMEOUT_MS,
    },
    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    docker_image: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: DEFAULT_DOCKER_IMAGE,
    },
    mounts: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
    container_cpus: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: DEFAULT_AGENT_RESOURCE_LIMITS.cpus,
    },
    container_memory_mb: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: resourceLimitsToDockerMemoryMb(DEFAULT_AGENT_RESOURCE_LIMITS),
    },
    container_pids_limit: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: DEFAULT_AGENT_RESOURCE_LIMITS.pids_limit,
    },
  },
  {
    sequelize,
    tableName: 'Agents',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    paranoid: true,
    deletedAt: 'deleted_at',
    indexes: [
      {
        unique: true,
        fields: ['user_id', 'parent_agent_id', 'name'],
        name: 'agents_user_parent_name_unique',
      },
    ],
  }
);

export default Agent;
