/**
 * Enforce one subscription activation per successful payment (DB-level uniqueness).
 * payment_id is nullable so admin/ops events remain allowed; UNIQUE permits multiple NULLs.
 */
exports.up = async function up(knex) {
  const hasCol = await knex.schema.hasColumn('subscription_events', 'payment_id');
  if (!hasCol) {
    await knex.schema.alterTable('subscription_events', (t) => {
      t.integer('payment_id').unsigned().nullable()
        .references('id').inTable('payments').onDelete('SET NULL');
    });
  }

  // Backfill from historical note pattern payment:<id>
  const rows = await knex('subscription_events')
    .where({ source: 'payment' })
    .whereNull('payment_id')
    .whereNotNull('note')
    .select('id', 'note');
  for (const row of rows) {
    const m = String(row.note || '').match(/^payment:(\d+)$/);
    if (!m) continue;
    const paymentId = Number(m[1]);
    if (!paymentId) continue;
    const exists = await knex('payments').where({ id: paymentId }).first();
    if (!exists) continue;
    try {
      await knex('subscription_events').where({ id: row.id }).update({ payment_id: paymentId });
    } catch {
      // skip duplicates during backfill
    }
  }

  const client = knex.client.config.client;
  if (client === 'mysql' || client === 'mysql2') {
    const [idxRows] = await knex.raw(
      `SELECT INDEX_NAME FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'subscription_events'
         AND INDEX_NAME = 'subscription_events_payment_id_unique'
       LIMIT 1`
    );
    if (!idxRows || !idxRows.length) {
      await knex.raw(
        'ALTER TABLE subscription_events ADD UNIQUE INDEX subscription_events_payment_id_unique (payment_id)'
      );
    }
  } else {
    // SQLite / others via Knex
    try {
      await knex.schema.alterTable('subscription_events', (t) => {
        t.unique(['payment_id'], 'subscription_events_payment_id_unique');
      });
    } catch (err) {
      const msg = String((err && err.message) || '');
      if (!/already exists|duplicate/i.test(msg)) throw err;
    }
  }
};

exports.down = async function down(knex) {
  const client = knex.client.config.client;
  try {
    if (client === 'mysql' || client === 'mysql2') {
      await knex.raw('ALTER TABLE subscription_events DROP INDEX subscription_events_payment_id_unique');
    } else {
      await knex.schema.alterTable('subscription_events', (t) => {
        t.dropUnique(['payment_id'], 'subscription_events_payment_id_unique');
      });
    }
  } catch { /* ignore */ }

  const hasCol = await knex.schema.hasColumn('subscription_events', 'payment_id');
  if (hasCol) {
    await knex.schema.alterTable('subscription_events', (t) => {
      t.dropColumn('payment_id');
    });
  }
};
