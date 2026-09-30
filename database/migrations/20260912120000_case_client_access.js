/**
 * Client portal: invite CRM client to case; optional link to users.user_id for login.
 */
exports.up = async function up(knex) {
  const hasUserCol = await knex.schema.hasColumn('clients', 'user_id');
  if (!hasUserCol) {
    await knex.schema.alterTable('clients', (t) => {
      t.integer('user_id').unsigned().nullable()
        .references('id').inTable('users').onDelete('SET NULL');
      t.index(['user_id']);
    });
  }

  const hasTable = await knex.schema.hasTable('case_client_access');
  if (!hasTable) {
    await knex.schema.createTable('case_client_access', (t) => {
      t.increments('id').primary();
      t.integer('case_id').unsigned().notNullable()
        .references('id').inTable('cases').onDelete('CASCADE');
      t.integer('client_id').unsigned().notNullable()
        .references('id').inTable('clients').onDelete('CASCADE');
      t.string('status', 16).notNullable().defaultTo('pending');
      t.timestamp('invited_at').notNullable().defaultTo(knex.fn.now());
      t.timestamp('accepted_at').nullable();
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      t.unique(['case_id', 'client_id']);
      t.index(['case_id']);
      t.index(['client_id']);
      t.index(['status']);
    });
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('case_client_access');
  const hasUserCol = await knex.schema.hasColumn('clients', 'user_id');
  if (hasUserCol) {
    await knex.schema.alterTable('clients', (t) => {
      t.dropColumn('user_id');
    });
  }
};
