/**
 * Password reset OTP + short-lived reset sessions.
 */
exports.up = async function up(knex) {
  const hasOtp = await knex.schema.hasTable('password_otps');
  if (!hasOtp) {
    await knex.schema.createTable('password_otps', (t) => {
      t.increments('id').primary();
      t.integer('user_id').unsigned().nullable()
        .references('id').inTable('users').onDelete('CASCADE');
      t.string('identifier_type', 16).notNullable(); // email | phone
      t.string('identifier_norm', 180).notNullable();
      t.string('otp_salt', 64).notNullable();
      t.string('otp_hash', 128).notNullable();
      t.integer('attempts').notNullable().defaultTo(0);
      t.integer('max_attempts').notNullable().defaultTo(5);
      t.timestamp('expires_at').notNullable();
      t.timestamp('consumed_at').nullable();
      t.string('ip', 64).nullable();
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.index(['identifier_norm', 'created_at']);
      t.index(['user_id']);
    });
  }

  const hasSessions = await knex.schema.hasTable('password_reset_sessions');
  if (!hasSessions) {
    await knex.schema.createTable('password_reset_sessions', (t) => {
      t.increments('id').primary();
      t.integer('user_id').unsigned().notNullable()
        .references('id').inTable('users').onDelete('CASCADE');
      t.integer('otp_id').unsigned().nullable()
        .references('id').inTable('password_otps').onDelete('SET NULL');
      t.string('token_hash', 128).notNullable().unique();
      t.timestamp('expires_at').notNullable();
      t.timestamp('consumed_at').nullable();
      t.string('ip', 64).nullable();
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.index(['user_id']);
    });
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('password_reset_sessions');
  await knex.schema.dropTableIfExists('password_otps');
};
