'use strict';

var Sequelize = require('sequelize');

/**
 * Actions summary:
 *
 * addColumn "deleted_at" to table "Agents"
 * addColumn "deleted_at" to table "Runs"
 * addColumn "updated_at" to table "Messages"
 *
 **/

var info = {
    "revision": 11,
    "name": "add-soft-delete-and-updated-at",
    "created": "2026-03-16T00:00:00.000Z",
    "comment": ""
};

var migrationCommands = function(transaction) {
    return [
        {
            fn: "addColumn",
            params: [
                "Agents",
                "deleted_at",
                { "type": Sequelize.DATE, "field": "deleted_at", "allowNull": true },
                { transaction: transaction }
            ]
        },
        {
            fn: "addColumn",
            params: [
                "Runs",
                "deleted_at",
                { "type": Sequelize.DATE, "field": "deleted_at", "allowNull": true },
                { transaction: transaction }
            ]
        },
        {
            fn: "addColumn",
            params: [
                "Messages",
                "updated_at",
                { "type": Sequelize.DATE, "field": "updated_at", "allowNull": true },
                { transaction: transaction }
            ]
        },
    ];
};
var rollbackCommands = function(transaction) {
    return [
        { fn: "removeColumn", params: ["Agents", "deleted_at", { transaction: transaction }] },
        { fn: "removeColumn", params: ["Runs", "deleted_at", { transaction: transaction }] },
        { fn: "removeColumn", params: ["Messages", "updated_at", { transaction: transaction }] },
    ];
};

module.exports = {
    pos: 0,
    useTransaction: true,
    execute: function(queryInterface, Sequelize, _commands)
    {
        var index = this.pos;
        function run(transaction) {
            const commands = _commands(transaction);
            return new Promise(function(resolve, reject) {
                function next() {
                    if (index < commands.length)
                    {
                        let command = commands[index];
                        console.log("[#"+index+"] execute: " + command.fn);
                        index++;
                        queryInterface[command.fn].apply(queryInterface, command.params).then(next, reject);
                    }
                    else
                        resolve();
                }
                next();
            });
        }
        if (this.useTransaction) {
            return queryInterface.sequelize.transaction(run);
        } else {
            return run(null);
        }
    },
    up: function(queryInterface, Sequelize)
    {
        return this.execute(queryInterface, Sequelize, migrationCommands);
    },
    down: function(queryInterface, Sequelize)
    {
        return this.execute(queryInterface, Sequelize, rollbackCommands);
    },
    info: info
};
