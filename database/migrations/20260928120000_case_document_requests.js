/**
 * Lawyer requests documents from portal clients per case.
 */
exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('case_document_requests');
  if (hasTable) return;

  await knex.schema.createTable('case_document_requests', (t) => {
    t.increments('id').primary();
    t.integer('case_id').unsigned().notNullable()
      .references('id').inTable('cases').onDelete('CASCADE');
    t.integer('client_id').unsigned().notNullable()
      .references('id').inTable('clients').onDelete('CASCADE');
    t.integer('requested_by_user_id').unsigned().notNullable()
      .references('id').inTable('users').onDelete('CASCADE');
    t.string('title', 200).notNullable();
    t.text('description').nullable();
    t.string('status', 16).notNullable().defaultTo('pending');
    t.timestamp('requested_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('submitted_at').nullable();
    t.timestamp('reviewed_at').nullable();
    t.integer('reviewed_by_user_id').unsigned().nullable()
      .references('id').inTable('users').onDelete('SET NULL');
    t.text('rejection_reason').nullable();
    t.integer('document_id').unsigned().nullable()
      .references('id').inTable('documents').onDelete('SET NULL');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.index(['case_id']);
    t.index(['client_id']);
    t.index(['status']);
    t.index(['created_at']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('case_document_requests');
};
