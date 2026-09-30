const knex = require('knex');
const config = require('../config');

/** Shared Knex instance — swap DB_CLIENT in .env without touching services. */
const db = knex(config.knex);

module.exports = db;
