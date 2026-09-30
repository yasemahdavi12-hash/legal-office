/**
 * Encrypted off-server backup CLI.
 *
 *   node scripts/backup.js
 *   node scripts/backup.js --restore legal-app/backup-....enc
 *   node scripts/backup.js --restore backups/backup-....enc
 */
require('dotenv').config();
const { createEncryptedBackup, restoreFromEncrypted } = require('../src/services/backup/backup.service');

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--restore') {
    const result = await restoreFromEncrypted(args[1] || '');
    console.log('Restore complete:', result);
    console.log('Restart Node.js application.');
    return;
  }
  const summary = await createEncryptedBackup();
  console.log('Backup created:', summary);
}

main().catch((err) => {
  console.error('Backup failed:', err.message || err);
  process.exit(1);
});
