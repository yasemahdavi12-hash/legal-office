/**
 * Manual case payments recorded by lawyer (MVP).
 */
exports.up = async function up(knex) {
  const has = await knex.schema.hasTable('case_payments');
  if (!has) {
    await knex.schema.createTable('case_payments', (t) => {
      t.increments('id').primary();
      t.integer('case_id').unsigned().notNullable()
        .references('id').inTable('cases').onDelete('CASCADE');
      t.decimal('amount', 20, 0).notNullable();
      t.string('currency', 8).notNullable().defaultTo('IRR');
      t.date('payment_date').notNullable();
      t.string('description', 500).nullable();
      t.string('status', 16).notNullable().defaultTo('recorded'); // recorded|cancelled
      t.integer('created_by_user_id').unsigned().notNullable()
        .references('id').inTable('users').onDelete('RESTRICT');
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      t.index(['case_id', 'status']);
    });
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('case_payments');
};
