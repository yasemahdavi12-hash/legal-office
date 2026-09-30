/**
 * Secure hashed invitation tokens for client portal (one-time, expiry).
 */
exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('client_invitation_tokens');
  if (hasTable) return;

  await knex.schema.createTable('client_invitation_tokens', (t) => {
    t.increments('id').primary();
    t.integer('access_id').unsigned().notNullable()
      .references('id').inTable('case_client_access').onDelete('CASCADE');
    t.string('token_hash', 64).notNullable().unique();
    t.timestamp('expires_at').notNullable();
    t.timestamp('used_at').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['access_id']);
    t.index(['expires_at']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('client_invitation_tokens');
};
