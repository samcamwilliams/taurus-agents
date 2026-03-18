const path = require('path');
require('dotenv').config();

const dataPath = process.env.TAURUS_DATA_PATH || './data';
const storage = path.resolve(dataPath, 'taurus.sqlite');

const config = {
  username: null,
  password: null,
  database: 'main',
  host: 'localhost',
  dialect: 'sqlite',
  storage,
};

module.exports = {
  development: config,
  production: config,
};
