/**
 * Inbound messenger messages (Bale webhook/polling) — separate from case_messages.
 */
exports.up = async function up(knex) {
  const hasSecret = await knex.schema.hasColumn('communications', 'inbound_webhook_secret');
  if (!hasSecret) {
    await knex.schema.alterTable('communications', (t) => {
      t.string('inbound_webhook_secret', 64).nullable().unique();
    });
  }

  const hasTable = await knex.schema.hasTable('communication_inbound_messages');
  if (!hasTable) {
    await knex.schema.createTable('communication_inbound_messages', (t) => {
      t.increments('id').primary();
      t.integer('communication_id').unsigned().notNullable()
        .references('id').inTable('communications').onDelete('CASCADE');
      t.string('platform', 32).notNullable().defaultTo('bale');
      t.string('external_message_id', 64).notNullable();
      t.string('chat_id', 64).notNullable();
      t.string('sender_id', 64).nullable();
      t.string('sender_username', 120).nullable();
      t.string('sender_first_name', 120).nullable();
      t.text('text').nullable();
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.unique(['communication_id', 'external_message_id']);
      t.index(['communication_id', 'created_at']);
      t.index(['platform']);
    });
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('communication_inbound_messages');
  const hasSecret = await knex.schema.hasColumn('communications', 'inbound_webhook_secret');
  if (hasSecret) {
    await knex.schema.alterTable('communications', (t) => {
      t.dropColumn('inbound_webhook_secret');
    });
  }
};
