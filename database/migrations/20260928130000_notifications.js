/**
 * In-app notification center (per user).
 */
exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('notifications');
  if (hasTable) return;

  await knex.schema.createTable('notifications', (t) => {
    t.increments('id').primary();
    t.integer('user_id').unsigned().notNullable()
      .references('id').inTable('users').onDelete('CASCADE');
    t.string('type', 64).notNullable();
    t.string('title', 255).notNullable();
    t.text('body').notNullable();
    t.integer('case_id').unsigned().nullable()
      .references('id').inTable('cases').onDelete('CASCADE');
    t.string('entity_type', 64).nullable();
    t.integer('entity_id').unsigned().nullable();
    t.boolean('is_read').notNullable().defaultTo(false);
    t.timestamp('read_at').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.index(['user_id']);
    t.index(['is_read']);
    t.index(['created_at']);
    t.index(['case_id']);
    t.index(['type']);
    t.index(['user_id', 'is_read', 'created_at']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('notifications');
};
