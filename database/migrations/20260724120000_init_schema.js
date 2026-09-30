/**
 * Initial schema — Knex query builder keeps this portable across sqlite3 / mysql2 / pg.
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('users', (t) => {
    t.increments('id').primary();
    t.string('name', 120).notNullable();
    t.string('phone', 32).nullable();
    t.string('email', 180).notNullable().unique();
    t.string('password_hash', 255).notNullable();
    t.string('role', 32).notNullable().defaultTo('lawyer');
    t.integer('token_version').notNullable().defaultTo(0);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('refresh_tokens', (t) => {
    t.increments('id').primary();
    t.integer('user_id').unsigned().notNullable()
      .references('id').inTable('users').onDelete('CASCADE');
    t.string('token_hash', 128).notNullable().unique();
    t.timestamp('expires_at').notNullable();
    t.timestamp('revoked_at').nullable();
    t.string('user_agent', 255).nullable();
    t.string('ip', 64).nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('cases', (t) => {
    t.increments('id').primary();
    t.integer('owner_id').unsigned().notNullable()
      .references('id').inTable('users').onDelete('CASCADE');
    t.string('case_number', 80).notNullable();
    t.string('archive_number', 80).nullable();
    t.string('branch', 120).nullable();
    t.string('title', 255).notNullable();
    t.text('description').nullable();
    t.string('status', 32).notNullable().defaultTo('active');
    t.string('supervision_date', 32).nullable();
    t.string('supervision_time', 16).nullable();
    t.text('supervision_note').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.index(['owner_id']);
    t.index(['status']);
    t.index(['case_number']);
  });

  await knex.schema.createTable('clients', (t) => {
    t.increments('id').primary();
    t.integer('case_id').unsigned().nullable()
      .references('id').inTable('cases').onDelete('CASCADE');
    t.integer('owner_id').unsigned().notNullable()
      .references('id').inTable('users').onDelete('CASCADE');
    t.string('name', 160).notNullable();
    t.string('phone', 32).nullable();
    t.string('national_id', 20).nullable();
    t.text('description').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['case_id']);
    t.index(['owner_id']);
  });

  await knex.schema.createTable('tasks', (t) => {
    t.increments('id').primary();
    t.integer('case_id').unsigned().nullable()
      .references('id').inTable('cases').onDelete('CASCADE');
    t.integer('owner_id').unsigned().notNullable()
      .references('id').inTable('users').onDelete('CASCADE');
    t.string('title', 255).notNullable();
    t.string('status', 16).notNullable().defaultTo('todo');
    t.string('priority', 16).notNullable().defaultTo('med');
    t.string('due_date', 32).nullable();
    t.text('note').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.index(['case_id']);
    t.index(['owner_id']);
    t.index(['status']);
  });

  await knex.schema.createTable('notes', (t) => {
    t.increments('id').primary();
    t.integer('case_id').unsigned().nullable()
      .references('id').inTable('cases').onDelete('CASCADE');
    t.integer('owner_id').unsigned().notNullable()
      .references('id').inTable('users').onDelete('CASCADE');
    t.string('title', 255).notNullable();
    t.text('content').nullable();
    t.string('category', 32).notNullable().defaultTo('general');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['case_id']);
    t.index(['owner_id']);
  });

  await knex.schema.createTable('documents', (t) => {
    t.increments('id').primary();
    t.integer('case_id').unsigned().nullable()
      .references('id').inTable('cases').onDelete('CASCADE');
    t.integer('owner_id').unsigned().notNullable()
      .references('id').inTable('users').onDelete('CASCADE');
    t.string('file_name', 255).notNullable();
    t.string('stored_name', 255).notNullable();
    t.string('file_path', 500).notNullable();
    t.string('file_type', 120).nullable();
    t.string('category', 32).nullable().defaultTo('other');
    t.integer('file_size').unsigned().nullable();
    t.timestamp('uploaded_at').notNullable().defaultTo(knex.fn.now());
    t.index(['case_id']);
    t.index(['owner_id']);
  });

  await knex.schema.createTable('events', (t) => {
    t.increments('id').primary();
    t.integer('case_id').unsigned().nullable()
      .references('id').inTable('cases').onDelete('SET NULL');
    t.integer('owner_id').unsigned().notNullable()
      .references('id').inTable('users').onDelete('CASCADE');
    t.string('title', 255).notNullable();
    t.string('type', 32).notNullable().defaultTo('meeting');
    t.string('date', 32).notNullable();
    t.string('time', 16).nullable();
    t.integer('reminder').nullable();
    t.text('note').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['owner_id']);
    t.index(['date']);
  });

  await knex.schema.createTable('communications', (t) => {
    t.increments('id').primary();
    t.integer('owner_id').unsigned().notNullable()
      .references('id').inTable('users').onDelete('CASCADE');
    t.string('platform', 32).notNullable();
    t.string('channel', 120).nullable();
    t.string('group_name', 120).nullable();
    t.text('settings').nullable();
    t.boolean('is_connected').notNullable().defaultTo(false);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['owner_id', 'platform']);
  });

  await knex.schema.createTable('audit_logs', (t) => {
    t.increments('id').primary();
    t.integer('user_id').unsigned().nullable()
      .references('id').inTable('users').onDelete('SET NULL');
    t.string('action', 32).notNullable();
    t.string('entity_type', 64).notNullable();
    t.integer('entity_id').unsigned().nullable();
    t.text('changes').nullable();
    t.string('ip', 64).nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['entity_type', 'entity_id']);
    t.index(['user_id']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('audit_logs');
  await knex.schema.dropTableIfExists('communications');
  await knex.schema.dropTableIfExists('events');
  await knex.schema.dropTableIfExists('documents');
  await knex.schema.dropTableIfExists('notes');
  await knex.schema.dropTableIfExists('tasks');
  await knex.schema.dropTableIfExists('clients');
  await knex.schema.dropTableIfExists('cases');
  await knex.schema.dropTableIfExists('refresh_tokens');
  await knex.schema.dropTableIfExists('users');
};
