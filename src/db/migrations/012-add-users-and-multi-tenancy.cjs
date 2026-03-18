'use strict';

/**
 * Schema-only migration: create Users table, add user_id to Agents and Folders.
 * user_id is nullable — the app assigns ownership at startup via ensureDefaultUser().
 * The old unique index on Agents (parent_agent_id, name) is replaced with
 * (user_id, parent_agent_id, name).
 */

var info = {
    "revision": 12,
    "name": "add-users-and-multi-tenancy",
    "created": "2026-03-16T00:00:00.000Z",
    "comment": "Add Users table; add user_id to Agents and Folders"
};

module.exports = {
    pos: 0,
    useTransaction: true,
    execute: function() {},
    up: async function(queryInterface, Sequelize) {
        const t = await queryInterface.sequelize.transaction();
        try {
            // 1. Create Users table
            await queryInterface.sequelize.query(`
                CREATE TABLE "Users" (
                    "id" UUID UNIQUE PRIMARY KEY,
                    "username" VARCHAR(255) NOT NULL UNIQUE,
                    "email" VARCHAR(255) NOT NULL UNIQUE,
                    "password_hash" VARCHAR(255) NOT NULL,
                    "role" VARCHAR(255) NOT NULL DEFAULT 'user',
                    "created_at" DATETIME NOT NULL,
                    "updated_at" DATETIME NOT NULL,
                    "deleted_at" DATETIME
                );
            `, { transaction: t });

            // 2. Add user_id column to Agents (nullable)
            await queryInterface.sequelize.query(`
                ALTER TABLE "Agents" ADD COLUMN "user_id" UUID;
            `, { transaction: t });

            // Replace the old unique index with one that includes user_id
            await queryInterface.sequelize.query(`
                DROP INDEX IF EXISTS "agents_parent_name_unique";
            `, { transaction: t });
            await queryInterface.sequelize.query(`
                CREATE UNIQUE INDEX "agents_user_parent_name_unique" ON "Agents" ("user_id", "parent_agent_id", "name");
            `, { transaction: t });

            // 3. Add user_id column to Folders (nullable)
            await queryInterface.sequelize.query(`
                ALTER TABLE "Folders" ADD COLUMN "user_id" UUID;
            `, { transaction: t });

            await t.commit();
        } catch (err) {
            await t.rollback();
            throw err;
        }
    },
    down: async function(queryInterface, Sequelize) {
        const t = await queryInterface.sequelize.transaction();
        try {
            // Remove user_id from Agents, restore old unique index
            await queryInterface.sequelize.query(`
                DROP INDEX IF EXISTS "agents_user_parent_name_unique";
            `, { transaction: t });

            // SQLite doesn't support DROP COLUMN before 3.35 — rebuild the table
            await queryInterface.sequelize.query(`
                CREATE TABLE "Agents_old" (
                    "id" UUID UNIQUE PRIMARY KEY,
                    "parent_agent_id" UUID,
                    "folder_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
                    "name" VARCHAR(255) NOT NULL,
                    "status" VARCHAR(255) NOT NULL DEFAULT 'idle',
                    "cwd" VARCHAR(255) NOT NULL,
                    "model" VARCHAR(255) NOT NULL DEFAULT 'claude-sonnet-4-20250514',
                    "system_prompt" TEXT NOT NULL,
                    "tools" JSON NOT NULL DEFAULT '[]',
                    "schedule" VARCHAR(255),
                    "max_turns" INTEGER NOT NULL DEFAULT 20,
                    "timeout_ms" INTEGER NOT NULL DEFAULT 300000,
                    "metadata" JSON,
                    "docker_image" VARCHAR(255) NOT NULL DEFAULT 'taurus-base',
                    "created_at" DATETIME NOT NULL,
                    "updated_at" DATETIME NOT NULL,
                    "schedule_overlap" VARCHAR(255) NOT NULL DEFAULT 'skip',
                    "mounts" JSON NOT NULL DEFAULT '[]',
                    "deleted_at" DATETIME
                );
            `, { transaction: t });
            await queryInterface.sequelize.query(`
                INSERT INTO "Agents_old"
                    ("id", "parent_agent_id", "folder_id", "name", "status", "cwd", "model",
                     "system_prompt", "tools", "schedule", "max_turns", "timeout_ms", "metadata",
                     "docker_image", "created_at", "updated_at", "schedule_overlap", "mounts", "deleted_at")
                SELECT "id", "parent_agent_id", "folder_id", "name", "status", "cwd", "model",
                       "system_prompt", "tools", "schedule", "max_turns", "timeout_ms", "metadata",
                       "docker_image", "created_at", "updated_at", "schedule_overlap", "mounts", "deleted_at"
                FROM "Agents";
            `, { transaction: t });
            await queryInterface.sequelize.query(`DROP TABLE "Agents";`, { transaction: t });
            await queryInterface.sequelize.query(`ALTER TABLE "Agents_old" RENAME TO "Agents";`, { transaction: t });
            await queryInterface.sequelize.query(`
                CREATE UNIQUE INDEX "agents_parent_name_unique" ON "Agents" ("parent_agent_id", "name");
            `, { transaction: t });

            // Remove user_id from Folders (rebuild)
            await queryInterface.sequelize.query(`
                CREATE TABLE "Folders_old" (
                    "id" UUID PRIMARY KEY,
                    "name" VARCHAR(255) NOT NULL,
                    "parent_id" UUID,
                    "created_at" DATETIME NOT NULL,
                    "updated_at" DATETIME NOT NULL
                );
            `, { transaction: t });
            await queryInterface.sequelize.query(`
                INSERT INTO "Folders_old" ("id", "name", "parent_id", "created_at", "updated_at")
                SELECT "id", "name", "parent_id", "created_at", "updated_at"
                FROM "Folders";
            `, { transaction: t });
            await queryInterface.sequelize.query(`DROP TABLE "Folders";`, { transaction: t });
            await queryInterface.sequelize.query(`ALTER TABLE "Folders_old" RENAME TO "Folders";`, { transaction: t });

            // Drop Users table
            await queryInterface.sequelize.query(`DROP TABLE IF EXISTS "Users";`, { transaction: t });

            await t.commit();
        } catch (err) {
            await t.rollback();
            throw err;
        }
    },
    info: info
};
