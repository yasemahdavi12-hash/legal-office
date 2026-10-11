/**
 * System vs user templates, slugs, usage notes, nullable owner for system rows.
 */
exports.up = async function up(knex) {
  const has = await knex.schema.hasTable('document_templates');
  if (!has) return;

  const hasSystem = await knex.schema.hasColumn('document_templates', 'is_system');
  if (!hasSystem) {
    await knex.schema.alterTable('document_templates', (t) => {
      t.boolean('is_system').notNullable().defaultTo(false);
      t.string('system_slug', 128).nullable();
      t.integer('source_template_id').unsigned().nullable();
      t.text('usage_notes').nullable();
    });
  }

  const client = knex.client.config.client;
  if (client === 'sqlite3') {
    await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS doc_tpl_system_slug ON document_templates (system_slug) WHERE system_slug IS NOT NULL');
  } else {
    try {
      await knex.schema.alterTable('document_templates', (t) => {
        t.unique(['system_slug'], { indexName: 'doc_tpl_system_slug_uniq' });
      });
    } catch {
      /* may exist */
    }
  }
};

exports.down = async function down() {
  /* non-destructive */
};
