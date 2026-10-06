/**
 * Legal library (laws/articles) and user bookmarks — no seed data; import validated texts separately.
 */
exports.up = async function up(knex) {
  const hasLaws = await knex.schema.hasTable('laws');
  if (!hasLaws) {
    await knex.schema.createTable('laws', (t) => {
      t.increments('id').primary();
      t.string('title', 512).notNullable();
      t.string('category', 64).notNullable();
      t.string('approval_date', 64).nullable();
      t.string('source', 512).nullable();
      t.text('description').nullable();
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      t.index(['category']);
    });
  }

  const hasArticles = await knex.schema.hasTable('law_articles');
  if (!hasArticles) {
    await knex.schema.createTable('law_articles', (t) => {
      t.increments('id').primary();
      t.integer('law_id').unsigned().notNullable()
        .references('id').inTable('laws').onDelete('CASCADE');
      t.string('article_number', 64).notNullable();
      t.string('title', 512).nullable();
      t.text('content').notNullable();
      t.string('source', 512).nullable();
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      t.unique(['law_id', 'article_number']);
      t.index(['law_id']);
    });
  }

  const hasSaves = await knex.schema.hasTable('user_law_article_saves');
  if (!hasSaves) {
    await knex.schema.createTable('user_law_article_saves', (t) => {
      t.increments('id').primary();
      t.integer('user_id').unsigned().notNullable()
        .references('id').inTable('users').onDelete('CASCADE');
      t.integer('law_article_id').unsigned().notNullable()
        .references('id').inTable('law_articles').onDelete('CASCADE');
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.unique(['user_id', 'law_article_id']);
      t.index(['user_id']);
    });
  }

  const hasLinks = await knex.schema.hasTable('legal_tool_law_links');
  if (!hasLinks) {
    await knex.schema.createTable('legal_tool_law_links', (t) => {
      t.increments('id').primary();
      t.string('tool_slug', 64).notNullable();
      t.integer('law_article_id').unsigned().notNullable()
        .references('id').inTable('law_articles').onDelete('CASCADE');
      t.string('label', 256).nullable();
      t.unique(['tool_slug', 'law_article_id']);
      t.index(['tool_slug']);
    });
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('legal_tool_law_links');
  await knex.schema.dropTableIfExists('user_law_article_saves');
  await knex.schema.dropTableIfExists('law_articles');
  await knex.schema.dropTableIfExists('laws');
};
