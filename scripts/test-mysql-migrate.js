/**
 * MySQL migration cycle: latest → rollback all → latest again.
 *
 * Requires:
 *   DB_CLIENT=mysql
 *   DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD
 *
 * Uses a disposable schema name if MYSQL_TEST_DB is set; otherwise DB_NAME.
 */
require('dotenv').config();
const mysql = require('mysql2/promise');
const knexFactory = require('knex');
const path = require('path');

async function main() {
  const host = process.env.DB_HOST;
  const port = Number(process.env.DB_PORT || 3306);
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD != null ? process.env.DB_PASSWORD : '';
  const database = process.env.MYSQL_TEST_DB || process.env.DB_NAME;

  if (!host || !user || !database) {
    console.error('FAIL: set DB_HOST, DB_USER, DB_NAME (and preferably MYSQL_TEST_DB for isolation)');
    process.exit(2);
  }

  console.log(`Connecting to MySQL ${host}:${port} as ${user}…`);
  const admin = await mysql.createConnection({
    host,
    port,
    user,
    password,
    multipleStatements: true
  });

  await admin.query(
    `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await admin.end();

  const knex = knexFactory({
    client: 'mysql2',
    connection: {
      host,
      port,
      user,
      password,
      database,
      charset: 'utf8mb4',
      timezone: 'Z'
    },
    migrations: {
      directory: path.join(__dirname, '..', 'database', 'migrations'),
      tableName: 'knex_migrations'
    }
  });

  try {
    console.log('1) migrate:latest');
    const [batch1, log1] = await knex.migrate.latest();
    console.log('   batch', batch1, 'files', log1);

    console.log('2) migrate:rollback --all');
    const [batch2, log2] = await knex.migrate.rollback(null, true);
    console.log('   batch', batch2, 'files', log2);

    console.log('3) migrate:latest (again)');
    const [batch3, log3] = await knex.migrate.latest();
    console.log('   batch', batch3, 'files', log3);

    const tables = await knex('information_schema.tables')
      .select('TABLE_NAME')
      .where({ TABLE_SCHEMA: database })
      .whereNotIn('TABLE_NAME', ['knex_migrations', 'knex_migrations_lock']);
    console.log('Tables:', tables.map((r) => r.TABLE_NAME).sort().join(', '));

    console.log('PASS  MySQL migrate cycle OK');
  } finally {
    await knex.destroy();
  }
}

main().catch((err) => {
  console.error('FAIL', err.message || err);
  process.exit(1);
});
