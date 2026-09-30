/**
 * Security hardening: MFA columns, recovery codes, refresh token families, document soft-delete.
 * Does not alter existing MySQL-compatible column types from prior migrations.
 */
exports.up = async function up(knex) {
  const hasMfa = await knex.schema.hasColumn('users', 'mfa_enabled');
  if (!hasMfa) {
    await knex.schema.alterTable('users', (t) => {
      t.boolean('mfa_enabled').notNullable().defaultTo(false);
      t.text('mfa_secret_enc').nullable();
      t.integer('mfa_failed_attempts').notNullable().defaultTo(0);
      t.timestamp('mfa_locked_until').nullable();
    });
  }

  const hasRecovery = await knex.schema.hasTable('mfa_recovery_codes');
  if (!hasRecovery) {
    await knex.schema.createTable('mfa_recovery_codes', (t) => {
      t.increments('id').primary();
      t.integer('user_id').unsigned().notNullable()
        .references('id').inTable('users').onDelete('CASCADE');
      t.string('code_hash', 128).notNullable().unique();
      t.timestamp('used_at').nullable();
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.index(['user_id']);
    });
  }

  const hasFamily = await knex.schema.hasColumn('refresh_tokens', 'family_id');
  if (!hasFamily) {
    await knex.schema.alterTable('refresh_tokens', (t) => {
      t.string('family_id', 64).nullable();
      t.index(['family_id']);
    });
    // Backfill: each existing token becomes its own family
    const rows = await knex('refresh_tokens').select('id');
    for (const row of rows) {
      await knex('refresh_tokens').where({ id: row.id }).update({
        family_id: `legacy-${row.id}`
      });
    }
  }

  const hasDeleted = await knex.schema.hasColumn('documents', 'deleted_at');
  if (!hasDeleted) {
    await knex.schema.alterTable('documents', (t) => {
      t.timestamp('deleted_at').nullable();
      t.integer('deleted_by').unsigned().nullable()
        .references('id').inTable('users').onDelete('SET NULL');
      t.index(['deleted_at']);
    });
  }
};

exports.down = async function down(knex) {
  const hasDeleted = await knex.schema.hasColumn('documents', 'deleted_at');
  if (hasDeleted) {
    try {
      await knex.schema.alterTable('documents', (t) => {
        t.dropForeign(['deleted_by']);
      });
    } catch { /* ignore */ }
    await knex.schema.alterTable('documents', (t) => {
      t.dropColumn('deleted_by');
    });
    await knex.schema.alterTable('documents', (t) => {
      t.dropColumn('deleted_at');
    });
  }

  const hasFamily = await knex.schema.hasColumn('refresh_tokens', 'family_id');
  if (hasFamily) {
    await knex.schema.alterTable('refresh_tokens', (t) => {
      t.dropColumn('family_id');
    });
  }

  await knex.schema.dropTableIfExists('mfa_recovery_codes');

  const hasMfa = await knex.schema.hasColumn('users', 'mfa_enabled');
  if (hasMfa) {
    await knex.schema.alterTable('users', (t) => {
      t.dropColumn('mfa_locked_until');
    });
    await knex.schema.alterTable('users', (t) => {
      t.dropColumn('mfa_failed_attempts');
    });
    await knex.schema.alterTable('users', (t) => {
      t.dropColumn('mfa_secret_enc');
    });
    await knex.schema.alterTable('users', (t) => {
      t.dropColumn('mfa_enabled');
    });
  }
};
