/**
 * Lawyer shares case documents with portal clients (revocable).
 */
exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('case_client_document_access');
  if (hasTable) return;

  await knex.schema.createTable('case_client_document_access', (t) => {
    t.increments('id').primary();
    t.integer('case_id').unsigned().notNullable()
      .references('id').inTable('cases').onDelete('CASCADE');
    t.integer('document_id').unsigned().notNullable()
      .references('id').inTable('documents').onDelete('CASCADE');
    t.integer('client_id').unsigned().notNullable()
      .references('id').inTable('clients').onDelete('CASCADE');
    t.integer('shared_by_user_id').unsigned().notNullable()
      .references('id').inTable('users').onDelete('CASCADE');
    t.string('status', 16).notNullable().defaultTo('active');
    t.timestamp('shared_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('revoked_at').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['document_id', 'client_id']);
    t.index(['case_id']);
    t.index(['document_id']);
    t.index(['client_id']);
    t.index(['status']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('case_client_document_access');
};
