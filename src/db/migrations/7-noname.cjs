'use strict';

var Sequelize = require('sequelize');

/**
 * Actions summary:
 *
 * addIndex "messages_run_id_seq" to table "Messages"
 *
 **/

var info = {
    "revision": 7,
    "name": "noname",
    "created": "2026-03-10T05:08:01.659Z",
    "comment": ""
};

var migrationCommands = function(transaction) {
    return [{
        fn: "addIndex",
        params: [
            "Messages",
            ["run_id", "seq"],
            {
                "indexName": "messages_run_id_seq",
                "name": "messages_run_id_seq",
                "transaction": transaction
            }
        ]
    }];
};
var rollbackCommands = function(transaction) {
    return [{
        fn: "removeIndex",
        params: [
            "Messages",
            "messages_run_id_seq",
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
