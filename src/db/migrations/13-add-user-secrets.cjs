'use strict';

/**
 * Create UserSecrets table for per-user API keys.
 */

var info = {
    "revision": 13,
    "name": "add-user-secrets",
    "created": "2026-03-16T00:00:00.000Z",
    "comment": "Add UserSecrets table for per-user API keys"
};

module.exports = {
    pos: 0,
    useTransaction: true,
    execute: function() {},
    up: async function(queryInterface, Sequelize) {
        await queryInterface.sequelize.query(`
            CREATE TABLE "UserSecrets" (
                "id" UUID UNIQUE PRIMARY KEY,
                "user_id" UUID NOT NULL,
                "key" VARCHAR(255) NOT NULL,
                "value" TEXT NOT NULL,
                "created_at" DATETIME NOT NULL,
                "updated_at" DATETIME NOT NULL
            );
        `);
        await queryInterface.sequelize.query(`
            CREATE UNIQUE INDEX "user_secrets_user_key" ON "UserSecrets" ("user_id", "key");
        `);
    },
    down: async function(queryInterface, Sequelize) {
        await queryInterface.sequelize.query(`DROP TABLE IF EXISTS "UserSecrets";`);
    },
    info: info
};
