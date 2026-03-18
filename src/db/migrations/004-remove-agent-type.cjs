'use strict';

/**
 * Actions summary:
 *
 * removeColumn "type" from table "Agents"
 *
 * Uses raw SQL because Sequelize's removeColumn on SQLite
 * fails with "Cannot set properties of undefined (setting 'unique')"
 * due to a bug in how it recreates the table to drop a column.
 **/

var info = {
    "revision": 4,
    "name": "remove-agent-type",
    "created": "2026-03-08T22:27:06.621Z",
    "comment": ""
};

module.exports = {
    pos: 0,
    useTransaction: true,
    up: async function(queryInterface) {
        // SQLite 3.35+ supports ALTER TABLE DROP COLUMN natively
        await queryInterface.sequelize.query('ALTER TABLE "Agents" DROP COLUMN "type";');
    },
    down: async function(queryInterface, Sequelize) {
        await queryInterface.addColumn('Agents', 'type', {
            type: Sequelize.STRING,
            allowNull: false,
            defaultValue: 'observer',
        });
    },
    info: info
};
