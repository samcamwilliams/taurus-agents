'use strict';

var Sequelize = require('sequelize');

/**
 * Generated via `npm run makemigration`, then trimmed to the intentional diff
 * because `_current.json` had unrelated historical drift.
 */

var info = {
    "revision": 15,
    "name": "add-agent-resource-limits",
    "created": "2026-03-19T19:24:37.233Z",
    "comment": "Add per-agent CPU, memory, and PID limits"
};

var migrationCommands = function(transaction) {
    return [{
        fn: "addColumn",
        params: [
            "Agents",
            "container_pids_limit",
            {
                "type": Sequelize.INTEGER,
                "field": "container_pids_limit",
                "defaultValue": 256,
                "allowNull": false
            },
            {
                transaction: transaction
            }
        ]
    }, {
        fn: "addColumn",
        params: [
            "Agents",
            "container_memory_mb",
            {
                "type": Sequelize.INTEGER,
                "field": "container_memory_mb",
                "defaultValue": 4096,
                "allowNull": false
            },
            {
                transaction: transaction
            }
        ]
    }, {
        fn: "addColumn",
        params: [
            "Agents",
            "container_cpus",
            {
                "type": Sequelize.FLOAT,
                "field": "container_cpus",
                "defaultValue": 2,
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
            "container_pids_limit",
            {
                transaction: transaction
            }
        ]
    }, {
        fn: "removeColumn",
        params: [
            "Agents",
            "container_memory_mb",
            {
                transaction: transaction
            }
        ]
    }, {
        fn: "removeColumn",
        params: [
            "Agents",
            "container_cpus",
            {
                transaction: transaction
            }
        ]
    }];
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
