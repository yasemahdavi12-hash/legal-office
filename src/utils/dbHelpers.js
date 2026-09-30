/** Portable helpers so services stay DB-agnostic. */
function nowSql(knex) {
  return knex.fn.now();
}

/**
 * Format a Date for TIMESTAMP/DATETIME columns on SQLite + MySQL.
 * MySQL rejects ISO-8601 with "T" / "Z"; use "YYYY-MM-DD HH:mm:ss" (UTC).
 */
function toDbDateTime(value = new Date()) {
  if (value == null || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Parse a DB DATETIME/TIMESTAMP value as UTC milliseconds.
 * Naive "YYYY-MM-DD HH:mm:ss" (no zone) must NOT be treated as local wall-clock
 * (Windows/Node would shift expiry and break expired-PRO quota).
 */
function parseDbDateTime(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? null : t;
  }
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(s) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
    const t = new Date(s.replace(' ', 'T') + 'Z').getTime();
    return Number.isNaN(t) ? null : t;
  }
  const t = new Date(s).getTime();
  return Number.isNaN(t) ? null : t;
}

function parseJson(value, fallback = null) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function toJson(value) {
  if (value == null) return null;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * Insert row and return numeric id across sqlite3 / mysql2 / pg.
 */
async function insertReturningId(knex, table, data) {
  const client = knex.client.config.client;
  if (client === 'pg') {
    const result = await knex(table).insert(data).returning('id');
    const row = result[0];
    return typeof row === 'object' ? row.id : row;
  }
  const result = await knex(table).insert(data);
  return result[0];
}

module.exports = { nowSql, toDbDateTime, parseDbDateTime, parseJson, toJson, insertReturningId };
