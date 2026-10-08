/**
 * Annual legal indices (mehrieh CPI) — schema only; official rows via seed 002_legal_annual_indices_official.js
 */
exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable('legal_annual_indices');
  if (exists) return;

  await knex.schema.createTable('legal_annual_indices', (t) => {
    t.increments('id').primary();
    t.string('calendar_system', 16).notNullable().defaultTo('jalali');
    t.integer('year').notNullable();
    t.decimal('average_index', 20, 6).notNullable();
    t.string('source_name', 512).nullable();
    t.string('source_url', 1024).nullable();
    t.string('source_number', 64).nullable();
    t.string('published_at', 64).nullable();
    t.string('dataset_version', 128).notNullable();
    t.timestamp('ingested_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['calendar_system', 'year']);
    t.index(['dataset_version']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('legal_annual_indices');
};
