/**
 * Subscription plans — FREE quota is TOTAL cases (any status).
 */
exports.up = async function up(knex) {
  const hasPlan = await knex.schema.hasColumn('users', 'subscription_plan');
  if (!hasPlan) {
    await knex.schema.alterTable('users', (t) => {
      t.string('subscription_plan', 16).notNullable().defaultTo('free');
      t.timestamp('subscription_expires_at').nullable();
    });
  }

  // Optional history of plan changes (no payment gateway — admin/ops driven)
  const hasSubs = await knex.schema.hasTable('subscription_events');
  if (!hasSubs) {
    await knex.schema.createTable('subscription_events', (t) => {
      t.increments('id').primary();
      t.integer('user_id').unsigned().notNullable()
        .references('id').inTable('users').onDelete('CASCADE');
      t.string('plan', 16).notNullable();
      t.timestamp('expires_at').nullable();
      t.string('source', 32).notNullable().defaultTo('admin');
      t.text('note').nullable();
      t.integer('actor_id').unsigned().nullable()
        .references('id').inTable('users').onDelete('SET NULL');
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.index(['user_id']);
    });
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('subscription_events');
  const hasPlan = await knex.schema.hasColumn('users', 'subscription_plan');
  if (hasPlan) {
    // MySQL: drop one column per alter when possible (safer across versions)
    await knex.schema.alterTable('users', (t) => {
      t.dropColumn('subscription_expires_at');
    });
    await knex.schema.alterTable('users', (t) => {
      t.dropColumn('subscription_plan');
    });
  }
};
