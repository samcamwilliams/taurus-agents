'use strict';

var Sequelize = require('sequelize');

/**
 * Actions summary:
 *
 * addColumn "parent_agent_id" to table "Agents"
 * Recreate table to change name uniqueness from UNIQUE to composite (parent_agent_id, name)
 *
 **/

var info = {
    "revision": 8,
    "name": "add-parent-agent-id",
    "created": "2026-03-11T00:00:00.000Z",
    "comment": "Add parent_agent_id for agent hierarchy; change name uniqueness to (parent_agent_id, name)"
};

module.exports = {
    pos: 0,
    useTransaction: true,
    execute: function() {},
    up: async function(queryInterface, Sequelize) {
        const t = await queryInterface.sequelize.transaction();
        try {
            // SQLite can't alter UNIQUE constraints — must recreate the table.
            // 1. Create new table with updated schema
            await queryInterface.sequelize.query(`
                CREATE TABLE "Agents_new" (
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
                    "mounts" JSON NOT NULL DEFAULT '[]'
                );
            `, { transaction: t });

            // 2. Copy data (existing agents get parent_agent_id = NULL)
            await queryInterface.sequelize.query(`
                INSERT INTO "Agents_new"
                    ("id", "parent_agent_id", "folder_id", "name", "status", "cwd", "model",
                     "system_prompt", "tools", "schedule", "max_turns", "timeout_ms", "metadata",
                     "docker_image", "created_at", "updated_at", "schedule_overlap", "mounts")
                SELECT
                    "id", NULL, "folder_id", "name", "status", "cwd", "model",
                    "system_prompt", "tools", "schedule", "max_turns", "timeout_ms", "metadata",
                    "docker_image", "created_at", "updated_at", "schedule_overlap", "mounts"
                FROM "Agents";
            `, { transaction: t });

            // 3. Drop old table, rename new
            await queryInterface.sequelize.query(`DROP TABLE "Agents";`, { transaction: t });
            await queryInterface.sequelize.query(`ALTER TABLE "Agents_new" RENAME TO "Agents";`, { transaction: t });

            // 4. Add composite unique index
            await queryInterface.sequelize.query(`
                CREATE UNIQUE INDEX "agents_parent_name_unique" ON "Agents" ("parent_agent_id", "name");
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
            await queryInterface.sequelize.query(`DROP INDEX IF EXISTS "agents_parent_name_unique";`, { transaction: t });
            await queryInterface.removeColumn('Agents', 'parent_agent_id', { transaction: t });
            // Re-adding UNIQUE on name would require another table rebuild; skip for rollback
            await t.commit();
        } catch (err) {
            await t.rollback();
            throw err;
        }
    },
    info: info
};
