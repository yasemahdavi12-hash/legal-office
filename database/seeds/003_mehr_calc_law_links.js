/**
 * Link mehr-calc to law articles only when exact rows exist (no guessing).
 */
exports.seed = async function seed(knex) {
  const hasLinks = await knex.schema.hasTable('legal_tool_law_links');
  const hasArticles = await knex.schema.hasTable('law_articles');
  if (!hasLinks || !hasArticles) return;

  const exactLinks = [
    { label: 'ماده 1082 قانون مدنی', lawTitle: 'قانون مدنی', articleNumber: '01082' },
    { label: 'تبصره ماده 1082 قانون مدنی', lawTitle: 'قانون مدنی', articleNumber: '01082-n1' }
  ];

  for (const t of exactLinks) {
    const row = await knex('law_articles as a')
      .join('laws as w', 'w.id', 'a.law_id')
      .where('w.title', t.lawTitle)
      .where('a.article_number', t.articleNumber)
      .select('a.id')
      .first();
    if (!row) continue;
    const exists = await knex('legal_tool_law_links')
      .where({ tool_slug: 'mehr-calc', law_article_id: row.id })
      .first();
    if (!exists) {
      await knex('legal_tool_law_links').insert({
        tool_slug: 'mehr-calc',
        law_article_id: row.id,
        label: t.label
      });
    }
  }
};
