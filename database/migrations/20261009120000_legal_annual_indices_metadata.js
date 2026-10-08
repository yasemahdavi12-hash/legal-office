/**
 * Add source_title + timestamps; versioned unique (calendar_system, year, dataset_version).
 */
exports.up = async function up(knex) {
  const has = await knex.schema.hasTable('legal_annual_indices');
  if (!has) return;

  const hasTitle = await knex.schema.hasColumn('legal_annual_indices', 'source_title');
  if (!hasTitle) {
    await knex.schema.alterTable('legal_annual_indices', (t) => {
      t.string('source_title', 512).nullable();
      t.timestamp('created_at').nullable();
      t.timestamp('updated_at').nullable();
    });
    await knex('legal_annual_indices').update({
      updated_at: knex.fn.now(),
      created_at: knex.fn.now()
    });
  }

  const client = knex.client.config.client;
  if (client === 'sqlite3') {
    await knex.raw('DROP INDEX IF EXISTS legal_annual_indices_calendar_system_year_unique');
  }
  try {
    await knex.schema.alterTable('legal_annual_indices', (t) => {
      t.dropUnique(['calendar_system', 'year']);
    });
  } catch {
    /* already migrated or sqlite */
  }
  try {
    await knex.schema.alterTable('legal_annual_indices', (t) => {
      t.unique(['calendar_system', 'year', 'dataset_version'], 'legal_annual_idx_cal_year_ver');
    });
  } catch {
    /* unique may exist */
  }
};

exports.down = async function down() {
  /* non-destructive rollback skipped */
};
