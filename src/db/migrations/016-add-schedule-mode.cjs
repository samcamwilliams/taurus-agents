'use strict';

var Sequelize = require('sequelize');

var info = {
    "revision": 16,
    "name": "add-schedule-mode",
    "created": "2026-03-20T12:48:00.000Z",
    "comment": "Add schedule_mode column to Agents (new or continue)"
};

var migrationCommands = function(transaction) {
    return [{
        fn: "addColumn",
        params: [
            "Agents",
            "schedule_mode",
            {
                "type": Sequelize.STRING,
                "field": "schedule_mode",
                "defaultValue": "new",
                "allowNull": false
            },
            {
                transaction: transaction
            }
        ]
    }];
};

var rollbackCommands = function(transaction) {
    return [{
        fn: "removeColumn",
        params: [
            "Agents",
            "schedule_mode",
            {
                transaction: transaction
            }
        ]
    }];
};

module.exports = {
    pos: 0,
    useTransaction: true,
    execute: function(queryInterface, Sequelize, _commands) {
        var index = this.pos;
        function run(transaction) {
            const commands = _commands(transaction);
            return new Promise(function(resolve, reject) {
                function next() {
                    if (index < commands.length) {
                        let command = commands[index];
                        console.log("[#" + index + "] execute: " + command.fn);
                        index++;
                        queryInterface[command.fn].apply(queryInterface, command.params).then(next, reject);
                    } else {
                        resolve();
                    }
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
    up: function(queryInterface, Sequelize) {
        return this.execute(queryInterface, Sequelize, migrationCommands);
    },
    down: function(queryInterface, Sequelize) {
        return this.execute(queryInterface, Sequelize, rollbackCommands);
    },
    info: info
};
