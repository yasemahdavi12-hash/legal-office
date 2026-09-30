const fs = require('fs');
const path = require('path');
const db = require('../db/connection');
const config = require('../config');
const { toDbDateTime } = require('../utils/dbHelpers');
const { writeAudit } = require('../services/audit.service');
const { safeLog } = require('../utils/logger');

function retentionDays() {
  const n = Number(process.env.DOCUMENT_SOFT_DELETE_RETENTION_DAYS || 30);
  return Number.isFinite(n) && n >= 1 ? n : 30;
}

function resolveSafeAbs(row) {
  const absPath = path.resolve(config.uploadDir, path.basename(row.stored_name || row.file_path || ''));
  const rel = path.relative(path.resolve(config.uploadDir), absPath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return absPath;
}

/**
 * Permanently remove soft-deleted documents older than retention.
 * Idempotent: safe to re-run; never touches active (deleted_at IS NULL) rows.
 */
async function cleanupSoftDeletedDocuments({ now = new Date(), dryRun = false } = {}) {
  const days = retentionDays();
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const cutoffSql = toDbDateTime(cutoff);

  const rows = await db('documents')
    .whereNotNull('deleted_at')
    .andWhere('deleted_at', '<=', cutoffSql)
    .select('*');

  let removed = 0;
  let filesDeleted = 0;

  for (const row of rows) {
    const absPath = resolveSafeAbs(row);
    if (!dryRun) {
      // Delete metadata first or file first? File then row — if crash mid-way,
      // re-run finds row and retries file delete (idempotent unlink).
      if (absPath && fs.existsSync(absPath)) {
        try {
          fs.unlinkSync(absPath);
          filesDeleted += 1;
        } catch (err) {
          safeLog('[documentCleanup] unlink failed', { id: row.id, err: err.message });
          continue;
        }
      }
      await db('documents').where({ id: row.id }).del();
      await writeAudit({
        userId: row.deleted_by || null,
        action: 'CLEANUP_DELETE',
        entityType: 'document',
        entityId: row.id,
        changes: { file_name: row.file_name, retention_days: days },
        ip: null
      });
    }
    removed += 1;
  }

  return {
    ok: true,
    retention_days: days,
    cutoff: cutoffSql,
    candidates: rows.length,
    removed,
    files_deleted: filesDeleted,
    dry_run: dryRun
  };
}

let timer = null;

function startDocumentCleanupScheduler() {
  if (timer) return;
  const ms = Number(process.env.DOCUMENT_CLEANUP_POLL_MS || 6 * 60 * 60 * 1000);
  const run = () => {
    cleanupSoftDeletedDocuments().catch((err) => {
      safeLog('[documentCleanup] failed', err.message || err);
    });
  };
  // delay first run slightly after boot
  setTimeout(run, 15000);
  timer = setInterval(run, Math.max(ms, 60000));
  if (timer.unref) timer.unref();
}

module.exports = {
  cleanupSoftDeletedDocuments,
  startDocumentCleanupScheduler,
  retentionDays
};
