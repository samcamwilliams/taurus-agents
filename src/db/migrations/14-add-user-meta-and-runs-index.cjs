'use strict';

/**
 * Add meta JSON column to Users (for budget config etc.),
 * and composite index on Runs(agent_id, created_at) for fast monthly spend queries.
 */

var info = {
    "revision": 14,
    "name": "add-user-meta-and-runs-index",
    "created": "2026-03-19T00:00:00.000Z",
    "comment": "Add Users.meta JSON column; add Runs(agent_id, created_at) index"
};

module.exports = {
    pos: 0,
    useTransaction: true,
    execute: function() {},
    up: async function(queryInterface, Sequelize) {
        await queryInterface.sequelize.query(`
            ALTER TABLE "Users" ADD COLUMN "meta" JSON;
        `);
        await queryInterface.sequelize.query(`
            CREATE INDEX "runs_agent_created" ON "Runs" ("agent_id", "created_at");
        `);
    },
    down: async function(queryInterface, Sequelize) {
        await queryInterface.sequelize.query(`
            DROP INDEX IF EXISTS "runs_agent_created";
        `);
        // SQLite 3.35+ supports ALTER TABLE DROP COLUMN
        await queryInterface.sequelize.query(`
            ALTER TABLE "Users" DROP COLUMN "meta";
        `);
    },
    info: info
};
