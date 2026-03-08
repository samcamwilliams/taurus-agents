'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Runs', 'status', {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: 'completed', // existing runs are all done
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Runs', 'status');
  },
};
