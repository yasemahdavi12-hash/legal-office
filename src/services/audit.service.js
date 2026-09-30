const db = require('../db/connection');
const { toJson } = require('../utils/dbHelpers');

/**
 * Audit log for cases, documents, users.
 * Stores actor, action, time, and changed fields as JSON.
 * Pass trx when calling from inside a transaction (SQLite pool is tiny).
 */
async function writeAudit({ userId, action, entityType, entityId, changes, ip }, trx = db) {
  await trx('audit_logs').insert({
    user_id: userId || null,
    action,
    entity_type: entityType,
    entity_id: entityId || null,
    changes: toJson(changes),
    ip: ip || null,
    created_at: trx.fn.now()
  });
}

function diffObjects(before, after, fields) {
  const changes = {};
  for (const f of fields) {
    const a = before ? before[f] : undefined;
    const b = after ? after[f] : undefined;
    if (String(a ?? '') !== String(b ?? '')) {
      changes[f] = { from: a ?? null, to: b ?? null };
    }
  }
  return changes;
}

module.exports = { writeAudit, diffObjects };
