/**
 * Add must_change_password for production admin seed enforcement.
 */
exports.up = async function up(knex) {
  const has = await knex.schema.hasColumn('users', 'must_change_password');
  if (!has) {
    await knex.schema.alterTable('users', (t) => {
      t.boolean('must_change_password').notNullable().defaultTo(false);
    });
  }
};

exports.down = async function down(knex) {
  const has = await knex.schema.hasColumn('users', 'must_change_password');
  if (has) {
    await knex.schema.alterTable('users', (t) => {
      t.dropColumn('must_change_password');
    });
  }
};
