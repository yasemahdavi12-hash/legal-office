/**
 * Expand events for reminders + delivery infrastructure.
 */
exports.up = async function up(knex) {
  const hasClient = await knex.schema.hasColumn('events', 'client_id');
  if (!hasClient) {
    await knex.schema.alterTable('events', (t) => {
      t.integer('client_id').unsigned().nullable()
        .references('id').inTable('clients').onDelete('SET NULL');
      t.text('description').nullable();
      t.string('location', 255).nullable();
      t.string('status', 32).notNullable().defaultTo('scheduled');
      t.string('timezone', 64).notNullable().defaultTo('Asia/Tehran');
      t.timestamp('updated_at').nullable();
    });
  }

  // Backfill description from note where empty
  try {
    await knex.raw('UPDATE events SET description = note WHERE description IS NULL');
  } catch { /* ignore if unsupported */ }

  const hasReminders = await knex.schema.hasTable('event_reminders');
  if (!hasReminders) {
    await knex.schema.createTable('event_reminders', (t) => {
      t.increments('id').primary();
      t.integer('event_id').unsigned().notNullable()
        .references('id').inTable('events').onDelete('CASCADE');
      t.integer('owner_id').unsigned().notNullable()
        .references('id').inTable('users').onDelete('CASCADE');
      t.integer('offset_minutes').notNullable();
      t.timestamp('fire_at').notNullable();
      t.string('status', 16).notNullable().defaultTo('pending'); // pending|cancelled|completed
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.unique(['event_id', 'offset_minutes']);
      t.index(['fire_at', 'status']);
      t.index(['owner_id']);
    });
  }

  const hasDeliveries = await knex.schema.hasTable('reminder_deliveries');
  if (!hasDeliveries) {
    await knex.schema.createTable('reminder_deliveries', (t) => {
      t.increments('id').primary();
      t.integer('reminder_id').unsigned().notNullable()
        .references('id').inTable('event_reminders').onDelete('CASCADE');
      t.string('channel', 16).notNullable(); // push|sms|bale|rubika
      t.string('status', 16).notNullable().defaultTo('pending'); // pending|sent|failed|skipped
      t.string('idempotency_key', 80).notNullable().unique();
      t.text('error').nullable();
      t.timestamp('sent_at').nullable();
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.index(['reminder_id', 'channel']);
      t.index(['status']);
    });
  }

  const hasPush = await knex.schema.hasTable('push_subscriptions');
  if (!hasPush) {
    await knex.schema.createTable('push_subscriptions', (t) => {
      t.increments('id').primary();
      t.integer('user_id').unsigned().notNullable()
        .references('id').inTable('users').onDelete('CASCADE');
      // varchar (not TEXT) so MySQL can enforce UNIQUE within InnoDB index limits (utf8mb4)
      t.string('endpoint', 768).notNullable().unique();
      t.string('p256dh', 255).notNullable();
      t.string('auth', 255).notNullable();
      t.string('user_agent', 255).nullable();
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      t.index(['user_id']);
    });
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('reminder_deliveries');
  await knex.schema.dropTableIfExists('event_reminders');
  await knex.schema.dropTableIfExists('push_subscriptions');
  const hasClient = await knex.schema.hasColumn('events', 'client_id');
  if (hasClient) {
    // Drop FK-backed column first (MySQL), then remaining columns
    try {
      await knex.schema.alterTable('events', (t) => {
        t.dropForeign(['client_id']);
      });
    } catch { /* sqlite / already dropped */ }
    await knex.schema.alterTable('events', (t) => {
      t.dropColumn('client_id');
    });
    await knex.schema.alterTable('events', (t) => {
      t.dropColumn('description');
      t.dropColumn('location');
      t.dropColumn('status');
      t.dropColumn('timezone');
      t.dropColumn('updated_at');
    });
  }
};
