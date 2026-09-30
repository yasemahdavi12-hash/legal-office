/**
 * Add lawyer license number to user profile (owner-scoped via /api/me).
 */
exports.up = async function up(knex) {
  const has = await knex.schema.hasColumn('users', 'license_number');
  if (!has) {
    await knex.schema.alterTable('users', (t) => {
      t.string('license_number', 64).nullable();
    });
  }
};

exports.down = async function down(knex) {
  const has = await knex.schema.hasColumn('users', 'license_number');
  if (has) {
    await knex.schema.alterTable('users', (t) => {
      t.dropColumn('license_number');
    });
  }
};
