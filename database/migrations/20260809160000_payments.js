/**
 * Payments for subscription (ZarinPal).
 */
exports.up = async function up(knex) {
  const has = await knex.schema.hasTable('payments');
  if (!has) {
    await knex.schema.createTable('payments', (t) => {
      t.increments('id').primary();
      t.integer('user_id').unsigned().notNullable()
        .references('id').inTable('users').onDelete('CASCADE');
      t.integer('amount').unsigned().notNullable(); // تومان (IRT)
      t.string('currency', 8).notNullable().defaultTo('IRT');
      t.string('plan', 16).notNullable().defaultTo('pro');
      t.string('gateway', 32).notNullable().defaultTo('zarinpal');
      t.string('authority', 64).nullable().unique();
      t.string('status', 16).notNullable().defaultTo('pending'); // pending|paid|failed|cancelled
      t.string('ref_id', 64).nullable();
      t.string('card_pan', 32).nullable();
      t.text('description').nullable();
      t.text('gateway_message').nullable();
      t.timestamp('paid_at').nullable();
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      t.index(['user_id']);
      t.index(['status']);
    });
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('payments');
};
