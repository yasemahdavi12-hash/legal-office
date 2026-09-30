/**
 * Production hardening: revoked refresh token families (scoped access invalidation).
 */
exports.up = async function up(knex) {
  const has = await knex.schema.hasTable('revoked_token_families');
  if (!has) {
    await knex.schema.createTable('revoked_token_families', (t) => {
      t.string('family_id', 64).primary();
      t.integer('user_id').unsigned().nullable()
        .references('id').inTable('users').onDelete('CASCADE');
      t.timestamp('revoked_at').notNullable().defaultTo(knex.fn.now());
      t.index(['user_id']);
      t.index(['revoked_at']);
    });
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('revoked_token_families');
};
