/**
 * Per-case agreed fee (MVP finance).
 */
exports.up = async function up(knex) {
  const has = await knex.schema.hasTable('case_financials');
  if (!has) {
    await knex.schema.createTable('case_financials', (t) => {
      t.increments('id').primary();
      t.integer('case_id').unsigned().notNullable()
        .references('id').inTable('cases').onDelete('CASCADE');
      t.decimal('agreed_fee', 20, 0).notNullable().defaultTo(0);
      t.string('currency', 8).notNullable().defaultTo('IRR');
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      t.unique(['case_id']);
    });
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('case_financials');
};
