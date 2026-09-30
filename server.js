require('dotenv').config();

const fs = require('fs');
const path = require('path');
const config = require('./src/config');
const db = require('./src/db/connection');
const { createApp } = require('./src/app');
const { ensureUploadDir } = require('./src/services/document.service');

async function bootstrap() {
  ensureUploadDir();

  // Ensure database directory exists for sqlite
  if (config.knex.client === 'sqlite3') {
    const filename = config.knex.connection.filename;
    fs.mkdirSync(path.dirname(filename), { recursive: true });
  }

  console.log('  Running migrations...');
  await db.migrate.latest();
  console.log('  Running seeds...');
  await db.seed.run();

  const app = createApp();
  const { startReminderScheduler } = require('./src/jobs/reminderScheduler');
  const { startDocumentCleanupScheduler } = require('./src/jobs/documentCleanup');
  // Production rate-limit store must be constructible (Redis)
  require('./src/middleware/rateLimitStore').getRateLimitStore();

  app.listen(config.port, () => {
    startReminderScheduler();
    startDocumentCleanupScheduler();
    console.log('');
    console.log('  ================================');
    console.log('   قانون در جیب شما — Backend');
    console.log('  ================================');
    console.log('');
    console.log('  App:    http://localhost:' + config.port);
    console.log('  Admin:  http://localhost:' + config.port + '/admin');
    console.log('  Health: http://localhost:' + config.port + '/api/health');
    console.log('  DB:     ' + config.dbClient);
    console.log('  Upload: ' + config.uploadDir + ' (API-only)');
    console.log('');
  });
}

bootstrap().catch((err) => {
  const msg = err && err.message ? err.message : String(err);
  console.error('Failed to start server:', msg);
  process.exit(1);
});
