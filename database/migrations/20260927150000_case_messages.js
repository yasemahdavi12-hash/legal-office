/**
 * Secure case messaging between lawyer (users) and portal clients.
 */
exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('case_messages');
  if (hasTable) return;

  await knex.schema.createTable('case_messages', (t) => {
    t.increments('id').primary();
    t.integer('case_id').unsigned().notNullable()
      .references('id').inTable('cases').onDelete('CASCADE');
    t.integer('sender_user_id').unsigned().nullable()
      .references('id').inTable('users').onDelete('SET NULL');
    t.integer('sender_client_id').unsigned().nullable()
      .references('id').inTable('clients').onDelete('SET NULL');
    t.text('body').notNullable();
    t.timestamp('read_at').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.index(['case_id']);
    t.index(['created_at']);
    t.index(['sender_user_id']);
    t.index(['sender_client_id']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('case_messages');
};
