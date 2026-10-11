/**
 * Per-user legal document templates (قالب‌های حقوقی).
 */
exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable('document_templates');
  if (exists) return;

  await knex.schema.createTable('document_templates', (t) => {
    t.increments('id').primary();
    t.integer('owner_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('title', 255).notNullable();
    t.text('body').notNullable();
    t.string('category', 32).notNullable().defaultTo('other');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.index(['owner_id']);
    t.index(['owner_id', 'category']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('document_templates');
};
