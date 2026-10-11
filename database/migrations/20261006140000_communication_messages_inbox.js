/**
 * Inbox: direction (inbound/outbound) and read_at on communication_inbound_messages.
 */
exports.up = async function up(knex) {
  const hasDir = await knex.schema.hasColumn('communication_inbound_messages', 'direction');
  if (!hasDir) {
    await knex.schema.alterTable('communication_inbound_messages', (t) => {
      t.string('direction', 16).notNullable().defaultTo('inbound');
      t.timestamp('read_at').nullable();
    });
  }
};

exports.down = async function down(knex) {
  const hasDir = await knex.schema.hasColumn('communication_inbound_messages', 'direction');
  if (hasDir) {
    await knex.schema.alterTable('communication_inbound_messages', (t) => {
      t.dropColumn('read_at');
      t.dropColumn('direction');
    });
  }
};
