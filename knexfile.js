const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const root = __dirname;

function shared() {
  return {
    migrations: {
      directory: path.join(root, 'database', 'migrations'),
      tableName: 'knex_migrations'
    },
    seeds: {
      directory: path.join(root, 'database', 'seeds')
    }
  };
}

function sqliteConfig() {
  const filename = path.resolve(root, process.env.DB_FILENAME || './database/legal.sqlite');
  return {
    client: 'sqlite3',
    connection: { filename },
    useNullAsDefault: true,
    pool: {
      afterCreate(conn, done) {
        conn.run('PRAGMA foreign_keys = ON', done);
      }
    },
    ...shared()
  };
}

function mysqlConfig() {
  const host = process.env.DB_HOST;
  const database = process.env.DB_NAME;
  const user = process.env.DB_USER;
  if (!host || !database || !user) {
    throw new Error('[knexfile] MySQL requires DB_HOST, DB_NAME, DB_USER in environment');
  }
  return {
    client: 'mysql2',
    connection: {
      host,
      port: Number(process.env.DB_PORT || 3306),
      user,
      password: process.env.DB_PASSWORD != null ? process.env.DB_PASSWORD : '',
      database,
      charset: 'utf8mb4',
      timezone: 'Z',
      multipleStatements: false
    },
    pool: { min: 1, max: 10 },
    ...shared()
  };
}

function pgConfig() {
  return {
    client: 'pg',
    connection: {
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT || 5432),
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'legal_app'
    },
    pool: { min: 1, max: 10 },
    ...shared()
  };
}

function resolveClient(defaultClient) {
  return (process.env.DB_CLIENT || defaultClient || 'sqlite').toLowerCase();
}

function build(defaultClient) {
  const client = resolveClient(defaultClient);
  if (client === 'mysql' || client === 'mysql2') return mysqlConfig();
  if (client === 'pg' || client === 'postgres' || client === 'postgresql') return pgConfig();
  return sqliteConfig();
}

/**
 * development → SQLite by default (override with DB_CLIENT)
 * production  → MySQL only (lazy getter so loading knexfile in dev does not require MySQL env)
 * test        → follows DB_CLIENT (mysql for CI / sqlite local)
 */
module.exports = {
  development: build('sqlite'),
  get production() {
    const client = resolveClient('mysql');
    if (client !== 'mysql' && client !== 'mysql2') {
      throw new Error('[knexfile] production environment requires DB_CLIENT=mysql');
    }
    return mysqlConfig();
  },
  test: build(process.env.DB_CLIENT || 'sqlite')
};
